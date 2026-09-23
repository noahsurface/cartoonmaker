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

export function clampToBounds(x, y) {
  return {
    x: Math.max(BOUNDS_X_MARGIN, Math.min(REF_WIDTH - BOUNDS_X_MARGIN, x)),
    y: Math.max(BOUNDS_Y_MIN, Math.min(BOUNDS_Y_MAX, y)),
  };
}
