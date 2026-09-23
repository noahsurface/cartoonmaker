// Per-character animation state + rendering. The same update()/draw() pair
// is used both while a character is being live-puppeteered and while a
// recorded track is being played back, so movement always looks identical
// in both contexts: everything here derives purely from a position stream,
// nothing is baked into the recorded track itself.
import { getCachedImage, preloadMany } from '../utils/image-cache.js';
import { REF_HEIGHT } from './coords.js';

const FLIP_DURATION = 0.32; // seconds for a paper-flip turn
const SWAY_CYCLE_SECONDS = 0.75; // one full left-right-left sway cycle
const SWAY_CYCLE_HZ = 1 / SWAY_CYCLE_SECONDS;
// Bounce is abs(sin(walkPhase)), which has half the period of sin(walkPhase)
// (sway) for free — one bump per half sway-revolution — giving exactly two
// bounces per sway cycle (0.375s each) without a separate rate constant.
const SWAY_DEGREES = 7; // feet-anchored tilt, alternating +/- this many degrees
const BOUNCE_AMPLITUDE = 0.067; // fraction of character height
const MOVE_SPEED_EPS = 15; // px/sec below which we call it "stopped"
const EYES_SIDE_EPS = 20; // px/sec of horizontal speed before eyes look sideways
const TALK_FPS = 10; // mouth + body talk-loop frame rate
const BUBBLE_FPS = 8; // speech bubble loop frame rate
const BLINK_MIN_INTERVAL = 2; // seconds
const BLINK_MAX_INTERVAL = 4; // seconds
const BLINK_DURATION = 0.125; // seconds
export const FEET_ANCHOR_Y = 0.82; // fraction down the 1200x1200 art where the feet sit
// Speech bubble anchor, expressed as a fraction of the character's own
// rendered size (not a fixed pixel amount) so the bubble moves with the
// character when it's scaled up or down. Calibrated so that at the default
// add-to-scene size (entity.scale = 0.32, i.e. size = 0.32 * REF_HEIGHT) it
// lands exactly 400px above / 200px to the right of the feet, as originally
// specified — everything above/below that scale is proportional to it.
const DEFAULT_CHARACTER_SCALE = 0.32;
export const BUBBLE_OFFSET_X_FRACTION = 200 / (DEFAULT_CHARACTER_SCALE * REF_HEIGHT);
export const BUBBLE_OFFSET_Y_FRACTION = 400 / (DEFAULT_CHARACTER_SCALE * REF_HEIGHT);

function randomBlinkInterval() {
  return BLINK_MIN_INTERVAL + Math.random() * (BLINK_MAX_INTERVAL - BLINK_MIN_INTERVAL);
}

export function collectCharacterAssetIds(character) {
  const ids = [];
  for (const layerName of ['body', 'mouth', 'eyes']) {
    const layer = character.layers?.[layerName];
    if (!layer) continue;
    for (const frame of layer.frames) ids.push(frame.assetId);
  }
  return ids;
}

export async function preloadCharacterImages(character) {
  await preloadMany(collectCharacterAssetIds(character));
}

function frameAssetId(layer, frameId) {
  if (!layer || !frameId) return null;
  const frame = layer.frames.find((f) => f.id === frameId);
  return frame ? frame.assetId : null;
}

/** The body asset used for a character's resting pose — used as the stable
 * reference for sizing the shadow, so it doesn't resize as the body cycles
 * through talk frames. */
export function resolveIdleBodyAssetId(character) {
  const body = character.layers?.body;
  const idleFrameId = body?.roles?.idle ?? body?.frames?.[0]?.id ?? null;
  return frameAssetId(body, idleFrameId);
}

/** Resolve which body/mouth/eyes asset should be showing right now. */
export function resolvePoseAssets(character, { mouthHeld, talkClock, eyesLook, blinking }) {
  const body = character.layers?.body;
  const mouth = character.layers?.mouth;
  const eyes = character.layers?.eyes;

  // Body and mouth both cycle in lockstep while talking, at the same rate,
  // driven by the same talk clock so they never fall out of sync.
  let bodyFrameId = body?.roles?.idle ?? body?.frames?.[0]?.id ?? null;
  if (mouthHeld && body?.roles?.cycle?.length) {
    const idx = Math.floor(talkClock * TALK_FPS) % body.roles.cycle.length;
    bodyFrameId = body.roles.cycle[idx];
  }

  let mouthFrameId = mouth?.roles?.silent ?? null;
  if (mouthHeld && mouth?.roles?.talk?.length) {
    const idx = Math.floor(talkClock * TALK_FPS) % mouth.roles.talk.length;
    mouthFrameId = mouth.roles.talk[idx];
  } else if (mouthFrameId == null) {
    mouthFrameId = mouth?.frames?.[0]?.id ?? null;
  }

  let eyesFrameId = eyes?.roles?.forward ?? eyes?.frames?.[0]?.id ?? null;
  if (blinking && eyes?.roles?.blink) eyesFrameId = eyes.roles.blink;
  else if (eyesLook === 'side' && eyes?.roles?.side) eyesFrameId = eyes.roles.side;

  return {
    bodyAssetId: frameAssetId(body, bodyFrameId),
    mouthAssetId: frameAssetId(mouth, mouthFrameId),
    eyesAssetId: frameAssetId(eyes, eyesFrameId),
  };
}

/**
 * Tracks one character instance's continuous animation state (facing,
 * flip-turn progress, walk-cycle phase, eye look/blink) purely as a function
 * of the position/mouth samples it's fed. Feed it live input each frame, or
 * feed it interpolated positions from a recorded track — the visual result
 * is the same either way. Positions are absolute pixels in the shared
 * 2560x1440 reference space (see engine/scene.js).
 */
export class CharacterAnimState {
  constructor(startX = 0, startY = 0) {
    this.x = startX;
    this.y = startY;
    this.facing = 1;
    this.flipFrom = 1;
    this.flipT = 1; // 1 = settled, not mid-flip
    this.walkPhase = 0;
    this.moving = false;
    this.eyesLook = 'forward'; // 'forward' | 'side', driven by horizontal movement
    this.isBlinking = false;
    this.blinkTimer = randomBlinkInterval();
    this.talking = false;
    this.talkClock = 0;
    this._hasSample = false;
  }

  /**
   * @param {number} x @param {number} y absolute pixels in the 2560x1440 reference space
   * @param {number} dt seconds
   * @param {boolean} mouthHeld whether this character is currently talking
   */
  update(x, y, dt, mouthHeld = false) {
    dt = Math.max(0, Math.min(dt, 0.25));
    const prevX = this._hasSample ? this.x : x;
    const prevY = this._hasSample ? this.y : y;
    const dist = Math.hypot(x - prevX, y - prevY);
    const speed = dt > 0 ? dist / dt : 0;
    this.moving = speed > MOVE_SPEED_EPS;

    const dx = x - prevX;
    const hSpeed = dt > 0 ? Math.abs(dx) / dt : 0;
    this.eyesLook = hSpeed > EYES_SIDE_EPS ? 'side' : 'forward';

    if (dx > 0.4 && this.facing !== 1) {
      this.facing = 1;
      this.flipFrom = -1;
      this.flipT = 0;
    } else if (dx < -0.4 && this.facing !== -1) {
      this.facing = -1;
      this.flipFrom = 1;
      this.flipT = 0;
    }
    if (this.flipT < 1) {
      this.flipT = Math.min(1, this.flipT + dt / FLIP_DURATION);
    }

    if (this.moving) {
      this.walkPhase += dt * SWAY_CYCLE_HZ * Math.PI * 2;
    } else {
      // Ease the phase back to the nearest resting point (upright, feet
      // together) so sway/bounce stop smoothly instead of freezing mid-step.
      const nearestRest = Math.round(this.walkPhase / (Math.PI * 2)) * Math.PI * 2;
      this.walkPhase += (nearestRest - this.walkPhase) * Math.min(1, dt * 12);
    }

    // Random independent blinking, on top of whatever the eyes are otherwise doing.
    if (this.isBlinking) {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.isBlinking = false;
        this.blinkTimer = randomBlinkInterval();
      }
    } else {
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.isBlinking = true;
        this.blinkTimer = BLINK_DURATION;
      }
    }

    if (mouthHeld && !this.talking) this.talkClock = 0;
    this.talking = mouthHeld;
    if (mouthHeld) this.talkClock += dt;

    this.x = x;
    this.y = y;
    this._hasSample = true;
  }

  get scaleX() {
    if (this.flipT >= 1) return this.facing;
    // cos(0)=1 -> flipFrom; cos(pi)=-1 -> -flipFrom (== new facing). Passes
    // through 0 (edge-on) at the midpoint, which is the paper-flip look.
    return this.flipFrom * Math.cos(this.flipT * Math.PI);
  }

  get swayAngle() {
    // walkPhase itself eases back to the nearest multiple of 2*PI when
    // stopped, so sin(walkPhase) already decays to 0 smoothly on its own.
    return Math.sin(this.walkPhase) * (SWAY_DEGREES * Math.PI) / 180;
  }

  get bounceOffset() {
    return Math.abs(Math.sin(this.walkPhase)) * BOUNCE_AMPLITUDE;
  }

  get bubbleFrameIndex() {
    return Math.floor(this.talkClock * BUBBLE_FPS) % 4;
  }
}

/**
 * Draw one character's shadow + body/mouth/eyes (no speech bubble — that's a
 * separate pass in scene.js, drawn after every character's body so bubbles
 * always sit on top, and so overlap against other characters can be tested
 * before it's drawn).
 * @param {CanvasRenderingContext2D} ctx
 * @param {CharacterAnimState} state
 * @param {{bodyAssetId:?string, mouthAssetId:?string, eyesAssetId:?string}} pose
 * @param {{originX:number, originY:number, size:number, shadowWidthFraction?:number}} geom pixel-space
 *   placement (originY = ground/feet level); shadowWidthFraction is the character's actual (non-transparent)
 *   width as a fraction of `size`, so the shadow can match the character's real silhouette width.
 * @param {{shadowImg:?HTMLImageElement}} fx shared effect images
 */
export function drawCharacterBody(ctx, state, pose, geom, fx = {}) {
  const { originX, originY, size, shadowWidthFraction = 1 } = geom;
  const bodyImg = getCachedImage(pose.bodyAssetId);
  if (!bodyImg) return;
  const mouthImg = getCachedImage(pose.mouthAssetId);
  const eyesImg = getCachedImage(pose.eyesAssetId);

  // Shadow: stays on the ground under the feet, tracks position, ignores sway/bounce/flip.
  if (fx.shadowImg) {
    const shadowAspect = fx.shadowImg.width / fx.shadowImg.height || 4;
    const shadowW = size * shadowWidthFraction;
    const shadowH = shadowW / shadowAspect;
    ctx.drawImage(fx.shadowImg, originX - shadowW / 2, originY - shadowH / 2, shadowW, shadowH);
  }

  // Body/mouth/eyes: rotated together about the (bounced) feet pivot, so the
  // sway tilts the character while its feet stay anchored above the shadow.
  ctx.save();
  ctx.translate(originX, feetPivotY(state, geom));
  ctx.rotate(state.swayAngle);
  ctx.scale(state.scaleX, 1);
  const half = size / 2;
  const top = -size * FEET_ANCHOR_Y;
  ctx.drawImage(bodyImg, -half, top, size, size);
  if (mouthImg) ctx.drawImage(mouthImg, -half, top, size, size);
  if (eyesImg) ctx.drawImage(eyesImg, -half, top, size, size);
  ctx.restore();
}

function feetPivotY(state, geom) {
  return geom.originY - state.bounceOffset * geom.size;
}

/** Axis-aligned on-screen bounding box for a character, used for depth-sort
 * ties and for testing whether another character's speech bubble overlaps it. */
export function getCharacterBounds(state, geom) {
  const { originX, size, shadowWidthFraction = 1 } = geom;
  const halfWidth = (size * shadowWidthFraction) / 2;
  return {
    left: originX - halfWidth,
    right: originX + halfWidth,
    top: feetPivotY(state, geom) - size * FEET_ANCHOR_Y,
    bottom: geom.originY,
  };
}

export function rectsOverlap(a, b) {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

/**
 * Geometry (+ current frame) for a talking character's speech bubble, or null
 * if it isn't talking. Centered above/right of the bottom of the character's
 * feet, both the offset and the bubble's own size scaling with the
 * character's current rendered size (`geom.size`), so scaling the character
 * up or down moves and resizes the bubble along with it.
 */
export function getSpeechBubbleRect(state, geom, bubbleFrames) {
  if (!state.talking || !bubbleFrames?.length) return null;
  const img = bubbleFrames[state.bubbleFrameIndex % bubbleFrames.length];
  if (!img) return null;
  const bubbleSize = geom.size * 0.5;
  const aspect = img.width / img.height || 1;
  const bw = bubbleSize * aspect;
  const bh = bubbleSize;
  const centerX = geom.originX + geom.size * BUBBLE_OFFSET_X_FRACTION;
  const centerY = feetPivotY(state, geom) - geom.size * BUBBLE_OFFSET_Y_FRACTION;
  const left = centerX - bw / 2;
  const top = centerY - bh / 2;
  return { left, right: left + bw, top, bottom: top + bh, img };
}

export function drawSpeechBubbleRect(ctx, rect, opacity = 1) {
  if (!rect) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.drawImage(rect.img, rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top);
  ctx.restore();
}
