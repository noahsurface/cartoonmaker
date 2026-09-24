import { getAll, getRecord, putRecord, deleteRecord, getAssetUrl, uid } from '../db.js';
import { pickAsset } from './asset-picker.js';
import { getCharacterPoses } from '../engine/character.js';

const LAYER_DEFS = [
  { key: 'mouth', title: 'Mouth', help: 'Pick one silent/closed pose, and the frames that make up the talking loop (played while the talk button is held).' },
  { key: 'eyes', title: 'Eyes', help: 'Pick a forward-facing frame, a sideways-look frame, and a blink frame.' },
];

function blankLayer() {
  return { frames: [], roles: {} };
}

function blankCharacter(name) {
  const poseId = uid('pose');
  return {
    id: uid('character'),
    name,
    createdAt: Date.now(),
    poses: { [poseId]: { name: 'Idle', ...blankLayer() } },
    poseOrder: [poseId],
    layers: { mouth: blankLayer(), eyes: blankLayer() },
  };
}

// Characters saved before poses existed only have `layers.body` — convert
// that in place into an equivalent single-pose shape the first time the
// character is opened in the builder. Rendering already tolerates the old
// shape read-only (see getCharacterPoses in engine/character.js); this is
// the one place that actually persists the migration.
async function migrateToPoses(character) {
  if (character.poses && character.poseOrder?.length) return character;
  const poseId = uid('pose');
  character.poses = { [poseId]: { name: 'Idle', ...(character.layers?.body || blankLayer()) } };
  character.poseOrder = [poseId];
  if (character.layers) delete character.layers.body;
  await putRecord('characters', character);
  return character;
}

export async function render(root, params) {
  let editingCharacterId = params.id || null;
  let editingObjectId = null;

  async function renderList() {
    const [characters, objects] = await Promise.all([getAll('characters'), getAll('objects')]);
    root.innerHTML = `
      <h1>Characters &amp; Objects</h1>
      <p class="lead">Characters are puppeteered live (body + mouth + eyes layers). Objects are simple props you can place in a scene.</p>

      <div class="panel">
        <div class="row between">
          <h2 style="margin:0">Characters</h2>
          <button class="btn accent" id="new-character">+ New character</button>
        </div>
        <div class="grid cols-auto" id="character-grid" style="margin-top:12px;"></div>
      </div>

      <div class="panel">
        <div class="row between">
          <h2 style="margin:0">Objects</h2>
          <button class="btn accent" id="new-object">+ New object</button>
        </div>
        <div class="grid cols-auto" id="object-grid" style="margin-top:12px;"></div>
      </div>
    `;

    const charGrid = root.querySelector('#character-grid');
    if (characters.length === 0) {
      charGrid.innerHTML = '<div class="empty-state">No characters yet.</div>';
    }
    for (const character of characters) {
      const { poses, order } = getCharacterPoses(character);
      const firstPose = poses[order[0]];
      const idleId = firstPose?.roles?.idle;
      const idleFrame = firstPose?.frames?.find((f) => f.id === idleId) || firstPose?.frames?.[0];
      const url = idleFrame ? await getAssetUrl(idleFrame.assetId) : null;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="thumb">${url ? `<img src="${url}" />` : '<span style="font-size:2rem">🧑</span>'}</div>
        <div class="label"><span>${escapeHtml(character.name)}</span>
          <button class="btn danger small icon-only" data-del>✕</button>
        </div>`;
      card.addEventListener('click', () => {
        editingCharacterId = character.id;
        renderEditor();
      });
      card.querySelector('[data-del]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete character "${character.name}"?`)) {
          await deleteRecord('characters', character.id);
          renderList();
        }
      });
      charGrid.appendChild(card);
    }

    const objGrid = root.querySelector('#object-grid');
    if (objects.length === 0) {
      objGrid.innerHTML = '<div class="empty-state">No objects yet.</div>';
    }
    for (const obj of objects) {
      const url = obj.assetId ? await getAssetUrl(obj.assetId) : null;
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="thumb">${url ? `<img src="${url}" />` : '<span style="font-size:2rem">📦</span>'}</div>
        <div class="label"><span>${escapeHtml(obj.name)}</span>
          <button class="btn danger small icon-only" data-del>✕</button>
        </div>`;
      card.addEventListener('click', () => {
        editingObjectId = obj.id;
        renderEditor();
      });
      card.querySelector('[data-del]').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (confirm(`Delete object "${obj.name}"?`)) {
          await deleteRecord('objects', obj.id);
          renderList();
        }
      });
      objGrid.appendChild(card);
    }

    root.querySelector('#new-character').addEventListener('click', async () => {
      const name = prompt('Character name', 'New Character') || 'New Character';
      const character = blankCharacter(name);
      await putRecord('characters', character);
      editingCharacterId = character.id;
      renderEditor();
    });
    root.querySelector('#new-object').addEventListener('click', async () => {
      const name = prompt('Object name', 'New Object') || 'New Object';
      const asset = await pickAsset();
      if (!asset) return;
      const obj = { id: uid('object'), name, assetId: asset.id, createdAt: Date.now() };
      await putRecord('objects', obj);
      renderList();
    });
  }

  async function renderEditor() {
    if (editingObjectId) return renderObjectEditor();
    let character = await getRecord('characters', editingCharacterId);
    if (!character) {
      editingCharacterId = null;
      return renderList();
    }
    character = await migrateToPoses(character);
    for (const def of LAYER_DEFS) {
      if (!character.layers[def.key]) character.layers[def.key] = blankLayer();
    }

    root.innerHTML = `
      <div class="row between">
        <h1 style="margin:0">
          <input id="char-name" type="text" value="${escapeHtml(character.name)}" style="font-size:1.4rem; font-weight:800; border:none; border-bottom: 2px dashed var(--border); background:transparent;" />
        </h1>
        <button class="btn secondary" id="back-btn">← Back to library</button>
      </div>
      <div class="panel">
        <div class="row between">
          <h2 style="margin:0">Poses</h2>
          <button class="btn small" id="add-pose">+ Add pose</button>
        </div>
        <p style="font-size:0.78rem;color:var(--ink-soft);margin-top:-4px;">Each pose is its own body — an idle frame, and any number of frames to cycle through while moving. In a scene, a character's poses can be stepped through in a set order with the left/right bumper (or the [ / ] keys).</p>
        <div id="pose-blocks" class="layer-editor"></div>
      </div>
      <div class="layer-editor" id="layer-editor"></div>
    `;

    root.querySelector('#back-btn').addEventListener('click', () => {
      editingCharacterId = null;
      renderList();
    });
    root.querySelector('#char-name').addEventListener('change', async (e) => {
      character.name = e.target.value || 'Untitled';
      await putRecord('characters', character);
    });
    root.querySelector('#add-pose').addEventListener('click', async () => {
      const name = prompt('Pose name (e.g. "Hands up", "Running")', 'New pose') || 'New pose';
      const poseId = uid('pose');
      character.poses[poseId] = { name, ...blankLayer() };
      character.poseOrder.push(poseId);
      await putRecord('characters', character);
      await renderEditor();
    });

    const poseBlocksEl = root.querySelector('#pose-blocks');
    for (const poseId of character.poseOrder) {
      poseBlocksEl.appendChild(await buildPoseBlock(character, poseId));
    }

    const layerEditorEl = root.querySelector('#layer-editor');
    for (const def of LAYER_DEFS) {
      layerEditorEl.appendChild(await buildLayerBlock(character, def));
    }
  }

  async function buildPoseBlock(character, poseId) {
    const pose = character.poses[poseId];
    const block = document.createElement('div');
    block.className = 'layer-block';
    block.innerHTML = `
      <h3>
        <input class="pose-name" type="text" value="${escapeHtml(pose.name || 'Pose')}" style="font-size:1rem;font-weight:700;border:none;border-bottom:2px dashed var(--border);background:transparent;width:140px;" />
        <button class="btn small" data-add>+ Add frame</button>
        <button class="btn small danger" data-del-pose>Delete pose</button>
      </h3>
      <div class="frame-strip" data-frames></div>
      <div data-roles></div>
    `;

    block.querySelector('.pose-name').addEventListener('change', async (e) => {
      pose.name = e.target.value || 'Pose';
      await putRecord('characters', character);
    });
    block.querySelector('[data-del-pose]').addEventListener('click', async () => {
      if (character.poseOrder.length <= 1) {
        alert('A character needs at least one pose.');
        return;
      }
      if (!confirm(`Delete pose "${pose.name}"? Any scene using it will fall back to another pose.`)) return;
      delete character.poses[poseId];
      character.poseOrder = character.poseOrder.filter((id) => id !== poseId);
      await putRecord('characters', character);
      await renderEditor();
    });

    block.querySelector('[data-add]').addEventListener('click', async () => {
      const asset = await pickAsset();
      if (!asset) return;
      const label = prompt('Label this frame (e.g. "idle", "move 1")', asset.name) || asset.name;
      pose.frames.push({ id: uid('frame'), label, assetId: asset.id });
      await putRecord('characters', character);
      await refreshPoseBlock();
    });

    async function refreshPoseBlock() {
      const framesEl = block.querySelector('[data-frames]');
      framesEl.innerHTML = '';
      for (const frame of pose.frames) {
        const url = await getAssetUrl(frame.assetId);
        const thumb = document.createElement('div');
        thumb.className = 'frame-thumb';
        thumb.title = frame.label;
        thumb.innerHTML = `<img src="${url}" /><span class="del">✕</span>`;
        thumb.querySelector('.del').addEventListener('click', async () => {
          pose.frames = pose.frames.filter((f) => f.id !== frame.id);
          removeFrameFromRoles(pose, frame.id);
          await putRecord('characters', character);
          await refreshPoseBlock();
        });
        framesEl.appendChild(thumb);
      }
      const rolesEl = block.querySelector('[data-roles]');
      rolesEl.innerHTML = '';
      rolesEl.appendChild(buildSingleRolePicker(pose, 'idle', 'Idle frame', character));
      rolesEl.appendChild(buildOrderedRolePicker(pose, 'cycle', character, refreshPoseBlock));
    }

    await refreshPoseBlock();
    return block;
  }

  async function buildLayerBlock(character, def) {
    const layer = character.layers[def.key];
    const block = document.createElement('div');
    block.className = 'layer-block';
    block.innerHTML = `
      <h3>${def.title} <button class="btn small" data-add>+ Add frame</button></h3>
      <p style="font-size:0.78rem;color:var(--ink-soft);margin-top:-4px;">${def.help}</p>
      <div class="frame-strip" data-frames></div>
      <div data-roles></div>
    `;

    block.querySelector('[data-add]').addEventListener('click', async () => {
      const asset = await pickAsset();
      if (!asset) return;
      const label = prompt('Label this frame (e.g. "idle", "talk 1")', asset.name) || asset.name;
      layer.frames.push({ id: uid('frame'), label, assetId: asset.id });
      await putRecord('characters', character);
      await refreshLayerBlock();
    });

    async function refreshLayerBlock() {
      const framesEl = block.querySelector('[data-frames]');
      framesEl.innerHTML = '';
      for (const frame of layer.frames) {
        const url = await getAssetUrl(frame.assetId);
        const thumb = document.createElement('div');
        thumb.className = 'frame-thumb';
        thumb.title = frame.label;
        thumb.innerHTML = `<img src="${url}" /><span class="del">✕</span>`;
        thumb.querySelector('.del').addEventListener('click', async () => {
          layer.frames = layer.frames.filter((f) => f.id !== frame.id);
          removeFrameFromRoles(layer, frame.id);
          await putRecord('characters', character);
          await refreshLayerBlock();
        });
        framesEl.appendChild(thumb);
      }

      const rolesEl = block.querySelector('[data-roles]');
      rolesEl.innerHTML = '';
      if (def.key === 'mouth') {
        rolesEl.appendChild(buildSingleRolePicker(layer, 'silent', 'Silent frame', character));
        rolesEl.appendChild(buildOrderedRolePicker(layer, 'talk', character, refreshLayerBlock));
      } else if (def.key === 'eyes') {
        rolesEl.appendChild(buildSingleRolePicker(layer, 'forward', 'Forward frame', character));
        rolesEl.appendChild(buildSingleRolePicker(layer, 'side', 'Side-look frame', character));
        rolesEl.appendChild(buildSingleRolePicker(layer, 'blink', 'Blink frame', character));
      }
    }

    await refreshLayerBlock();
    return block;
  }

  function buildSingleRolePicker(layer, roleKey, label, character) {
    const wrap = document.createElement('div');
    wrap.className = 'role-row';
    const select = document.createElement('select');
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '(none)';
    select.appendChild(noneOpt);
    for (const frame of layer.frames) {
      const opt = document.createElement('option');
      opt.value = frame.id;
      opt.textContent = frame.label;
      if (layer.roles[roleKey] === frame.id) opt.selected = true;
      select.appendChild(opt);
    }
    select.addEventListener('change', async () => {
      layer.roles[roleKey] = select.value || undefined;
      await putRecord('characters', character);
    });
    wrap.innerHTML = `<span>${label}:</span>`;
    wrap.appendChild(select);
    return wrap;
  }

  function buildOrderedRolePicker(layer, roleKey, character, onChange) {
    const wrap = document.createElement('div');
    wrap.className = 'role-row';
    wrap.style.flexWrap = 'wrap';
    const order = layer.roles[roleKey] || (layer.roles[roleKey] = []);
    for (const frame of layer.frames) {
      const btn = document.createElement('button');
      const idx = order.indexOf(frame.id);
      btn.className = 'btn small' + (idx >= 0 ? ' success' : ' secondary');
      btn.textContent = idx >= 0 ? `${idx + 1}. ${frame.label}` : frame.label;
      btn.addEventListener('click', async () => {
        const i = order.indexOf(frame.id);
        if (i >= 0) order.splice(i, 1);
        else order.push(frame.id);
        await putRecord('characters', character);
        await onChange();
      });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function removeFrameFromRoles(layer, frameId) {
    for (const key of Object.keys(layer.roles)) {
      if (Array.isArray(layer.roles[key])) {
        layer.roles[key] = layer.roles[key].filter((id) => id !== frameId);
      } else if (layer.roles[key] === frameId) {
        layer.roles[key] = undefined;
      }
    }
  }

  async function renderObjectEditor() {
    const objects = await getAll('objects');
    const obj = objects.find((o) => o.id === editingObjectId);
    if (!obj) {
      editingObjectId = null;
      return renderList();
    }
    const url = await getAssetUrl(obj.assetId);
    root.innerHTML = `
      <div class="row between">
        <h1 style="margin:0">
          <input id="obj-name" type="text" value="${escapeHtml(obj.name)}" style="font-size:1.4rem; font-weight:800; border:none; border-bottom: 2px dashed var(--border); background:transparent;" />
        </h1>
        <button class="btn secondary" id="back-btn">← Back to library</button>
      </div>
      <div class="panel">
        <div class="card" style="max-width:220px;">
          <div class="thumb"><img src="${url}" /></div>
        </div>
        <button class="btn" id="change-img" style="margin-top:10px;">Change image</button>
      </div>
    `;
    root.querySelector('#back-btn').addEventListener('click', () => {
      editingObjectId = null;
      renderList();
    });
    root.querySelector('#obj-name').addEventListener('change', async (e) => {
      obj.name = e.target.value || 'Untitled';
      await putRecord('objects', obj);
    });
    root.querySelector('#change-img').addEventListener('click', async () => {
      const asset = await pickAsset();
      if (!asset) return;
      obj.assetId = asset.id;
      await putRecord('objects', obj);
      renderObjectEditor();
    });
  }

  if (editingCharacterId) await renderEditor();
  else await renderList();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
