import { getRecord, getAll } from '../db.js';
import { navigate } from '../main.js';
import { SceneRuntime } from '../engine/scene.js';
import { sampleTrackAt, sceneDuration } from '../engine/recorder.js';

const RESOLUTIONS = {
  '720p': { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
};

function pickMimeType() {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) return type;
  }
  return 'video/webm';
}

export async function render(root, params) {
  const sceneId = params.id;
  const scene = await getRecord('scenes', sceneId);
  if (!scene) {
    root.innerHTML = `<div class="panel"><h2>Scene not found</h2><a href="#/scenes">Back to scenes</a></div>`;
    return;
  }
  const [characters, objects] = await Promise.all([getAll('characters'), getAll('objects')]);
  const characterById = new Map(characters.map((c) => [c.id, c]));
  const objectById = new Map(objects.map((o) => [o.id, o]));
  const duration = sceneDuration(scene);

  let rafHandle = null;
  let mediaRecorder = null;
  let downloadUrl = null;

  root.innerHTML = `
    <div class="row between">
      <h1 style="margin:0">Export — ${escapeHtml(scene.name)}</h1>
      <div class="row">
        <button class="btn secondary" id="back-btn">← Animate</button>
      </div>
    </div>
    ${
      !window.MediaRecorder
        ? '<div class="notice error">This browser does not support recording video (MediaRecorder API). Try a recent Chrome, Edge, or Firefox.</div>'
        : duration <= 0
        ? `<div class="notice error">No character performances have been recorded in this scene yet. <a href="#/puppet?id=${scene.id}">Go animate at least one character</a> first.</div>`
        : ''
    }
    <div class="editor-layout" style="grid-template-columns: 1fr 260px;">
      <div class="stack">
        <div class="stage-wrap"><canvas id="stage" width="1280" height="720"></canvas></div>
        <div class="panel">
          <div class="timeline-track"><div class="fill" id="progress-fill" style="width:0%"></div></div>
          <p id="progress-label" style="font-size:0.8rem;color:var(--ink-soft);margin:6px 0 0;">Ready — recorded scene length: ${duration.toFixed(1)}s</p>
        </div>
      </div>
      <div class="panel stack">
        <h2 style="margin-top:0">Settings</h2>
        <label>Resolution
          <select id="res-select">
            <option value="720p">1280 × 720</option>
            <option value="1080p">1920 × 1080</option>
          </select>
        </label>
        <label>Frame rate
          <select id="fps-select">
            <option value="30" selected>30 fps</option>
            <option value="24">24 fps</option>
            <option value="60">60 fps</option>
          </select>
        </label>
        <button class="btn accent" id="start-btn" ${duration <= 0 || !window.MediaRecorder ? 'disabled' : ''}>● Render video</button>
        <button class="btn secondary" id="cancel-btn" disabled>Cancel</button>
        <div id="download-area"></div>
      </div>
    </div>
  `;

  root.querySelector('#back-btn').addEventListener('click', () => navigate('puppet', { id: scene.id }));

  const canvas = root.querySelector('#stage');
  const ctx = canvas.getContext('2d');
  const startBtn = root.querySelector('#start-btn');
  const cancelBtn = root.querySelector('#cancel-btn');
  const resSelect = root.querySelector('#res-select');
  const fpsSelect = root.querySelector('#fps-select');
  const progressFill = root.querySelector('#progress-fill');
  const progressLabel = root.querySelector('#progress-label');
  const downloadArea = root.querySelector('#download-area');

  let runtime = new SceneRuntime(scene, characterById, objectById);
  await runtime.preload();
  runtime.render(ctx, 0, (entityId) => {
    const track = scene.tracks[entityId];
    return track ? sampleTrackAt(track, 0) : null;
  });

  function resolvePose(entityId, t) {
    const track = scene.tracks[entityId];
    return track ? sampleTrackAt(track, t) : null;
  }

  startBtn.addEventListener('click', () => {
    const { w, h } = RESOLUTIONS[resSelect.value];
    const fps = parseInt(fpsSelect.value, 10);
    canvas.width = w;
    canvas.height = h;
    runtime = new SceneRuntime(scene, characterById, objectById);

    const stream = canvas.captureStream(fps);
    const mimeType = pickMimeType();
    const chunks = [];
    mediaRecorder = new MediaRecorder(stream, { mimeType });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = () => {
      const blob = new Blob(chunks, { type: mimeType });
      if (downloadUrl) URL.revokeObjectURL(downloadUrl);
      downloadUrl = URL.createObjectURL(blob);
      downloadArea.innerHTML = `
        <a class="btn success" href="${downloadUrl}" download="${sanitizeFilename(scene.name)}.webm">⬇ Download video</a>
        <video controls src="${downloadUrl}" style="width:100%;margin-top:10px;border:2px solid var(--border);border-radius:10px;"></video>
      `;
      progressLabel.textContent = 'Done!';
      startBtn.disabled = false;
      cancelBtn.disabled = true;
      resSelect.disabled = false;
      fpsSelect.disabled = false;
    };

    startBtn.disabled = true;
    cancelBtn.disabled = false;
    resSelect.disabled = true;
    fpsSelect.disabled = true;
    downloadArea.innerHTML = '';
    mediaRecorder.start();

    let sceneTime = 0;
    let lastTs = null;
    const runLoop = (ts) => {
      if (lastTs == null) lastTs = ts;
      const dt = Math.min(0.1, (ts - lastTs) / 1000);
      lastTs = ts;
      sceneTime += dt;
      if (sceneTime >= duration) {
        runtime.render(ctx, dt, (id) => resolvePose(id, duration));
        progressFill.style.width = '100%';
        progressLabel.textContent = `Finalizing… (${duration.toFixed(1)}s captured)`;
        mediaRecorder.stop();
        rafHandle = null;
        return;
      }
      runtime.render(ctx, dt, (id) => resolvePose(id, sceneTime));
      progressFill.style.width = `${Math.min(100, (sceneTime / duration) * 100)}%`;
      progressLabel.textContent = `Rendering… ${sceneTime.toFixed(1)}s / ${duration.toFixed(1)}s`;
      rafHandle = requestAnimationFrame(runLoop);
    };
    rafHandle = requestAnimationFrame(runLoop);
  });

  cancelBtn.addEventListener('click', () => {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    startBtn.disabled = false;
    cancelBtn.disabled = true;
    resSelect.disabled = false;
    fpsSelect.disabled = false;
    progressLabel.textContent = 'Cancelled.';
  });

  return () => {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  };
}

function sanitizeFilename(name) {
  return (name || 'scene').replace(/[^a-z0-9-_ ]/gi, '').trim().replace(/\s+/g, '-') || 'scene';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
