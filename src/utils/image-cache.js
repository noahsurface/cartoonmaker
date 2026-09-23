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

// How wide an image's actual (non-transparent) content is, as a fraction of
// its full canvas width — used to size the shadow to the character's real
// silhouette rather than the padded square the art is drawn on. Computed
// once per image and cached, since scanning pixels every frame would be
// wasteful and the art doesn't change.
const widthFractionCache = new WeakMap();

export function getContentWidthFraction(img) {
  if (!img || !img.width || !img.height) return 1;
  if (widthFractionCache.has(img)) return widthFractionCache.get(img);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  let fraction = 1;
  try {
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    let minX = img.width;
    let maxX = -1;
    for (let y = 0; y < img.height; y++) {
      const rowStart = y * img.width;
      for (let x = 0; x < img.width; x++) {
        if (data[(rowStart + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }
    if (maxX >= minX) fraction = (maxX - minX + 1) / img.width;
  } catch (err) {
    // Cross-origin or otherwise unreadable canvas — fall back to the full width.
    console.warn('Could not measure image content width', err);
  }
  widthFractionCache.set(img, fraction);
  return fraction;
}
