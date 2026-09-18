// A small modal for picking an existing image asset (used by the character
// builder when assigning artwork to a layer frame).
import { getAll, getAssetUrl, importAssetFile } from '../db.js';

export function pickAsset() {
  return new Promise(async (resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;z-index:100;padding:20px;';

    const box = document.createElement('div');
    box.className = 'panel';
    box.style.cssText = 'max-width:640px;width:100%;max-height:80vh;overflow:auto;margin:0;';
    box.innerHTML = `
      <div class="row between">
        <h2 style="margin:0">Choose image</h2>
        <button class="btn secondary small" id="picker-close">Close</button>
      </div>
      <div class="panel" style="margin: 10px 0;">
        <label class="btn small">
          Upload new image
          <input type="file" accept="image/*" style="display:none" id="picker-upload" />
        </label>
      </div>
      <div class="grid cols-auto" id="picker-grid"></div>
    `;
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    function close(result) {
      document.body.removeChild(overlay);
      resolve(result || null);
    }

    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(null);
    });
    box.querySelector('#picker-close').addEventListener('click', () => close(null));
    box.querySelector('#picker-upload').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const asset = await importAssetFile(file);
      close(asset);
    });

    const grid = box.querySelector('#picker-grid');
    const assets = (await getAll('assets')).sort((a, b) => b.createdAt - a.createdAt);
    if (assets.length === 0) {
      grid.innerHTML = '<div class="empty-state">No assets yet. Upload one above.</div>';
    }
    for (const asset of assets) {
      const url = await getAssetUrl(asset.id);
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `<div class="thumb"><img src="${url}" /></div><div class="label"><span>${escapeHtml(asset.name)}</span></div>`;
      card.addEventListener('click', () => close(asset));
      grid.appendChild(card);
    }
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
