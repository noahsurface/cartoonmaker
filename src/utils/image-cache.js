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

// How much of an image's canvas its actual (non-transparent) content
// occupies — used to size a shadow to a character/object's real silhouette
// width rather than the padded square the art is drawn on, and to anchor a
// shadow at an object's actual visual base rather than the bottom edge of
// its (possibly padded) image file. Computed once per image and cached,
// since scanning pixels every frame would be wasteful and the art doesn't
// change.
//
// - widthFraction: content width / full image width.
// - bottomFraction: how far down the content's lowest non-transparent pixel
//   sits, as a fraction of the full image height (1 = touches the very
//   bottom row, i.e. no padding below the visible content).
const contentMetricsCache = new WeakMap();

export function getContentMetrics(img) {
  if (!img || !img.width || !img.height) return { widthFraction: 1, bottomFraction: 1 };
  if (contentMetricsCache.has(img)) return contentMetricsCache.get(img);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  let widthFraction = 1;
  let bottomFraction = 1;
  try {
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    let minX = img.width;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < img.height; y++) {
      const rowStart = y * img.width;
      for (let x = 0; x < img.width; x++) {
        if (data[(rowStart + x) * 4 + 3] > 10) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX >= minX) widthFraction = (maxX - minX + 1) / img.width;
    if (maxY >= 0) bottomFraction = (maxY + 1) / img.height;
  } catch (err) {
    // Cross-origin or otherwise unreadable canvas — fall back to the full image bounds.
    console.warn('Could not measure image content bounds', err);
  }
  const metrics = { widthFraction, bottomFraction };
  contentMetricsCache.set(img, metrics);
  return metrics;
}
