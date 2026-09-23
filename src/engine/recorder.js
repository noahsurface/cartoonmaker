// Records a character's live performance as a timestamped position + pose
// track, and resolves what that track (or any other already-recorded track)
// should look like at an arbitrary playback time. Positions are absolute
// pixels in the shared 2560x1440 reference space (see engine/coords.js).
import { clampToBounds } from './coords.js';

const MAX_SPEED = 500; // px/sec
const ACCEL = 2000; // px/sec^2, used for both speeding up and slowing down

export class TrackRecorder {
  constructor(startX, startY) {
    this.samples = [];
    this.startedAt = null;
    this.x = startX;
    this.y = startY;
    this.vx = 0;
    this.vy = 0;
  }

  start() {
    this.samples = [];
    this.startedAt = performance.now();
  }

  /** Advance position from an input direction (-1..1 each axis) and record a sample. Returns the new {x,y}. */
  step(dx, dy, dt, mouthHeld) {
    // Normalize so diagonal input doesn't move faster than a single axis.
    const mag = Math.hypot(dx, dy);
    const dirX = mag > 1 ? dx / mag : dx;
    const dirY = mag > 1 ? dy / mag : dy;

    const targetVx = dirX * MAX_SPEED;
    const targetVy = dirY * MAX_SPEED;
    this.vx = moveToward(this.vx, targetVx, ACCEL * dt);
    this.vy = moveToward(this.vy, targetVy, ACCEL * dt);

    const next = clampToBounds(this.x + this.vx * dt, this.y + this.vy * dt);
    // If we hit a bound, stop the velocity on that axis instead of pinning
    // against it at full speed (which would cause a jarring re-launch).
    if (next.x !== this.x + this.vx * dt) this.vx = 0;
    if (next.y !== this.y + this.vy * dt) this.vy = 0;
    this.x = next.x;
    this.y = next.y;

    const t = (performance.now() - this.startedAt) / 1000;
    this.samples.push({ t, x: this.x, y: this.y, mouthHeld });
    return { x: this.x, y: this.y };
  }

  finish() {
    const duration = this.samples.length ? this.samples[this.samples.length - 1].t : 0;
    return { samples: this.samples, duration };
  }
}

function moveToward(current, target, maxDelta) {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

/** Sample an already-recorded track at time t (seconds), interpolating position. */
export function sampleTrackAt(track, t) {
  const samples = track?.samples;
  if (!samples || samples.length === 0) return null;
  const first = samples[0];
  if (t <= first.t) return { x: first.x, y: first.y, mouthHeld: first.mouthHeld };
  const last = samples[samples.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y, mouthHeld: false };

  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const span = b.t - a.t || 1;
  const frac = (t - a.t) / span;
  return {
    x: a.x + (b.x - a.x) * frac,
    y: a.y + (b.y - a.y) * frac,
    mouthHeld: a.mouthHeld,
  };
}

export function sceneDuration(scene) {
  let max = scene?.dialogueAudio?.duration || 0;
  for (const id of Object.keys(scene.tracks || {})) {
    const track = scene.tracks[id];
    if (track?.duration > max) max = track.duration;
  }
  return max;
}
