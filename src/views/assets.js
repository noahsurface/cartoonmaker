import { getAll, importAssetFile, deleteRecord, getAssetUrl } from '../db.js';

export async function render(root) {
  let dragCounter = 0;

  async function refresh() {
    const assets = (await getAll('assets')).sort((a, b) => b.createdAt - a.createdAt);
    const grid = root.querySelector('#asset-grid');
    if (assets.length === 0) {
      grid.innerHTML = '<div class="empty-state">No assets yet — upload a background or character artwork to get started.</div>';
      return;
    }
    grid.innerHTML = '';
    for (const asset of assets) {
      const url = await getAssetUrl(asset.id);
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="thumb"><img src="${url}" alt="${escapeHtml(asset.name)}" /></div>
        <div class="label"><span title="${escapeHtml(asset.name)}">${escapeHtml(asset.name)}</span>
          <button class="btn danger small icon-only" title="Delete">✕</button>
        </div>
      `;
      card.querySelector('button').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (asset.id.startsWith('sample-asset-')) {
          alert('This is a bundled sample asset used by the starter character/scene, so it can\'t be deleted.');
          return;
        }
        if (confirm(`Delete "${asset.name}"? This can't be undone.`)) {
          await deleteRecord('assets', asset.id);
          refresh();
        }
      });
      grid.appendChild(card);
    }
  }

  root.innerHTML = `
    <h1>Assets</h1>
    <p class="lead">Upload images to use as scene backgrounds, or as body/mouth/eyes artwork for characters.</p>
    <div class="panel">
      <div class="dropzone" id="dropzone">
        Drag &amp; drop image files here, or click to choose files
      </div>
      <input type="file" id="file-input" accept="image/*" multiple style="display:none" />
    </div>
    <div class="panel">
      <h2>Library</h2>
      <div id="asset-grid" class="grid cols-auto"></div>
    </div>
  `;

  const dropzone = root.querySelector('#dropzone');
  const fileInput = root.querySelector('#file-input');

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    for (const file of files) {
      await importAssetFile(file);
    }
    refresh();
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));

  dropzone.addEventListener('dragover', (e) => e.preventDefault());
  dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    dropzone.classList.add('drag');
  });
  dropzone.addEventListener('dragleave', () => {
    dragCounter = Math.max(0, dragCounter - 1);
    if (dragCounter === 0) dropzone.classList.remove('drag');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dragCounter = 0;
    dropzone.classList.remove('drag');
    if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
  });

  await refresh();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
