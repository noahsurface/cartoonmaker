// Per-character animation state + rendering. The same update()/draw() pair
// is used both while a character is being live-puppeteered and while a
// recorded track is being played back, so movement always looks identical
// in both contexts: everything here derives purely from a position stream,
// nothing is baked into the recorded track itself.
import { getCachedImage, preloadMany } from '../utils/image-cache.js';

const FLIP_DURATION = 0.32; // seconds for a paper-flip turn
const WALK_CYCLE_HZ = 1.8; // sway/bounce oscillation speed while moving
const SWAY_AMPLITUDE = 0.045; // fraction of character size
const BOUNCE_AMPLITUDE = 0.05;
const MOVE_SPEED_EPS = 0.05; // normalized units/sec below which we call it "stopped"
const CYCLE_FPS = 6; // body move-cycle frame rate
const TALK_FPS = 10; // mouth talk-loop frame rate
export const FEET_ANCHOR_Y = 0.82; // fraction down the 1200x1200 art where the feet sit

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

/** Resolve which body/mouth/eyes asset should be showing right now. */
export function resolvePoseAssets(character, { moving, mouthHeld, eyesState, poseClock }) {
  const body = character.layers?.body;
  const mouth = character.layers?.mouth;
  const eyes = character.layers?.eyes;

  let bodyFrameId = body?.roles?.idle ?? body?.frames?.[0]?.id ?? null;
  if (moving && body?.roles?.cycle?.length) {
    const idx = Math.floor(poseClock * CYCLE_FPS) % body.roles.cycle.length;
    bodyFrameId = body.roles.cycle[idx];
  }

  let mouthFrameId = mouth?.roles?.silent ?? null;
  if (mouthHeld && mouth?.roles?.talk?.length) {
    const idx = Math.floor(poseClock * TALK_FPS) % mouth.roles.talk.length;
    mouthFrameId = mouth.roles.talk[idx];
  } else if (mouthFrameId == null) {
    mouthFrameId = mouth?.frames?.[0]?.id ?? null;
  }

  let eyesFrameId = eyes?.roles?.forward ?? eyes?.frames?.[0]?.id ?? null;
  if (eyesState === 'side' && eyes?.roles?.side) eyesFrameId = eyes.roles.side;
  else if (eyesState === 'blink' && eyes?.roles?.blink) eyesFrameId = eyes.roles.blink;

  return {
    bodyAssetId: frameAssetId(body, bodyFrameId),
    mouthAssetId: frameAssetId(mouth, mouthFrameId),
    eyesAssetId: frameAssetId(eyes, eyesFrameId),
  };
}

/**
 * Tracks one character instance's continuous animation state (facing,
 * flip-turn progress, walk-cycle phase) purely as a function of the
 * position samples it's fed. Feed it live pointer/stick deltas, or feed it
 * interpolated positions from a recorded track — the visual result is the
 * same either way.
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
    this.poseClock = 0;
    this._hasSample = false;
  }

  /** @param {number} x @param {number} y normalized scene coords @param {number} dt seconds */
  update(x, y, dt) {
    dt = Math.max(0, Math.min(dt, 0.25));
    const prevX = this._hasSample ? this.x : x;
    const prevY = this._hasSample ? this.y : y;
    const dist = Math.hypot(x - prevX, y - prevY);
    const speed = dt > 0 ? dist / dt : 0;
    this.moving = speed > MOVE_SPEED_EPS;

    const dx = x - prevX;
    if (dx > 0.0015 && this.facing !== 1) {
      this.facing = 1;
      this.flipFrom = -1;
      this.flipT = 0;
    } else if (dx < -0.0015 && this.facing !== -1) {
      this.facing = -1;
      this.flipFrom = 1;
      this.flipT = 0;
    }
    if (this.flipT < 1) {
      this.flipT = Math.min(1, this.flipT + dt / FLIP_DURATION);
    }

    if (this.moving) {
      this.walkPhase += dt * WALK_CYCLE_HZ * Math.PI * 2;
      this.poseClock += dt;
    } else {
      // Ease the phase back to the nearest resting point (upright, feet
      // together) so sway/bounce stop smoothly instead of freezing mid-step.
      const nearestRest = Math.round(this.walkPhase / (Math.PI * 2)) * Math.PI * 2;
      this.walkPhase += (nearestRest - this.walkPhase) * Math.min(1, dt * 12);
      this.poseClock = 0;
    }

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

  get swayOffset() {
    // walkPhase itself eases back to the nearest multiple of 2*PI when
    // stopped, so sin(walkPhase) already decays to 0 smoothly on its own.
    return Math.sin(this.walkPhase) * SWAY_AMPLITUDE;
  }

  get bounceOffset() {
    return Math.abs(Math.sin(this.walkPhase)) * BOUNCE_AMPLITUDE;
  }
}

/**
 * Draw one character at its current animated state.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CharacterAnimState} state
 * @param {{bodyAssetId:?string, mouthAssetId:?string, eyesAssetId:?string}} pose
 * @param {{originX:number, originY:number, size:number}} geom pixel-space placement
 */
export function drawCharacter(ctx, state, pose, geom) {
  const { originX, originY, size } = geom;
  const bodyImg = getCachedImage(pose.bodyAssetId);
  if (!bodyImg) return;
  const mouthImg = getCachedImage(pose.mouthAssetId);
  const eyesImg = getCachedImage(pose.eyesAssetId);

  // Shadow: stays under the feet, tracks position, ignores sway/bounce/flip.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(originX, originY, size * 0.24, size * 0.065, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const swayPx = state.swayOffset * size;
  const bouncePx = state.bounceOffset * size;

  ctx.save();
  ctx.translate(originX + swayPx, originY - bouncePx);
  ctx.scale(state.scaleX, 1);
  const half = size / 2;
  const top = -size * FEET_ANCHOR_Y;
  ctx.drawImage(bodyImg, -half, top, size, size);
  if (mouthImg) ctx.drawImage(mouthImg, -half, top, size, size);
  if (eyesImg) ctx.drawImage(eyesImg, -half, top, size, size);
  ctx.restore();
}
