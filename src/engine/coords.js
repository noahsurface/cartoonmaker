// Shared reference coordinate space: every entity position (and all movement
// physics) is stored as absolute pixels in this fixed 2560x1440 frame, which
// matches the native resolution of the sample background. Render targets of
// any size (the 1280x720 live stage, a 1920x1080 export) are just a uniform
// scale of this space, so speed/acceleration stay isotropic regardless of
// output resolution.
export const REF_WIDTH = 2560;
export const REF_HEIGHT = 1440;

// Characters are kept within the walkable ground area of the sample scenes
// (below the horizon/grass) and a small margin from the left/right edges.
export const BOUNDS_X_MARGIN = 0.02 * REF_WIDTH;
export const BOUNDS_Y_MIN = 0.35 * REF_HEIGHT;
export const BOUNDS_Y_MAX = 0.98 * REF_HEIGHT;

export function clampToBounds(x, y, worldWidth = REF_WIDTH) {
  return {
    x: Math.max(BOUNDS_X_MARGIN, Math.min(worldWidth - BOUNDS_X_MARGIN, x)),
    y: Math.max(BOUNDS_Y_MIN, Math.min(BOUNDS_Y_MAX, y)),
  };
}

// A scene's background is drawn at its own native aspect ratio rather than
// stretched to fill the frame, so a background wider (relative to its
// height) than the standard REF_WIDTH:REF_HEIGHT frame implies a world wider
// than the camera's viewport — the excess width is scrollable. A background
// at or narrower than the standard aspect (the common case, and every
// background before this feature existed) yields exactly REF_WIDTH back, so
// nothing scrolls and existing scenes are unaffected.
export function computeWorldWidth(bgImg) {
  if (!bgImg || !bgImg.width || !bgImg.height) return REF_WIDTH;
  return Math.max(REF_WIDTH, Math.round(REF_HEIGHT * (bgImg.width / bgImg.height)));
}

// Maps the shared reference space to canvas pixels. In windowed ("camera")
// mode the viewport is always exactly REF_WIDTH x REF_HEIGHT reference units
// (that's the definition of the camera's zoom level) uniformly scaled to the
// canvas, with panning handled separately by offsetting x by the camera's
// position before scaling. In "full world" mode (the scene editor, so
// everything can be placed at a glance) the *entire* world width is scaled
// to fit the canvas width instead, letterboxing top/bottom if the world is
// wider than the standard aspect.
export function getWorldTransform(worldWidth, canvasWidth, canvasHeight, fullWorld) {
  if (fullWorld) {
    const scale = canvasWidth / worldWidth;
    return { scale, offsetY: (canvasHeight - REF_HEIGHT * scale) / 2 };
  }
  return { scale: canvasWidth / REF_WIDTH, offsetY: 0 };
}
