import { getAll, getRecord, putRecord, deleteRecord, getAssetUrl, uid } from '../db.js';
import { navigate } from '../main.js';

export async function render(root) {
  const scenes = (await getAll('scenes')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

  root.innerHTML = `
    <div class="row between">
      <h1 style="margin:0">Scenes</h1>
      <button class="btn accent" id="new-scene">+ New scene</button>
    </div>
    <p class="lead">Each scene has one background plus any number of characters and objects.</p>
    <div class="grid cols-auto" id="scene-grid"></div>
  `;

  const grid = root.querySelector('#scene-grid');
  if (scenes.length === 0) {
    grid.innerHTML = '<div class="empty-state">No scenes yet — create one to get started.</div>';
  }
  for (const scene of scenes) {
    const url = scene.backgroundAssetId ? await getAssetUrl(scene.backgroundAssetId) : null;
    const card = document.createElement('div');
    card.className = 'card';
    const trackCount = Object.keys(scene.tracks || {}).length;
    const charCount = scene.entities.filter((e) => e.kind === 'character').length;
    card.innerHTML = `
      <div class="thumb">${url ? `<img src="${url}" />` : '<span style="font-size:2rem">🎬</span>'}</div>
      <div class="label"><span>${escapeHtml(scene.name)}</span></div>
      <div class="row" style="padding: 8px; padding-top:0; font-size:0.72rem; color:var(--ink-soft);">
        ${charCount} character${charCount === 1 ? '' : 's'} · ${trackCount} recorded
      </div>
      <div class="row" style="padding: 0 8px 8px;">
        <button class="btn small" data-edit>Edit</button>
        <button class="btn small accent" data-animate>Animate</button>
        <button class="btn small success" data-export>Export</button>
        <button class="btn small danger icon-only" data-del>✕</button>
      </div>
    `;
    card.querySelector('[data-edit]').addEventListener('click', () => navigate('editor', { id: scene.id }));
    card.querySelector('[data-animate]').addEventListener('click', () => navigate('puppet', { id: scene.id }));
    card.querySelector('[data-export]').addEventListener('click', () => navigate('export', { id: scene.id }));
    card.querySelector('[data-del]').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (confirm(`Delete scene "${scene.name}"? This can't be undone.`)) {
        await deleteRecord('scenes', scene.id);
        render(root);
      }
    });
    grid.appendChild(card);
  }

  root.querySelector('#new-scene').addEventListener('click', async () => {
    const name = prompt('Scene name', 'New Scene') || 'New Scene';
    const scene = {
      id: uid('scene'),
      name,
      backgroundAssetId: null,
      entities: [],
      tracks: {},
      updatedAt: Date.now(),
    };
    await putRecord('scenes', scene);
    navigate('editor', { id: scene.id });
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
