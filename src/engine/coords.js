// Shared reference coordinate space: every entity position (and all movement
// physics) is stored as absolute pixels in this fixed 2560x1440 frame, which
// matches the native resolution of the sample background. Render targets of
// any size (the 1280x720 live stage, a 1920x1080 export) are just a uniform
// scale of this space, so speed/acceleration stay isotropic regardless of
// output resolution.
export const REF_WIDTH = 2560;
export const REF_HEIGHT = 1440;

// Characters are kept within the walkable ground area of the sample scenes
// (below the horizon/grass) and a small margin from the left/right edges,
// expressed as fractions so they scale with a scrollable world's actual size
// (see computeWorldSize below) instead of always being pinned to one
// standard-sized frame's worth of space.
const BOUNDS_X_MARGIN_FRACTION = 0.02;
const BOUNDS_Y_MIN_FRACTION = 0.35;
const BOUNDS_Y_MAX_FRACTION = 0.98;

export function clampToBounds(x, y, worldWidth = REF_WIDTH, worldHeight = REF_HEIGHT) {
  return {
    x: Math.max(BOUNDS_X_MARGIN_FRACTION * worldWidth, Math.min(worldWidth - BOUNDS_X_MARGIN_FRACTION * worldWidth, x)),
    y: Math.max(BOUNDS_Y_MIN_FRACTION * worldHeight, Math.min(BOUNDS_Y_MAX_FRACTION * worldHeight, y)),
  };
}

// A scene's world uses the background's own native pixel dimensions
// directly as its size on each axis independently (1:1 — one image pixel is
// one reference-space pixel), floored at the standard frame size. A
// background at least as big as the standard frame on an axis is drawn at
// its true size on that axis with zero distortion, and the excess beyond
// REF_WIDTH/REF_HEIGHT becomes that axis's scrollable range; an undersized
// axis is stretched up to the standard size to fill the frame (matching
// this app's original behavior, before scrolling existed, of always
// stretching a background to fill the frame exactly). Crucially, an image
// bigger than standard in *both* dimensions gets a world bigger in both —
// unlike a "cover"-style single scale factor, which can only ever leave one
// axis with excess, this is what actually makes true diagonal scrolling
// possible for a background sized for it (e.g. a big single-image map). A
// background at exactly REF_WIDTH x REF_HEIGHT (the common case, and every
// background before this feature existed) yields that back exactly, so
// nothing scrolls and existing scenes are pixel-for-pixel unaffected.
export function computeWorldSize(bgImg) {
  if (!bgImg || !bgImg.width || !bgImg.height) return { width: REF_WIDTH, height: REF_HEIGHT };
  return {
    width: Math.max(REF_WIDTH, Math.round(bgImg.width)),
    height: Math.max(REF_HEIGHT, Math.round(bgImg.height)),
  };
}

// Maps the shared reference space to canvas pixels. In windowed ("camera")
// mode the viewport is always exactly REF_WIDTH x REF_HEIGHT reference units
// (that's the definition of the camera's zoom level) uniformly scaled to the
// canvas, with panning handled separately by offsetting by the camera's
// position before scaling. In "full world" mode (the scene editor, so
// everything can be placed at a glance) the *entire* world is scaled to fit
// inside the canvas instead, letterboxing whichever axis has slack once the
// other is fully used.
export function getWorldTransform(worldWidth, worldHeight, canvasWidth, canvasHeight, fullWorld) {
  if (fullWorld) {
    const scale = Math.min(canvasWidth / worldWidth, canvasHeight / worldHeight);
    return {
      scale,
      offsetX: (canvasWidth - worldWidth * scale) / 2,
      offsetY: (canvasHeight - worldHeight * scale) / 2,
    };
  }
  return { scale: canvasWidth / REF_WIDTH, offsetX: 0, offsetY: 0 };
}
