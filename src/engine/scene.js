// Composites a background with any number of character/object entities onto
// a canvas. Used identically by the scene editor (static preview), the
// puppeteering view (live + played-back tracks), and video export.
import { preloadImage, preloadMany, getCachedImage, getContentWidthFraction } from '../utils/image-cache.js';
import {
  CharacterAnimState,
  resolveFrameAssets,
  preloadCharacterImages,
  resolveIdleBodyAssetId,
  getCharacterPoses,
  drawCharacterBody,
  getCharacterBounds,
  getSpeechBubbleRect,
  drawSpeechBubbleRect,
  rectsOverlap,
} from './character.js';
import { REF_WIDTH, REF_HEIGHT, computeWorldWidth, getWorldTransform } from './coords.js';
import { CameraState } from './camera.js';
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
    this.shadowWidthFractionByObjectId = new Map();
    this.camera = new CameraState();
    this.worldWidth = REF_WIDTH;
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
    this.worldWidth = computeWorldWidth(getCachedImage(this.scene.backgroundAssetId));

    // The shadow should match each character's actual (non-transparent) body
    // width, measured once per pose from that pose's idle frame so it stays
    // stable as the body cycles through talk frames — measured separately
    // per pose since different poses (e.g. a running stance) can have a
    // meaningfully different silhouette width.
    for (const character of this.characterById.values()) {
      const { order } = getCharacterPoses(character);
      for (const poseId of order) {
        const key = `${character.id}:${poseId}`;
        if (this.shadowWidthFractionByCharacterId.has(key)) continue;
        const idleImg = getCachedImage(resolveIdleBodyAssetId(character, poseId));
        this.shadowWidthFractionByCharacterId.set(key, getContentWidthFraction(idleImg));
      }
    }
    for (const obj of this.objectById.values()) {
      if (this.shadowWidthFractionByObjectId.has(obj.id)) continue;
      this.shadowWidthFractionByObjectId.set(obj.id, getContentWidthFraction(getCachedImage(obj.assetId)));
    }
  }

  getAnimState(entityId) {
    return this.animStates.get(entityId);
  }

  /**
   * Render one frame.
   * @param {CanvasRenderingContext2D} ctx
   * @param {number} dt seconds since last frame (0 for a static/paused draw)
   * @param {(entityId:string) => {x:number,y:number,mouthHeld:boolean,poseId?:string}|null} resolvePose
   *   Returns the current live/playback pose sample for a character entity (position in the
   *   2560x1440 reference space), or null to leave it at rest at its placed position.
   * @param {string|null} highlightEntityId optional entity to draw a selection ring around
   * @param {{fullWorld?:boolean}} opts fullWorld shows the entire (possibly wider-than-frame)
   *   world zoomed out to fit the canvas, ignoring camera follow — used by the scene editor so
   *   everything can be placed at a glance. Omit/false for the normal windowed camera view.
   */
  render(ctx, dt, resolvePose, highlightEntityId = null, opts = {}) {
    const w = ctx.canvas.width;
    const h = ctx.canvas.height;
    ctx.clearRect(0, 0, w, h);

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

    // Camera: horizontal-only follow of a designated focus character, a pure
    // function of that character's resolved x this frame (see camera.js) —
    // skipped entirely (camX stays 0) in full-world mode, and when the scene
    // has no follow target or that target isn't present, matching the old
    // fixed-frame behavior exactly.
    let camX = 0;
    if (!opts.fullWorld && this.scene.cameraFollowEntityId) {
      const focus = resolved.find((r) => r.entity.id === this.scene.cameraFollowEntityId && r.entity.kind === 'character');
      if (focus) camX = this.camera.update(focus.x, this.worldWidth, dt);
    }
    const { scale, offsetY } = getWorldTransform(this.worldWidth, w, h, !!opts.fullWorld);

    const bg = getCachedImage(this.scene.backgroundAssetId);
    if (bg) {
      ctx.drawImage(bg, -camX * scale, offsetY, this.worldWidth * scale, REF_HEIGHT * scale);
    } else {
      ctx.fillStyle = '#87ceeb';
      ctx.fillRect(0, offsetY, w, REF_HEIGHT * scale);
    }

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
        const poseId = sample?.poseId ?? entity.poseSequence?.[0] ?? getCharacterPoses(character).order[0];
        state.update(x, y, dt, sample?.mouthHeld ?? false, poseId);
        const sprites = resolveFrameAssets(character, {
          mouthHeld: state.talking,
          talkClock: state.talkClock,
          eyesLook: state.eyesLook,
          blinking: state.isBlinking,
          poseId: state.activePoseId,
        });
        const size = entity.scale * REF_HEIGHT * scale;
        const geom = {
          originX: (x - camX) * scale,
          originY: y * scale + offsetY,
          size,
          shadowWidthFraction: this.shadowWidthFractionByCharacterId.get(`${character.id}:${state.activePoseId}`) ?? 1,
        };
        drawCharacterBody(ctx, state, sprites, geom, this.fx);
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
        const size = entity.scale * REF_HEIGHT * scale;
        const aspect = img.width / img.height || 1;
        const dw = size * aspect;
        const dh = size;
        const ox = (x - camX) * scale;
        const oy = y * scale + offsetY;
        if (entity.hasShadow && this.fx.shadowImg) {
          const shadowAspect = this.fx.shadowImg.width / this.fx.shadowImg.height || 4;
          const shadowW = dw * (this.shadowWidthFractionByObjectId.get(obj.id) ?? 1);
          const shadowH = shadowW / shadowAspect;
          ctx.drawImage(this.fx.shadowImg, ox - shadowW / 2, oy - shadowH / 2, shadowW, shadowH);
        }
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
    for (const { entityId, state, geom } of talkers) {
      const rect = getSpeechBubbleRect(state, geom, this.fx.bubbleFrames);
      if (!rect) continue;
      const coversSomeoneElse = allCharacterBounds.some((b) => b.entityId !== entityId && rectsOverlap(rect, b.bounds));
      drawSpeechBubbleRect(ctx, rect, coversSomeoneElse ? 0.5 : 1);
    }
  }
}
