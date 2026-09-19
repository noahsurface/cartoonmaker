// Composites a background with any number of character/object entities onto
// a canvas. Used identically by the scene editor (static preview), the
// puppeteering view (live + played-back tracks), and video export.
import { preloadImage, preloadMany, getCachedImage } from '../utils/image-cache.js';
import { CharacterAnimState, resolvePoseAssets, preloadCharacterImages, drawCharacter } from './character.js';
import { REF_WIDTH } from './coords.js';
import { FX_ASSET_IDS } from '../seed.js';

export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;

export class SceneRuntime {
  /**
   * @param {object} scene
   * @param {Map<string,object>} characterById
   * @param {Map<string,object>} objectById
   */
  constructor(scene, characterById, objectById) {
    this.scene = scene;
    this.characterById = characterById;
    this.objectById = objectById;
    this.animStates = new Map();
    this.fx = { shadowImg: null, bubbleFrames: [] };
    for (const entity of scene.entities) {
      if (entity.kind === 'character') {
        this.animStates.set(entity.id, new CharacterAnimState(entity.x, entity.y));
      }
    }
  }

  async preload() {
    const jobs = [preloadImage(this.scene.backgroundAssetId), preloadMany([FX_ASSET_IDS.shadow, ...FX_ASSET_IDS.bubble])];
    for (const entity of this.scene.entities) {
      if (entity.kind === 'character') {
        const character = this.characterById.get(entity.refId);
        if (character) jobs.push(preloadCharacterImages(character));
      } else if (entity.kind === 'object') {
        const obj = this.objectById.get(entity.refId);
        if (obj) jobs.push(preloadImage(obj.assetId));
      }
    }
    await Promise.all(jobs);
    this.fx = {
      shadowImg: getCachedImage(FX_ASSET_IDS.shadow),
      bubbleFrames: FX_ASSET_IDS.bubble.map((id) => getCachedImage(id)),
    };
  }

  getAnimState(entityId) {
    return this.animStates.get(entityId);
  }

  /**
   * Render one frame.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} dt seconds since last frame (0 for a static/paused draw)
   * @param {(entityId:string) => {x:number,y:number,mouthHeld:boolean}|null} resolvePose
   *   Returns the current live/playback pose sample for a character entity (position in the
   *   2560x1440 reference space), or null to leave it at rest at its placed position.
   * @param {string|null} highlightEntityId optional entity to draw a selection ring around
   */
  render(ctx, dt, resolvePose, highlightEntityId = null) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    const scale = w / REF_WIDTH; // uniform: canvas aspect always matches REF_WIDTH x REF_HEIGHT
    ctx.clearRect(0, 0, w, h);

    const bg = getCachedImage(this.scene.backgroundAssetId);
    if (bg) ctx.drawImage(bg, 0, 0, w, h);
    else {
      ctx.fillStyle = '#87ceeb';
      ctx.fillRect(0, 0, w, h);
    }

    const entities = [...this.scene.entities].sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

    for (const entity of entities) {
      if (entity.kind === 'character') {
        const character = this.characterById.get(entity.refId);
        if (!character) continue;
        const state = this.animStates.get(entity.id);
        const sample = resolvePose ? resolvePose(entity.id) : null;
        const x = sample ? sample.x : entity.x;
        const y = sample ? sample.y : entity.y;
        state.update(x, y, dt, sample?.mouthHeld ?? false);
        const pose = resolvePoseAssets(character, {
          moving: state.moving,
          mouthHeld: state.talking,
          poseClock: state.poseClock,
          eyesLook: state.eyesLook,
          blinking: state.isBlinking,
        });
        const size = entity.scale * h;
        drawCharacter(
          ctx,
          state,
          pose,
          {
            originX: x * scale,
            originY: y * scale,
            size,
          },
          this.fx
        );
        if (entity.id === highlightEntityId) {
          ctx.save();
          ctx.strokeStyle = '#2fa8ff';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 6]);
          ctx.strokeRect(x * scale - size * 0.4, y * scale - size * 0.95, size * 0.8, size * 0.95);
          ctx.restore();
        }
      } else if (entity.kind === 'object') {
        const obj = this.objectById.get(entity.refId);
        if (!obj) continue;
        const img = getCachedImage(obj.assetId);
        if (!img) continue;
        const size = entity.scale * h;
        const aspect = img.width / img.height || 1;
        const dw = size * aspect;
        const dh = size;
        const ox = entity.x * scale;
        const oy = entity.y * scale;
        ctx.drawImage(img, ox - dw / 2, oy - dh, dw, dh);
        if (entity.id === highlightEntityId) {
          ctx.save();
          ctx.strokeStyle = '#2fa8ff';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 6]);
          ctx.strokeRect(ox - dw / 2, oy - dh, dw, dh);
          ctx.restore();
        }
      }
    }
  }
}
