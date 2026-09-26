// Records a character's live performance as a timestamped position + pose
// track, and resolves what that track (or any other already-recorded track)
// should look like at an arbitrary playback time. Positions are absolute
// pixels in the shared 2560x1440 reference space (see engine/coords.js).
import { clampToBounds, REF_WIDTH, REF_HEIGHT } from './coords.js';

const MAX_SPEED = 500; // px/sec
const ACCEL = 2000; // px/sec^2, used for both speeding up and slowing down

export class TrackRecorder {
  constructor(startX, startY, worldWidth = REF_WIDTH, worldHeight = REF_HEIGHT, obstacles = []) {
    this.samples = [];
    this.startedAt = null;
    this.x = startX;
    this.y = startY;
    this.vx = 0;
    this.vy = 0;
    this.worldWidth = worldWidth;
    this.worldHeight = worldHeight;
    // Static ground-footprint rectangles (reference-space) for solid
    // objects, computed once at record-start since objects don't move — see
    // SceneRuntime.getSolidObstacles().
    this.obstacles = obstacles;
  }

  start() {
    this.samples = [];
    this.startedAt = performance.now();
  }

  /** Advance position from an input direction (-1..1 each axis) and record a sample. Returns the new {x,y}. */
  step(dx, dy, dt, mouthHeld, poseId = null) {
    // Normalize so diagonal input doesn't move faster than a single axis.
    const mag = Math.hypot(dx, dy);
    const dirX = mag > 1 ? dx / mag : dx;
    const dirY = mag > 1 ? dy / mag : dy;

    const targetVx = dirX * MAX_SPEED;
    const targetVy = dirY * MAX_SPEED;
    this.vx = moveToward(this.vx, targetVx, ACCEL * dt);
    this.vy = moveToward(this.vy, targetVy, ACCEL * dt);

    let next = clampToBounds(this.x + this.vx * dt, this.y + this.vy * dt, this.worldWidth, this.worldHeight);
    // If we hit a bound, stop the velocity on that axis instead of pinning
    // against it at full speed (which would cause a jarring re-launch).
    if (next.x !== this.x + this.vx * dt) this.vx = 0;
    if (next.y !== this.y + this.vy * dt) this.vy = 0;

    // Solid objects are treated as walls: pushed back out along whichever
    // edge of the obstacle's footprint is nearest, zeroing velocity on
    // whichever axis that push happened on (same "stop, don't relaunch"
    // treatment as the world-edge clamp above).
    for (const rect of this.obstacles) {
      const pushed = pushOutOfRect(next.x, next.y, rect);
      if (!pushed) continue;
      if (pushed.x !== next.x) this.vx = 0;
      if (pushed.y !== next.y) this.vy = 0;
      next = pushed;
    }

    this.x = next.x;
    this.y = next.y;

    const t = (performance.now() - this.startedAt) / 1000;
    this.samples.push({ t, x: this.x, y: this.y, mouthHeld, poseId });
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

/** If (x,y) is inside rect, push it back out along whichever edge is
 * nearest (a simple, cheap AABB resolution — fine for a handful of static
 * obstacles). Returns null if (x,y) isn't inside the rect at all. */
function pushOutOfRect(x, y, rect) {
  if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
  const distances = [
    { d: x - rect.left, x: rect.left, y },
    { d: rect.right - x, x: rect.right, y },
    { d: y - rect.top, x, y: rect.top },
    { d: rect.bottom - y, x, y: rect.bottom },
  ];
  distances.sort((a, b) => a.d - b.d);
  return { x: distances[0].x, y: distances[0].y };
}

/** Sample an already-recorded track at time t (seconds), interpolating position. */
export function sampleTrackAt(track, t) {
  const samples = track?.samples;
  if (!samples || samples.length === 0) return null;
  const first = samples[0];
  if (t <= first.t) return { x: first.x, y: first.y, mouthHeld: first.mouthHeld, poseId: first.poseId };
  const last = samples[samples.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y, mouthHeld: false, poseId: last.poseId };

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
    // Discrete/step fields (not interpolated) hold the earlier sample's
    // value until it actually changes, same as mouthHeld always has.
    mouthHeld: a.mouthHeld,
    poseId: a.poseId,
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
