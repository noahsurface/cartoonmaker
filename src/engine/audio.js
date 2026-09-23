// Scene-wide dialogue audio: decoding for a waveform preview, and a helper
// for drawing that waveform. Playback sync and export mixing are handled by
// the views that use this (puppet.js, export.js) since they own the
// transport clock and the MediaRecorder respectively.

export async function decodeAudioBuffer(url) {
  const res = await fetch(url);
  const arrayBuffer = await res.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    return await ctx.decodeAudioData(arrayBuffer);
  } finally {
    ctx.close();
  }
}

export function computeWaveformPeaks(buffer, bucketCount) {
  const data = buffer.getChannelData(0);
  const samplesPerBucket = Math.max(1, Math.floor(data.length / bucketCount));
  const peaks = new Float32Array(bucketCount);
  for (let i = 0; i < bucketCount; i++) {
    const start = i * samplesPerBucket;
    const end = Math.min(start + samplesPerBucket, data.length);
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = Math.abs(data[j]);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

export function drawWaveform(ctx, peaks, width, height, color = '#2fa8ff') {
  ctx.clearRect(0, 0, width, height);
  if (!peaks || peaks.length === 0) return;
  const barW = width / peaks.length;
  ctx.save();
  ctx.fillStyle = color;
  const mid = height / 2;
  for (let i = 0; i < peaks.length; i++) {
    const h = Math.max(1, peaks[i] * height);
    ctx.fillRect(i * barW, mid - h / 2, Math.max(1, barW - 1), h);
  }
  ctx.restore();
}
