import { getAll, putRecord, deleteRecord, getAssetUrl, importAssetFile, uid } from '../db.js';
import { SYSTEM_FOLDER_ID } from '../seed.js';

export async function render(root) {
  let dragCounter = 0;
  let activeFolderId = 'all'; // 'all' | 'unfiled' | a real folder id

  root.innerHTML = `
    <h1>Assets</h1>
    <p class="lead">Upload images to use as scene backgrounds, or as body/mouth/eyes artwork for characters. Organize them into folders to make them easier to find later — e.g. a "Backgrounds" folder makes picking a background much quicker.</p>
    <div class="editor-layout" style="grid-template-columns: 220px 1fr;">
      <div class="panel stack">
        <h2 style="margin-top:0;">Folders</h2>
        <div id="folder-list" class="stack"></div>
        <button class="btn small" id="new-folder-btn">+ New folder</button>
      </div>
      <div class="stack">
        <div class="panel">
          <div class="dropzone" id="dropzone">
            Drag &amp; drop image files here, or click to choose files
          </div>
          <input type="file" id="file-input" accept="image/*" multiple style="display:none" />
        </div>
        <div class="panel">
          <h2 id="library-heading">Library — All</h2>
          <div id="asset-grid" class="grid cols-auto"></div>
        </div>
      </div>
    </div>
  `;

  const dropzone = root.querySelector('#dropzone');
  const fileInput = root.querySelector('#file-input');
  const folderListEl = root.querySelector('#folder-list');
  const gridEl = root.querySelector('#asset-grid');
  const headingEl = root.querySelector('#library-heading');

  function folderLabel(folders, id) {
    if (id === 'all') return 'All';
    if (id === 'unfiled') return 'Unfiled';
    return folders.find((f) => f.id === id)?.name || 'Folder';
  }

  function renderFolderList(folders, assets) {
    folderListEl.innerHTML = '';
    const unfiledCount = assets.filter((a) => !a.folderId).length;
    const rows = [
      { id: 'all', name: `All (${assets.length})`, fixed: true },
      { id: 'unfiled', name: `Unfiled (${unfiledCount})`, fixed: true },
      ...folders.map((f) => ({ id: f.id, name: `${f.name} (${assets.filter((a) => a.folderId === f.id).length})`, fixed: f.id === SYSTEM_FOLDER_ID, raw: f })),
    ];
    for (const row of rows) {
      const item = document.createElement('div');
      item.className = 'row between' + (row.id === activeFolderId ? ' selected' : '');
      item.style.cssText = 'padding:6px 8px;border-radius:6px;cursor:pointer;' + (row.id === activeFolderId ? 'background:var(--accent-2);color:#fff;' : '');
      item.innerHTML = `<span>${escapeHtml(row.name)}</span>`;
      if (!row.fixed) {
        const delBtn = document.createElement('button');
        delBtn.className = 'btn danger small icon-only';
        delBtn.textContent = '✕';
        delBtn.title = `Delete "${row.raw.name}" (its assets become unfiled)`;
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!confirm(`Delete folder "${row.raw.name}"? Its assets will become unfiled, not deleted.`)) return;
          const inFolder = assets.filter((a) => a.folderId === row.id);
          for (const asset of inFolder) {
            asset.folderId = null;
            await putRecord('assets', asset);
          }
          await deleteRecord('folders', row.id);
          if (activeFolderId === row.id) activeFolderId = 'all';
          await refresh();
        });
        item.appendChild(delBtn);
      }
      item.addEventListener('click', () => {
        activeFolderId = row.id;
        refresh();
      });
      folderListEl.appendChild(item);
    }
  }

  async function renderGrid(assets, folders) {
    const filtered =
      activeFolderId === 'all'
        ? assets
        : activeFolderId === 'unfiled'
        ? assets.filter((a) => !a.folderId)
        : assets.filter((a) => a.folderId === activeFolderId);
    headingEl.textContent = `Library — ${folderLabel(folders, activeFolderId)}`;
    const sorted = [...filtered].sort((a, b) => b.createdAt - a.createdAt);
    if (sorted.length === 0) {
      gridEl.innerHTML = '<div class="empty-state">No assets here yet.</div>';
      return;
    }
    gridEl.innerHTML = '';
    for (const asset of sorted) {
      const url = await getAssetUrl(asset.id);
      const isImage = asset.mime?.startsWith('image/');
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div class="thumb">${isImage ? `<img src="${url}" alt="${escapeHtml(asset.name)}" />` : '<span style="font-size:2rem">🔊</span>'}</div>
        <div class="label" style="flex-direction:column;align-items:stretch;gap:4px;">
          <div class="row between">
            <span title="${escapeHtml(asset.name)}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(asset.name)}</span>
            <button class="btn danger small icon-only" title="Delete">✕</button>
          </div>
          <select style="font-size:0.72rem;">
            <option value="">(unfiled)</option>
            ${folders.map((f) => `<option value="${f.id}" ${asset.folderId === f.id ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}
          </select>
        </div>
      `;
      card.querySelector('select').addEventListener('change', async (e) => {
        asset.folderId = e.target.value || null;
        await putRecord('assets', asset);
        await refresh();
      });
      card.querySelector('button').addEventListener('click', async (e) => {
        e.stopPropagation();
        if (asset.id.startsWith('sample-asset-') || asset.id.startsWith('fx-asset-')) {
          alert('This is a bundled asset used by the app (starter content or a shared effect like the shadow/speech bubble), so it can\'t be deleted.');
          return;
        }
        if (confirm(`Delete "${asset.name}"? This can't be undone.`)) {
          await deleteRecord('assets', asset.id);
          await refresh();
        }
      });
      gridEl.appendChild(card);
    }
  }

  async function refresh() {
    const [assets, folders] = await Promise.all([getAll('assets'), getAll('folders')]);
    folders.sort((a, b) => (a.id === SYSTEM_FOLDER_ID ? -1 : b.id === SYSTEM_FOLDER_ID ? 1 : a.createdAt - b.createdAt));
    renderFolderList(folders, assets);
    await renderGrid(assets, folders);
  }

  root.querySelector('#new-folder-btn').addEventListener('click', async () => {
    const name = prompt('Folder name', 'New Folder');
    if (!name) return;
    await putRecord('folders', { id: uid('folder'), name, createdAt: Date.now() });
    await refresh();
  });

  async function handleFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    const folderId = activeFolderId === 'all' || activeFolderId === 'unfiled' ? null : activeFolderId;
    for (const file of files) {
      await importAssetFile(file, folderId);
    }
    await refresh();
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
