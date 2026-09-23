// Composites a background with any number of character/object entities onto
// a canvas. Used identically by the scene editor (static preview), the
// puppeteering view (live + played-back tracks), and video export.
import { preloadImage, preloadMany, getCachedImage, getContentWidthFraction } from '../utils/image-cache.js';
import {
  CharacterAnimState,
  resolvePoseAssets,
  preloadCharacterImages,
  resolveIdleBodyAssetId,
  drawCharacterBody,
  getCharacterBounds,
  getSpeechBubbleRect,
  drawSpeechBubbleRect,
  rectsOverlap,
  BUBBLE_OFFSET_X_PX,
  BUBBLE_OFFSET_Y_PX,
} from './character.js';
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
    this.shadowWidthFractionByCharacterId = new Map();
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

    // The shadow should match each character's actual (non-transparent) body
    // width, measured once from their idle pose so it stays stable as the
    // body cycles through talk frames.
    for (const character of this.characterById.values()) {
      if (this.shadowWidthFractionByCharacterId.has(character.id)) continue;
      const idleImg = getCachedImage(resolveIdleBodyAssetId(character));
      this.shadowWidthFractionByCharacterId.set(character.id, getContentWidthFraction(idleImg));
    }
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

    // Pass 1: resolve each entity's current base position (before sway/bounce),
    // then depth-sort characters and objects together by how far "down" they
    // are in the scene — greater y = further forward = drawn later/on top.
    // The scene editor's manual z only breaks ties (e.g. two things placed
    // at exactly the same y).
    const resolved = this.scene.entities.map((entity) => {
      if (entity.kind === 'character') {
        const sample = resolvePose ? resolvePose(entity.id) : null;
        return { entity, x: sample ? sample.x : entity.x, y: sample ? sample.y : entity.y, sample };
      }
      return { entity, x: entity.x, y: entity.y, sample: null };
    });
    resolved.sort((a, b) => a.y - b.y || (a.entity.z ?? 0) - (b.entity.z ?? 0));

    // Pass 2: draw every character's shadow+body and every object in that
    // depth order. Speech bubbles are deferred to pass 3 so they can be drawn
    // above everything and checked for overlap against every character's
    // now-known bounding box.
    const talkers = [];
    const allCharacterBounds = [];

    for (const { entity, x, y, sample } of resolved) {
      if (entity.kind === 'character') {
        const character = this.characterById.get(entity.refId);
        if (!character) continue;
        const state = this.animStates.get(entity.id);
        state.update(x, y, dt, sample?.mouthHeld ?? false);
        const pose = resolvePoseAssets(character, {
          mouthHeld: state.talking,
          talkClock: state.talkClock,
          eyesLook: state.eyesLook,
          blinking: state.isBlinking,
        });
        const size = entity.scale * h;
        const geom = {
          originX: x * scale,
          originY: y * scale,
          size,
          shadowWidthFraction: this.shadowWidthFractionByCharacterId.get(character.id) ?? 1,
        };
        drawCharacterBody(ctx, state, pose, geom, this.fx);
        if (entity.id === highlightEntityId) {
          ctx.save();
          ctx.strokeStyle = '#2fa8ff';
          ctx.lineWidth = 3;
          ctx.setLineDash([8, 6]);
          ctx.strokeRect(geom.originX - size * 0.4, geom.originY - size * 0.95, size * 0.8, size * 0.95);
          ctx.restore();
        }
        allCharacterBounds.push({ entityId: entity.id, bounds: getCharacterBounds(state, geom) });
        if (state.talking) talkers.push({ entityId: entity.id, state, geom });
      } else if (entity.kind === 'object') {
        const obj = this.objectById.get(entity.refId);
        if (!obj) continue;
        const img = getCachedImage(obj.assetId);
        if (!img) continue;
        const size = entity.scale * h;
        const aspect = img.width / img.height || 1;
        const dw = size * aspect;
        const dh = size;
        const ox = x * scale;
        const oy = y * scale;
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

    // Pass 3: speech bubbles, always on top, dimmed to 50% while covering
    // another character so that character stays readable underneath.
    const bubbleOffsetX = BUBBLE_OFFSET_X_PX * scale;
    const bubbleOffsetY = BUBBLE_OFFSET_Y_PX * scale;
    for (const { entityId, state, geom } of talkers) {
      const rect = getSpeechBubbleRect(state, geom, bubbleOffsetX, bubbleOffsetY, this.fx.bubbleFrames);
      if (!rect) continue;
      const coversSomeoneElse = allCharacterBounds.some((b) => b.entityId !== entityId && rectsOverlap(rect, b.bounds));
      drawSpeechBubbleRect(ctx, rect, coversSomeoneElse ? 0.5 : 1);
    }
  }
}
