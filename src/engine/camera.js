// Horizontal-only camera follow: smoothly pans to keep a designated "focus"
// character within a deadzone near the center of the frame, clamped to the
// world's actual width. Like CharacterAnimState, this is a pure function of
// a position stream (the focus character's x + dt), so it re-derives
// identically for live puppeteering, played-back tracks, and export — no
// separate camera recording is needed.
import { REF_WIDTH } from './coords.js';

const DEADZONE_FRACTION = 0.18; // half-width of the free-move zone, as a fraction of frame width
const EASE_RATE = 4; // higher = camera catches up to its target faster

export class CameraState {
  constructor() {
    this.x = 0;
    this._hasSample = false;
  }

  /**
   * @param {number} followX focus character's current x (reference-space pixels)
   * @param {number} worldWidth total scrollable width (reference-space pixels)
   * @param {number} dt seconds; 0 (or the very first call) snaps straight to
   *   the ideal centered position instead of easing, so a static preview or a
   *   manual timeline scrub always shows correct framing rather than a stale
   *   eased-from-elsewhere position.
   * @returns {number} the camera's current left-edge x in reference pixels
   */
  update(followX, worldWidth, dt) {
    const maxX = Math.max(0, worldWidth - REF_WIDTH);
    if (!this._hasSample || dt <= 0) {
      this.x = clamp(followX - REF_WIDTH / 2, 0, maxX);
      this._hasSample = true;
      return this.x;
    }
    const deadzoneHalf = REF_WIDTH * DEADZONE_FRACTION;
    const center = this.x + REF_WIDTH / 2;
    let target = this.x;
    if (followX < center - deadzoneHalf) target = followX - REF_WIDTH / 2 + deadzoneHalf;
    else if (followX > center + deadzoneHalf) target = followX - REF_WIDTH / 2 - deadzoneHalf;
    target = clamp(target, 0, maxX);
    this.x += (target - this.x) * Math.min(1, dt * EASE_RATE);
    return this.x;
  }
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
