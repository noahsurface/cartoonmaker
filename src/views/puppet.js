import { getRecord, putRecord, getAll, importAssetFile, getAssetUrl } from '../db.js';
import { navigate } from '../main.js';
import { SceneRuntime, STAGE_WIDTH, STAGE_HEIGHT } from '../engine/scene.js';
import { InputSource } from '../engine/input.js';
import { TrackRecorder, sampleTrackAt, sceneDuration } from '../engine/recorder.js';
import { decodeAudioBuffer, computeWaveformPeaks, drawWaveform } from '../engine/audio.js';
import { getCharacterPoses } from '../engine/character.js';

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
  const characterEntities = scene.entities.filter((e) => e.kind === 'character');

  if (characterEntities.length === 0) {
    root.innerHTML = `
      <div class="panel">
        <h1>Animate</h1>
        <p>This scene has no characters yet.</p>
        <button class="btn accent" id="go-edit">Add characters in the scene editor</button>
      </div>`;
    root.querySelector('#go-edit').addEventListener('click', () => navigate('editor', { id: scene.id }));
    return;
  }

  let armedEntityId = characterEntities.find((e) => !scene.tracks[e.id])?.id || characterEntities[0].id;
  let mode = 'idle'; // 'idle' | 'recording' | 'previewing'
  let sceneTime = 0;
  let recorder = null;
  // The armed entity's pose sequence and where we currently are in it —
  // stepped by LB/RB (or [ / ]) only while actually recording, mirroring how
  // movement/talk are also only live during a take.
  let poseSequence = [];
  let currentPoseIndex = 0;
  const input = new InputSource();
  let runtime = null;
  let rafHandle = null;
  let lastTs = null;
  let gpInterval = null;
  const dialogueAudioEl = new Audio();
  dialogueAudioEl.preload = 'auto';

  root.innerHTML = `
    <div class="row between">
      <h1 style="margin:0">Animate — ${escapeHtml(scene.name)}</h1>
      <div class="row">
        <button class="btn secondary" id="back-btn">← Scene editor</button>
        <button class="btn success" id="export-btn">Export →</button>
      </div>
    </div>
    <div class="puppet-layout">
      <div class="stack">
        <div class="stage-wrap"><canvas id="stage" width="${STAGE_WIDTH}" height="${STAGE_HEIGHT}"></canvas></div>
        <div class="panel">
          <div class="row between">
            <strong>Dialogue audio</strong>
            <div class="row">
              <button class="btn small" id="import-audio-btn">Import audio</button>
              <button class="btn small danger icon-only" id="remove-audio-btn" title="Remove audio" style="display:none;">✕</button>
            </div>
          </div>
          <canvas id="waveform-canvas" width="1000" height="40" style="width:100%;height:40px;display:block;margin-top:8px;background:#fafafa;border:2px solid var(--border);border-radius:8px;"></canvas>
          <div id="audio-label" style="font-size:0.75rem;color:var(--ink-soft);margin-top:4px;">No dialogue audio imported yet.</div>
          <input type="file" id="audio-file-input" accept="audio/*" style="display:none" />
        </div>
        <div class="panel">
          <h2 style="margin-top:0">Timeline</h2>
          <div class="timeline-track" id="timeline">
            <div class="fill" id="timeline-fill" style="width:0%"></div>
            <div class="playhead" id="timeline-playhead" style="left:0%"></div>
          </div>
          <div id="per-track-list" class="stack" style="margin-top:10px;"></div>
          <div class="row" style="margin-top:10px;">
            <button class="btn" id="play-btn">▶ Play all</button>
            <button class="btn" id="pause-btn">⏸ Pause</button>
            <button class="btn secondary" id="restart-btn">⏮ Restart</button>
          </div>
        </div>
      </div>
      <div class="hud panel">
        <h2 style="margin-top:0">Controller</h2>
        <div class="status-line"><span class="dot-indicator" id="gp-dot"></span> <span id="gp-status">Checking for gamepad…</span></div>
        <div class="dpad-help">
          Move: <span class="kbd">arrow keys</span> / <span class="kbd">WASD</span> or stick / d-pad<br/>
          Talk (hold): <span class="kbd">Space</span> or face button A / right trigger<br/>
          Switch pose: <span class="kbd">[</span> / <span class="kbd">]</span> or left/right bumper<br/>
          <em>Eye direction and blinking are automatic.</em>
        </div>
        <h2>Who's up?</h2>
        <select id="armed-select"></select>
        <div class="row" style="margin-top:6px;">
          <button class="btn danger" id="record-btn">● Record</button>
          <button class="btn secondary" id="stop-record-btn" disabled>■ Stop</button>
        </div>
        <div id="pose-status" style="margin-top:6px;font-size:0.8rem;color:var(--ink-soft);"></div>
        <div id="record-status" style="margin-top:8px;"></div>
      </div>
    </div>
  `;

  root.querySelector('#back-btn').addEventListener('click', () => navigate('editor', { id: scene.id }));
  root.querySelector('#export-btn').addEventListener('click', () => navigate('export', { id: scene.id }));

  const canvas = root.querySelector('#stage');
  const ctx = canvas.getContext('2d');
  const armedSelect = root.querySelector('#armed-select');
  const recordBtn = root.querySelector('#record-btn');
  const stopBtn = root.querySelector('#stop-record-btn');
  const recordStatus = root.querySelector('#record-status');
  const timelineFill = root.querySelector('#timeline-fill');
  const timelinePlayhead = root.querySelector('#timeline-playhead');
  const timelineEl = root.querySelector('#timeline');
  const perTrackList = root.querySelector('#per-track-list');
  const importAudioBtn = root.querySelector('#import-audio-btn');
  const removeAudioBtn = root.querySelector('#remove-audio-btn');
  const audioFileInput = root.querySelector('#audio-file-input');
  const waveformCanvas = root.querySelector('#waveform-canvas');
  const waveformCtx = waveformCanvas.getContext('2d');
  const audioLabel = root.querySelector('#audio-label');

  function refreshArmedSelect() {
    armedSelect.innerHTML = characterEntities
      .map((e) => `<option value="${e.id}" ${e.id === armedEntityId ? 'selected' : ''}>${escapeHtml(e.name)}${scene.tracks[e.id] ? ' (recorded)' : ''}</option>`)
      .join('');
  }

  function refreshTrackList() {
    const maxDuration = Math.max(sceneDuration(scene), 0.001);
    perTrackList.innerHTML = '';
    for (const entity of characterEntities) {
      const track = scene.tracks[entity.id];
      const pct = track ? Math.min(100, (track.duration / maxDuration) * 100) : 0;
      const row = document.createElement('div');
      row.className = 'char-track-row';
      row.innerHTML = `
        <span style="width:110px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(entity.name)}</span>
        <div class="timeline-track"><div class="fill" style="width:${pct}%; background:${track ? 'var(--accent-4)' : '#ddd'}"></div></div>
        <span class="tag ${track ? 'on' : 'off'}">${track ? track.duration.toFixed(1) + 's' : 'not recorded'}</span>
      `;
      perTrackList.appendChild(row);
    }
  }

  async function refreshAudioUI() {
    if (scene.dialogueAudio) {
      const url = await getAssetUrl(scene.dialogueAudio.assetId);
      dialogueAudioEl.src = url;
      removeAudioBtn.style.display = '';
      audioLabel.textContent = `${scene.dialogueAudio.duration.toFixed(1)}s imported — this sets the overall scene length.`;
      try {
        const buffer = await decodeAudioBuffer(url);
        const peaks = computeWaveformPeaks(buffer, 300);
        drawWaveform(waveformCtx, peaks, waveformCanvas.width, waveformCanvas.height);
      } catch (err) {
        console.error('Failed to decode dialogue audio for waveform', err);
      }
    } else {
      dialogueAudioEl.removeAttribute('src');
      removeAudioBtn.style.display = 'none';
      audioLabel.textContent = 'No dialogue audio imported yet.';
      waveformCtx.clearRect(0, 0, waveformCanvas.width, waveformCanvas.height);
    }
  }

  importAudioBtn.addEventListener('click', () => audioFileInput.click());
  audioFileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const asset = await importAssetFile(file);
    const url = await getAssetUrl(asset.id);
    let duration = 0;
    try {
      const buffer = await decodeAudioBuffer(url);
      duration = buffer.duration;
    } catch (err) {
      alert("Couldn't read that audio file. Try a different format (MP3/WAV/OGG).");
      return;
    }
    scene.dialogueAudio = { assetId: asset.id, duration };
    scene.updatedAt = Date.now();
    await putRecord('scenes', scene);
    await refreshAudioUI();
    refreshTrackList();
    audioFileInput.value = '';
  });
  removeAudioBtn.addEventListener('click', async () => {
    if (!confirm('Remove the imported dialogue audio from this scene?')) return;
    scene.dialogueAudio = null;
    scene.updatedAt = Date.now();
    await putRecord('scenes', scene);
    await refreshAudioUI();
    refreshTrackList();
  });

  refreshArmedSelect();
  refreshTrackList();
  await refreshAudioUI();

  const poseStatusEl = root.querySelector('#pose-status');

  function refreshPoseSequenceForArmed() {
    const entity = characterEntities.find((e) => e.id === armedEntityId);
    const character = entity ? characterById.get(entity.refId) : null;
    const { order } = getCharacterPoses(character || {});
    poseSequence = entity?.poseSequence?.length ? entity.poseSequence : [order[0]];
    currentPoseIndex = 0;
    updatePoseStatus();
  }

  function updatePoseStatus() {
    const entity = characterEntities.find((e) => e.id === armedEntityId);
    const character = entity ? characterById.get(entity.refId) : null;
    const { poses } = getCharacterPoses(character || {});
    const poseId = poseSequence[currentPoseIndex];
    poseStatusEl.textContent = poseSequence.length > 1 ? `Pose: ${poses[poseId]?.name || '?'} (${currentPoseIndex + 1}/${poseSequence.length})` : '';
  }

  armedSelect.addEventListener('change', () => {
    armedEntityId = armedSelect.value;
    refreshPoseSequenceForArmed();
  });
  refreshPoseSequenceForArmed();

  async function rebuildRuntime() {
    runtime = new SceneRuntime(scene, characterById, objectById);
    await runtime.preload();
    drawStatic(0);
  }

  function drawStatic(t) {
    runtime.render(ctx, 0, (entityId) => {
      const track = scene.tracks[entityId];
      return track ? sampleTrackAt(track, t) : null;
    }, mode === 'idle' ? armedEntityId : null);
    updatePlayhead(t);
  }

  function updatePlayhead(t) {
    const maxDuration = Math.max(sceneDuration(scene), 0.001);
    const pct = Math.min(100, (t / maxDuration) * 100);
    timelinePlayhead.style.left = `${pct}%`;
    timelineFill.style.width = mode === 'recording' ? '100%' : `${pct}%`;
  }

  function stopLoop() {
    if (rafHandle) cancelAnimationFrame(rafHandle);
    rafHandle = null;
    lastTs = null;
  }

  function syncAudioToTime(t, shouldPlay) {
    if (!scene.dialogueAudio) return;
    if (Math.abs(dialogueAudioEl.currentTime - t) > 0.15) dialogueAudioEl.currentTime = t;
    if (shouldPlay) dialogueAudioEl.play().catch(() => {});
    else dialogueAudioEl.pause();
  }

  function loop(ts) {
    if (lastTs == null) lastTs = ts;
    const dt = Math.min(0.1, (ts - lastTs) / 1000);
    lastTs = ts;

    if (mode === 'recording') {
      sceneTime += dt;
      const sample = input.sample();
      if (sample.poseStep) {
        currentPoseIndex = (currentPoseIndex + sample.poseStep + poseSequence.length) % poseSequence.length;
        updatePoseStatus();
      }
      const activePoseId = poseSequence[currentPoseIndex];
      const { x, y } = recorder.step(sample.dx, sample.dy, dt, sample.mouthHeld, activePoseId);
      runtime.render(ctx, dt, (entityId) => {
        if (entityId === armedEntityId) return { x, y, mouthHeld: sample.mouthHeld, poseId: activePoseId };
        const track = scene.tracks[entityId];
        return track ? sampleTrackAt(track, sceneTime) : null;
      }, armedEntityId);
      const liveMax = Math.max(sceneDuration(scene), sceneTime, 0.001);
      timelinePlayhead.style.left = `${Math.min(100, (sceneTime / liveMax) * 100)}%`;
      rafHandle = requestAnimationFrame(loop);
    } else if (mode === 'previewing') {
      sceneTime += dt;
      const maxDuration = sceneDuration(scene);
      if (sceneTime >= maxDuration) {
        sceneTime = maxDuration;
        runtime.render(ctx, dt, (entityId) => {
          const track = scene.tracks[entityId];
          return track ? sampleTrackAt(track, sceneTime) : null;
        });
        updatePlayhead(sceneTime);
        dialogueAudioEl.pause();
        mode = 'idle';
        return;
      }
      runtime.render(ctx, dt, (entityId) => {
        const track = scene.tracks[entityId];
        return track ? sampleTrackAt(track, sceneTime) : null;
      });
      updatePlayhead(sceneTime);
      rafHandle = requestAnimationFrame(loop);
    }
  }

  recordBtn.addEventListener('click', async () => {
    if (mode !== 'idle') return;
    mode = 'recording';
    sceneTime = 0;
    refreshPoseSequenceForArmed();
    const entity = characterEntities.find((e) => e.id === armedEntityId);
    recorder = new TrackRecorder(entity.x, entity.y, runtime.worldWidth);
    recorder.start();
    armedSelect.disabled = true;
    recordBtn.disabled = true;
    stopBtn.disabled = false;
    recordStatus.innerHTML = `<div class="status-line"><span class="dot-indicator rec"></span> Recording ${escapeHtml(entity.name)}…</div>`;
    stopLoop();
    syncAudioToTime(0, true);
    rafHandle = requestAnimationFrame(loop);
  });

  stopBtn.addEventListener('click', async () => {
    if (mode !== 'recording') return;
    stopLoop();
    dialogueAudioEl.pause();
    const track = recorder.finish();
    scene.tracks[armedEntityId] = track;
    scene.updatedAt = Date.now();
    await putRecord('scenes', scene);
    mode = 'idle';
    armedSelect.disabled = false;
    recordBtn.disabled = false;
    stopBtn.disabled = true;
    const recordedName = characterEntities.find((e) => e.id === armedEntityId)?.name || 'character';
    recordStatus.innerHTML = `<div class="notice success">Saved ${track.duration.toFixed(1)}s for ${escapeHtml(recordedName)}.</div>`;
    const next = characterEntities.find((e) => !scene.tracks[e.id]);
    if (next) armedEntityId = next.id;
    refreshArmedSelect();
    refreshTrackList();
    refreshPoseSequenceForArmed();
    sceneTime = 0;
    drawStatic(0);
  });

  root.querySelector('#play-btn').addEventListener('click', () => {
    if (mode !== 'idle') return;
    mode = 'previewing';
    sceneTime = 0;
    stopLoop();
    syncAudioToTime(0, true);
    rafHandle = requestAnimationFrame(loop);
  });
  root.querySelector('#pause-btn').addEventListener('click', () => {
    if (mode !== 'previewing') return;
    stopLoop();
    dialogueAudioEl.pause();
    mode = 'idle';
  });
  root.querySelector('#restart-btn').addEventListener('click', () => {
    stopLoop();
    dialogueAudioEl.pause();
    mode = 'idle';
    sceneTime = 0;
    syncAudioToTime(0, false);
    drawStatic(0);
  });

  timelineEl.addEventListener('click', (e) => {
    if (mode !== 'idle') return;
    const rect = timelineEl.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const maxDuration = Math.max(sceneDuration(scene), 0.001);
    sceneTime = frac * maxDuration;
    syncAudioToTime(sceneTime, false);
    drawStatic(sceneTime);
  });

  function updateGamepadStatus() {
    const connected = input.isGamepadConnected();
    root.querySelector('#gp-dot').className = 'dot-indicator ' + (connected ? 'good' : 'bad');
    root.querySelector('#gp-status').textContent = connected ? 'Gamepad connected' : 'No gamepad — using keyboard controls';
  }
  updateGamepadStatus();
  gpInterval = setInterval(updateGamepadStatus, 500);

  await rebuildRuntime();

  return () => {
    stopLoop();
    if (gpInterval) clearInterval(gpInterval);
    input.dispose();
    dialogueAudioEl.pause();
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
