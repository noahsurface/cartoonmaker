// Camera follow: smoothly pans to keep a designated "focus" character within
// a deadzone near the center of the frame, clamped to the world's actual
// size — independently on each axis, so a background that's only wide (or
// only tall) naturally gets follow on just that one axis. Like
// CharacterAnimState, this is a pure function of a position stream (the
// focus character's x/y + dt), so it re-derives identically for live
// puppeteering, played-back tracks, and export — no separate camera
// recording is needed.
import { REF_WIDTH, REF_HEIGHT } from './coords.js';

const DEADZONE_FRACTION = 0.18; // half-width of the free-move zone, as a fraction of viewport size
const EASE_RATE = 4; // higher = camera catches up to its target faster

export class CameraState {
  constructor() {
    this.x = 0;
    this.y = 0;
    this._hasSample = false;
  }

  /**
   * @param {number} followX @param {number} followY focus character's current position (reference-space pixels)
   * @param {number} worldWidth @param {number} worldHeight total scrollable world size (reference-space pixels)
   * @param {number} dt seconds; 0 (or the very first call) snaps straight to
   *   the ideal centered position instead of easing, so a static preview or a
   *   manual timeline scrub always shows correct framing rather than a stale
   *   eased-from-elsewhere position.
   * @returns {{x:number,y:number}} the camera's current top-left in reference pixels
   */
  update(followX, followY, worldWidth, worldHeight, dt) {
    const maxX = Math.max(0, worldWidth - REF_WIDTH);
    const maxY = Math.max(0, worldHeight - REF_HEIGHT);
    if (!this._hasSample || dt <= 0) {
      this.x = clamp(followX - REF_WIDTH / 2, 0, maxX);
      this.y = clamp(followY - REF_HEIGHT / 2, 0, maxY);
      this._hasSample = true;
      return { x: this.x, y: this.y };
    }
    this.x = stepAxis(this.x, followX, REF_WIDTH, maxX, dt);
    this.y = stepAxis(this.y, followY, REF_HEIGHT, maxY, dt);
    return { x: this.x, y: this.y };
  }
}

function stepAxis(current, followPos, viewportSize, maxPos, dt) {
  const deadzoneHalf = viewportSize * DEADZONE_FRACTION;
  const center = current + viewportSize / 2;
  let target = current;
  if (followPos < center - deadzoneHalf) target = followPos - viewportSize / 2 + deadzoneHalf;
  else if (followPos > center + deadzoneHalf) target = followPos - viewportSize / 2 - deadzoneHalf;
  target = clamp(target, 0, maxPos);
  return current + (target - current) * Math.min(1, dt * EASE_RATE);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
