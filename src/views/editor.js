import { getRecord, putRecord, getAll, uid } from '../db.js';
import { navigate } from '../main.js';
import { SceneRuntime, STAGE_WIDTH, STAGE_HEIGHT } from '../engine/scene.js';
import { FEET_ANCHOR_Y, getCharacterPoses } from '../engine/character.js';
import { REF_WIDTH, REF_HEIGHT, clampToBounds, getWorldTransform } from '../engine/coords.js';
import { getCachedImage } from '../utils/image-cache.js';
import { pickAsset } from './asset-picker.js';

export async function render(root, params) {
  const sceneId = params.id;
  const scene = await getRecord('scenes', sceneId);
  if (!scene) {
    root.innerHTML = '<div class="panel">Scene not found. <a href="#/scenes">Back to scenes</a></div>';
    return;
  }

  const [characters, objects] = await Promise.all([getAll('characters'), getAll('objects')]);
  const characterById = new Map(characters.map((c) => [c.id, c]));
  const objectById = new Map(objects.map((o) => [o.id, o]));

  let selectedEntityId = null;
  let runtime = null;
  let dragState = null;

  root.innerHTML = `
    <div class="row between">
      <h1 style="margin:0">
        <input id="scene-name" type="text" value="${escapeHtml(scene.name)}" style="font-size:1.4rem;font-weight:800;border:none;border-bottom:2px dashed var(--border);background:transparent;" />
      </h1>
      <div class="row">
        <button class="btn secondary" id="back-btn">← Scenes</button>
        <button class="btn accent" id="animate-btn">Animate →</button>
      </div>
    </div>
    <div class="editor-layout">
      <div class="panel stack">
        <h2>Background</h2>
        <button class="btn" id="pick-bg">Choose image</button>
        <h2>Add to scene</h2>
        <div class="stack">
          <select id="add-character-select"></select>
          <button class="btn" id="add-character-btn">+ Add character</button>
          <select id="add-object-select"></select>
          <button class="btn" id="add-object-btn">+ Add object</button>
        </div>
        <h2>Camera</h2>
        <select id="camera-follow-select"></select>
        <p style="font-size:0.75rem;color:var(--ink-soft);margin:0;">Only matters when the background is wider than the frame — the camera pans to follow this character.</p>
      </div>
      <div class="stack">
        <div class="stage-wrap">
          <canvas id="stage" width="${STAGE_WIDTH}" height="${STAGE_HEIGHT}"></canvas>
        </div>
        <p style="font-size:0.8rem;color:var(--ink-soft);">Drag items on the stage to position them.</p>
      </div>
      <div class="panel stack">
        <h2>Entities</h2>
        <div class="entity-list" id="entity-list"></div>
        <div id="entity-controls"></div>
      </div>
    </div>
  `;

  root.querySelector('#back-btn').addEventListener('click', () => navigate('scenes'));
  root.querySelector('#animate-btn').addEventListener('click', () => navigate('puppet', { id: scene.id }));
  root.querySelector('#scene-name').addEventListener('change', async (e) => {
    scene.name = e.target.value || 'Untitled Scene';
    await save();
  });

  const charSelect = root.querySelector('#add-character-select');
  charSelect.innerHTML = characters.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('') || '<option value="">(no characters yet)</option>';
  const objSelect = root.querySelector('#add-object-select');
  objSelect.innerHTML = objects.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('') || '<option value="">(no objects yet)</option>';

  const cameraSelect = root.querySelector('#camera-follow-select');
  function refreshCameraSelect() {
    const characterEntities = scene.entities.filter((e) => e.kind === 'character');
    cameraSelect.innerHTML =
      '<option value="">(static — no follow)</option>' +
      characterEntities.map((e) => `<option value="${e.id}" ${e.id === scene.cameraFollowEntityId ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('');
  }
  refreshCameraSelect();
  cameraSelect.addEventListener('change', async () => {
    scene.cameraFollowEntityId = cameraSelect.value || null;
    await save();
    drawFrame();
  });

  root.querySelector('#pick-bg').addEventListener('click', async () => {
    const asset = await pickAsset();
    if (!asset) return;
    scene.backgroundAssetId = asset.id;
    await save();
    await rebuildRuntime();
  });

  root.querySelector('#add-character-btn').addEventListener('click', async () => {
    const charId = charSelect.value;
    if (!charId) return alert('Create a character first, in the Characters tab.');
    const character = characterById.get(charId);
    const { order } = getCharacterPoses(character || {});
    const entity = {
      id: uid('entity'),
      kind: 'character',
      refId: charId,
      name: character?.name || 'Character',
      x: 1280,
      y: 1080,
      scale: 0.32,
      baseScale: 0.32,
      poseSequence: [order[0]],
      z: nextZ(),
    };
    scene.entities.push(entity);
    await save();
    await rebuildRuntime();
    refreshCameraSelect();
    selectEntity(entity.id);
  });

  root.querySelector('#add-object-btn').addEventListener('click', async () => {
    const objId = objSelect.value;
    if (!objId) return alert('Create an object first, in the Characters tab.');
    const entity = {
      id: uid('entity'),
      kind: 'object',
      refId: objId,
      name: objectById.get(objId)?.name || 'Object',
      x: 1280,
      y: 1224,
      scale: 0.18,
      baseScale: 0.18,
      hasShadow: false,
      solid: false,
      z: nextZ(),
    };
    scene.entities.push(entity);
    await save();
    await rebuildRuntime();
    selectEntity(entity.id);
  });

  function nextZ() {
    return scene.entities.reduce((max, e) => Math.max(max, e.z ?? 0), 0) + 1;
  }

  async function save() {
    scene.updatedAt = Date.now();
    await putRecord('scenes', scene);
  }

  async function rebuildRuntime() {
    runtime = new SceneRuntime(scene, characterById, objectById);
    await runtime.preload();
    renderEntityList();
    drawFrame();
  }

  function renderEntityList() {
    const list = root.querySelector('#entity-list');
    list.innerHTML = '';
    if (scene.entities.length === 0) {
      list.innerHTML = '<div class="empty-state">Nothing placed yet.</div>';
    }
    for (const entity of [...scene.entities].sort((a, b) => b.z - a.z)) {
      const row = document.createElement('div');
      row.className = 'entity-item' + (entity.id === selectedEntityId ? ' selected' : '');
      row.innerHTML = `<span>${entity.kind === 'character' ? '🧑' : '📦'} ${escapeHtml(entity.name)}</span>`;
      row.addEventListener('click', () => selectEntity(entity.id));
      list.appendChild(row);
    }
    renderEntityControls();
  }

  function renderEntityControls() {
    const el = root.querySelector('#entity-controls');
    const entity = scene.entities.find((e) => e.id === selectedEntityId);
    if (!entity) {
      el.innerHTML = '';
      return;
    }
    // baseScale is "1x" for this entity — its scale when placed. Entities
    // saved before this existed fall back to their current scale as 1x, so
    // they don't jump in size the first time they're selected.
    entity.baseScale = entity.baseScale || entity.scale;
    const multiplier = entity.scale / entity.baseScale;
    el.innerHTML = `
      <div class="stack">
        <label>Scale <span id="scale-label">${formatMultiplier(multiplier)}</span>
          <input type="range" min="0.5" max="4" step="0.5" value="${multiplier}" id="ent-scale" />
        </label>
        ${
          entity.kind === 'object'
            ? `<label class="row" style="gap:6px;"><input type="checkbox" id="ent-shadow" ${entity.hasShadow ? 'checked' : ''} /> Shadow</label>
               <label class="row" style="gap:6px;"><input type="checkbox" id="ent-solid" ${entity.solid ? 'checked' : ''} /> Solid (blocks characters)</label>`
            : ''
        }
        ${entity.kind === 'character' ? '<div id="pose-sequence-editor"></div>' : ''}
        <div class="row">
          <button class="btn small" id="ent-back">Send back</button>
          <button class="btn small" id="ent-front">Bring front</button>
          <button class="btn small danger" id="ent-del">Remove</button>
        </div>
      </div>
    `;
    el.querySelector('#ent-scale').addEventListener('input', async (e) => {
      const m = parseFloat(e.target.value);
      entity.scale = entity.baseScale * m;
      el.querySelector('#scale-label').textContent = formatMultiplier(m);
      await save();
      drawFrame();
    });
    el.querySelector('#ent-shadow')?.addEventListener('change', async (e) => {
      entity.hasShadow = e.target.checked;
      await save();
      drawFrame();
    });
    el.querySelector('#ent-solid')?.addEventListener('change', async (e) => {
      entity.solid = e.target.checked;
      await save();
      drawFrame();
    });
    if (entity.kind === 'character') renderPoseSequenceEditor(entity);
    el.querySelector('#ent-back').addEventListener('click', async () => {
      const minZ = Math.min(...scene.entities.map((e) => e.z ?? 0));
      entity.z = minZ - 1;
      await save();
      renderEntityList();
      drawFrame();
    });
    el.querySelector('#ent-front').addEventListener('click', async () => {
      entity.z = nextZ();
      await save();
      renderEntityList();
      drawFrame();
    });
    el.querySelector('#ent-del').addEventListener('click', async () => {
      scene.entities = scene.entities.filter((e) => e.id !== entity.id);
      delete scene.tracks[entity.id];
      if (scene.cameraFollowEntityId === entity.id) scene.cameraFollowEntityId = null;
      selectedEntityId = null;
      await save();
      await rebuildRuntime();
      refreshCameraSelect();
    });
  }

  // The character's poses stepped through with LB/RB (or [ / ]) while
  // recording, in order, wrapping back to the start — built here as an
  // append-from-palette + remove-by-chip list rather than free reordering,
  // which covers the common case (an ordered, possibly-repeating loop like
  // idle -> hands-up -> idle -> running -> idle) with much less UI.
  function renderPoseSequenceEditor(entity) {
    const el = root.querySelector('#pose-sequence-editor');
    if (!el) return;
    const character = characterById.get(entity.refId);
    const { poses, order } = getCharacterPoses(character || {});
    if (!entity.poseSequence || entity.poseSequence.length === 0) entity.poseSequence = [order[0]];

    el.innerHTML = `
      <label style="margin-bottom:2px;">Pose sequence <span style="font-weight:400;color:var(--ink-soft);">(loops with LB/RB in Animate)</span></label>
      <div class="row" id="pose-seq-chips" style="flex-wrap:wrap;gap:4px;margin-bottom:6px;"></div>
      <div class="row" id="pose-seq-palette" style="flex-wrap:wrap;gap:4px;"></div>
    `;
    const chipsEl = el.querySelector('#pose-seq-chips');
    entity.poseSequence.forEach((poseId, i) => {
      const chip = document.createElement('button');
      chip.className = 'btn small success';
      chip.textContent = `${i + 1}. ${poses[poseId]?.name || '?'}`;
      chip.disabled = entity.poseSequence.length <= 1;
      chip.title = chip.disabled ? 'A sequence needs at least one pose' : 'Remove';
      chip.addEventListener('click', async () => {
        if (entity.poseSequence.length <= 1) return;
        entity.poseSequence.splice(i, 1);
        await save();
        renderPoseSequenceEditor(entity);
        drawFrame();
      });
      chipsEl.appendChild(chip);
    });
    const paletteEl = el.querySelector('#pose-seq-palette');
    for (const poseId of order) {
      const btn = document.createElement('button');
      btn.className = 'btn small secondary';
      btn.textContent = `+ ${poses[poseId]?.name || '?'}`;
      btn.addEventListener('click', async () => {
        entity.poseSequence.push(poseId);
        await save();
        renderPoseSequenceEditor(entity);
        drawFrame();
      });
      paletteEl.appendChild(btn);
    }
  }

  function selectEntity(id) {
    selectedEntityId = id;
    renderEntityList();
    drawFrame();
  }

  const canvas = root.querySelector('#stage');
  const ctx = canvas.getContext('2d');

  function drawFrame() {
    if (!runtime) return;
    runtime.render(ctx, 0, null, selectedEntityId, { fullWorld: true });
  }

  // The editor always shows the whole world zoomed out (fullWorld) so
  // everything can be placed at a glance, even a background much wider than
  // the standard frame — this mirrors exactly what SceneRuntime.render()
  // itself uses in that mode, so hit-testing/dragging line up with what's drawn.
  function transform() {
    return getWorldTransform(runtime?.worldWidth || REF_WIDTH, runtime?.worldHeight || REF_HEIGHT, STAGE_WIDTH, STAGE_HEIGHT, true);
  }

  function entityBounds(entity) {
    const { scale, offsetX, offsetY } = transform();
    const originX = offsetX + entity.x * scale;
    const originY = offsetY + entity.y * scale;
    const size = entity.scale * REF_HEIGHT * scale;
    if (entity.kind === 'character') {
      return { left: originX - size * 0.4, right: originX + size * 0.4, top: originY - size * FEET_ANCHOR_Y, bottom: originY };
    }
    const obj = objectById.get(entity.refId);
    const img = obj ? getCachedImage(obj.assetId) : null;
    const aspect = img ? img.width / img.height : 1;
    const dw = size * aspect;
    return { left: originX - dw / 2, right: originX + dw / 2, top: originY - size, bottom: originY };
  }

  function canvasPointFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function worldPointFromCanvas(pt) {
    const { scale, offsetX, offsetY } = transform();
    return { x: (pt.x - offsetX) / scale, y: (pt.y - offsetY) / scale };
  }

  canvas.addEventListener('pointerdown', (e) => {
    const pt = canvasPointFromEvent(e);
    const hit = [...scene.entities]
      .sort((a, b) => b.z - a.z)
      .find((entity) => {
        const b = entityBounds(entity);
        return pt.x >= b.left && pt.x <= b.right && pt.y >= b.top && pt.y <= b.bottom;
      });
    if (hit) {
      selectEntity(hit.id);
      const world = worldPointFromCanvas(pt);
      dragState = { id: hit.id, offsetX: world.x - hit.x, offsetY: world.y - hit.y };
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const pt = canvasPointFromEvent(e);
    const entity = scene.entities.find((en) => en.id === dragState.id);
    if (!entity) return;
    const world = worldPointFromCanvas(pt);
    const clamped = clampToBounds(
      world.x - dragState.offsetX,
      world.y - dragState.offsetY,
      runtime?.worldWidth || REF_WIDTH,
      runtime?.worldHeight || REF_HEIGHT
    );
    entity.x = clamped.x;
    entity.y = clamped.y;
    drawFrame();
  });
  const onWindowPointerUp = async () => {
    if (!dragState) return;
    dragState = null;
    await save();
  };
  window.addEventListener('pointerup', onWindowPointerUp);

  await rebuildRuntime();

  return () => {
    window.removeEventListener('pointerup', onWindowPointerUp);
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatMultiplier(m) {
  const rounded = Math.round(m * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}x`;
}
