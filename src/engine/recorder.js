// Records a character's live performance as a timestamped position + pose
// track, and resolves what that track (or any other already-recorded track)
// should look like at an arbitrary playback time.

const MOVE_SPEED = 0.55; // normalized scene-units/sec at full stick deflection

export class TrackRecorder {
  constructor(startX, startY) {
    this.samples = [];
    this.startedAt = null;
    this.x = startX;
    this.y = startY;
  }

  start() {
    this.samples = [];
    this.startedAt = performance.now();
  }

  /** Advance position from an input delta and record a sample. Returns the new {x,y}. */
  step(dx, dy, dt, mouthHeld, eyesState) {
    this.x = Math.max(0.03, Math.min(0.97, this.x + dx * MOVE_SPEED * dt));
    this.y = Math.max(0.35, Math.min(0.97, this.y + dy * MOVE_SPEED * dt));
    const t = (performance.now() - this.startedAt) / 1000;
    this.samples.push({ t, x: this.x, y: this.y, mouthHeld, eyesState });
    return { x: this.x, y: this.y };
  }

  finish() {
    const duration = this.samples.length ? this.samples[this.samples.length - 1].t : 0;
    return { samples: this.samples, duration };
  }
}

/** Sample an already-recorded track at time t (seconds), interpolating position. */
export function sampleTrackAt(track, t) {
  const samples = track?.samples;
  if (!samples || samples.length === 0) return null;
  const first = samples[0];
  if (t <= first.t) return { x: first.x, y: first.y, mouthHeld: first.mouthHeld, eyesState: first.eyesState };
  const last = samples[samples.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y, mouthHeld: false, eyesState: 'forward' };

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
    eyesState: a.eyesState,
  };
}

export function sceneDuration(scene) {
  let max = 0;
  for (const id of Object.keys(scene.tracks || {})) {
    const track = scene.tracks[id];
    if (track?.duration > max) max = track.duration;
  }
  return max;
}
