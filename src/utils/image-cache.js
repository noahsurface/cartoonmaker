// In-memory cache of decoded <img> elements keyed by asset id, so the render
// loop can draw synchronously every frame without re-awaiting blob URLs.
import { getAssetUrl } from '../db.js';

const cache = new Map();
const pending = new Map();

export async function preloadImage(assetId) {
  if (!assetId) return null;
  if (cache.has(assetId)) return cache.get(assetId);
  if (pending.has(assetId)) return pending.get(assetId);
  const promise = (async () => {
    const url = await getAssetUrl(assetId);
    if (!url) return null;
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = reject;
      img.src = url;
    });
    cache.set(assetId, img);
    pending.delete(assetId);
    return img;
  })();
  pending.set(assetId, promise);
  return promise;
}

export function getCachedImage(assetId) {
  return cache.get(assetId) || null;
}

export async function preloadMany(assetIds) {
  const unique = Array.from(new Set(assetIds.filter(Boolean)));
  await Promise.all(unique.map(preloadImage));
}
