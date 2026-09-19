import { getRecord, putRecord, getAll, uid } from '../db.js';
import { navigate } from '../main.js';
import { SceneRuntime, STAGE_WIDTH, STAGE_HEIGHT } from '../engine/scene.js';
import { FEET_ANCHOR_Y } from '../engine/character.js';
import { REF_WIDTH, clampToBounds } from '../engine/coords.js';
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
    const entity = {
      id: uid('entity'),
      kind: 'character',
      refId: charId,
      name: characterById.get(charId)?.name || 'Character',
      x: 1280,
      y: 1080,
      scale: 0.32,
      z: nextZ(),
    };
    scene.entities.push(entity);
    await save();
    await rebuildRuntime();
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
    el.innerHTML = `
      <div class="stack">
        <label>Scale <input type="range" min="0.08" max="0.9" step="0.01" value="${entity.scale}" id="ent-scale" /></label>
        <div class="row">
          <button class="btn small" id="ent-back">Send back</button>
          <button class="btn small" id="ent-front">Bring front</button>
          <button class="btn small danger" id="ent-del">Remove</button>
        </div>
      </div>
    `;
    el.querySelector('#ent-scale').addEventListener('input', async (e) => {
      entity.scale = parseFloat(e.target.value);
      await save();
      drawFrame();
    });
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
      selectedEntityId = null;
      await save();
      await rebuildRuntime();
    });
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
    runtime.render(ctx, 0, null, selectedEntityId);
  }

  // Canvas pixels and reference-space pixels differ by a fixed uniform
  // factor (canvas aspect always matches REF_WIDTH x REF_HEIGHT).
  const refScale = STAGE_WIDTH / REF_WIDTH;

  function entityBounds(entity) {
    const w = STAGE_WIDTH;
    const h = STAGE_HEIGHT;
    const originX = entity.x * refScale;
    const originY = entity.y * refScale;
    const size = entity.scale * h;
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
      dragState = { id: hit.id, offsetX: pt.x / refScale - hit.x, offsetY: pt.y / refScale - hit.y };
      canvas.setPointerCapture(e.pointerId);
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const pt = canvasPointFromEvent(e);
    const entity = scene.entities.find((en) => en.id === dragState.id);
    if (!entity) return;
    const clamped = clampToBounds(pt.x / refScale - dragState.offsetX, pt.y / refScale - dragState.offsetY);
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
