// Seeds the bundled sample assets (background + starter characters) into
// IndexedDB on first run, and creates a starter scene so the app is usable
// with zero uploads. Uses fixed ids so this is idempotent across reloads.
import { importAssetFromUrl, putRecord, getRecord, getAll } from './db.js';
import { REF_WIDTH, REF_HEIGHT } from './engine/coords.js';

const BASE = 'assets/samples/';

// Every bundled character shares this same three-layer shape (idle + 4-frame
// body cycle, silent + 8-frame mouth cycle, forward/side/blink eyes), so one
// spec per character is enough to seed all of them identically.
const BUNDLED_CHARACTERS = [
  {
    // Internal id kept as-is from before the character was renamed to
    // "Bruce" — it's an opaque key, not a display name, and changing it
    // would orphan data already saved by existing browsers.
    id: 'sample-character-buddy',
    name: 'Bruce',
    assetPrefix: 'sample-asset',
    localFolder: 'bruce',
    entityId: 'entity-buddy-1',
  },
  {
    id: 'sample-character-reggie',
    name: 'Reggie',
    assetPrefix: 'reggie-asset',
    localFolder: 'reggie',
    entityId: null, // not placed in the starter scene by default
  },
];

function characterAssetIds(prefix) {
  return {
    bodyIdle: `${prefix}-body-idle`,
    bodyTalk: Array.from({ length: 4 }, (_, i) => `${prefix}-body-talk-${i}`),
    mouthSilent: `${prefix}-mouth-silent`,
    mouthTalk: Array.from({ length: 8 }, (_, i) => `${prefix}-mouth-talk-${i}`),
    eyesForward: `${prefix}-eyes-forward`,
    eyesSide: `${prefix}-eyes-side`,
    eyesBlink: `${prefix}-eyes-blink`,
  };
}

const BACKGROUND_ASSET_ID = 'sample-asset-background';

// Bundled default objects (props): simple, un-posed images placeable in any
// scene, uploaded via the `assets` branch.
const BUNDLED_OBJECTS = [{ id: 'sample-object-bush', name: 'Bush', assetId: 'sample-asset-bush', localPath: 'objects/bush.png' }];

// Shared effect graphics used for every character in every scene (not part
// of any one character's own layers), uploaded via the `assets` branch.
export const FX_ASSET_IDS = {
  shadow: 'fx-asset-shadow',
  bubble: ['fx-asset-bubble-0', 'fx-asset-bubble-1', 'fx-asset-bubble-2', 'fx-asset-bubble-3'],
};

export const SAMPLE_CHARACTER_ID = BUNDLED_CHARACTERS[0].id;
export const SAMPLE_SCENE_ID = 'sample-scene-starter';

async function ensureAsset(id, name, path) {
  return importAssetFromUrl(BASE + path, name, id);
}

async function seedCharacterAssets(spec) {
  const ids = characterAssetIds(spec.assetPrefix);
  const folder = spec.localFolder;
  await Promise.all([
    ensureAsset(ids.bodyIdle, `${spec.name} - body idle`, `${folder}/body/idle.png`),
    ensureAsset(ids.bodyTalk[0], `${spec.name} - body move 1`, `${folder}/body/talking-000.png`),
    ensureAsset(ids.bodyTalk[1], `${spec.name} - body move 2`, `${folder}/body/talking-001.png`),
    ensureAsset(ids.bodyTalk[2], `${spec.name} - body move 3`, `${folder}/body/talking-002.png`),
    ensureAsset(ids.bodyTalk[3], `${spec.name} - body move 4`, `${folder}/body/talking-003.png`),
    ensureAsset(ids.mouthSilent, `${spec.name} - mouth silent`, `${folder}/mouth/silent.png`),
    ...ids.mouthTalk.map((id, i) =>
      ensureAsset(id, `${spec.name} - mouth talk ${i + 1}`, `${folder}/mouth/talking-${String(i).padStart(3, '0')}.png`)
    ),
    ensureAsset(ids.eyesForward, `${spec.name} - eyes forward`, `${folder}/eyes/open.png`),
    ensureAsset(ids.eyesSide, `${spec.name} - eyes side`, `${folder}/eyes/side.png`),
    ensureAsset(ids.eyesBlink, `${spec.name} - eyes blink`, `${folder}/eyes/blink.png`),
  ]);
  return ids;
}

async function seedCharacterRecord(spec, assetIds) {
  const existing = await getRecord('characters', spec.id);
  if (existing) return;
  const f = (assetId, label) => ({ id: `f_${assetId}`, label, assetId });
  const bodyIdleFrame = f(assetIds.bodyIdle, 'Idle');
  const bodyCycleFrames = assetIds.bodyTalk.map((id, i) => f(id, `Move ${i + 1}`));
  const mouthSilentFrame = f(assetIds.mouthSilent, 'Silent');
  const mouthTalkFrames = assetIds.mouthTalk.map((id, i) => f(id, `Talk ${i + 1}`));
  const eyesForwardFrame = f(assetIds.eyesForward, 'Forward');
  const eyesSideFrame = f(assetIds.eyesSide, 'Side');
  const eyesBlinkFrame = f(assetIds.eyesBlink, 'Blink');

  const character = {
    id: spec.id,
    name: spec.name,
    createdAt: Date.now(),
    layers: {
      body: {
        frames: [bodyIdleFrame, ...bodyCycleFrames],
        roles: { idle: bodyIdleFrame.id, cycle: bodyCycleFrames.map((fr) => fr.id) },
      },
      mouth: {
        frames: [mouthSilentFrame, ...mouthTalkFrames],
        roles: { silent: mouthSilentFrame.id, talk: mouthTalkFrames.map((fr) => fr.id) },
      },
      eyes: {
        frames: [eyesForwardFrame, eyesSideFrame, eyesBlinkFrame],
        roles: { forward: eyesForwardFrame.id, side: eyesSideFrame.id, blink: eyesBlinkFrame.id },
      },
    },
  };
  await putRecord('characters', character);
}

async function seedObjectRecord(spec) {
  const existing = await getRecord('objects', spec.id);
  if (existing) return;
  await putRecord('objects', { id: spec.id, name: spec.name, assetId: spec.assetId, createdAt: Date.now() });
}

export async function seedSampleContent() {
  await Promise.all([
    ensureAsset(BACKGROUND_ASSET_ID, 'Roadside background', 'background.png'),
    ensureAsset(FX_ASSET_IDS.shadow, 'Character shadow', 'fx/shadow.png'),
    ensureAsset(FX_ASSET_IDS.bubble[0], 'Speech bubble 1', 'fx/speech-bubble-000.png'),
    ensureAsset(FX_ASSET_IDS.bubble[1], 'Speech bubble 2', 'fx/speech-bubble-001.png'),
    ensureAsset(FX_ASSET_IDS.bubble[2], 'Speech bubble 3', 'fx/speech-bubble-002.png'),
    ensureAsset(FX_ASSET_IDS.bubble[3], 'Speech bubble 4', 'fx/speech-bubble-003.png'),
    ...BUNDLED_CHARACTERS.map(async (spec) => {
      const assetIds = await seedCharacterAssets(spec);
      await seedCharacterRecord(spec, assetIds);
    }),
    ...BUNDLED_OBJECTS.map(async (spec) => {
      await ensureAsset(spec.assetId, spec.name, spec.localPath);
      await seedObjectRecord(spec);
    }),
  ]);

  const existingScene = await getRecord('scenes', SAMPLE_SCENE_ID);
  if (!existingScene) {
    const starter = BUNDLED_CHARACTERS[0];
    const scene = {
      id: SAMPLE_SCENE_ID,
      name: 'My First Scene',
      backgroundAssetId: BACKGROUND_ASSET_ID,
      updatedAt: Date.now(),
      entities: [
        { id: starter.entityId, kind: 'character', refId: starter.id, name: starter.name, x: 768, y: 1037, scale: 0.34, z: 1 },
      ],
      tracks: {},
    };
    await putRecord('scenes', scene);
  }
}

// One-time fixup for browsers that had scenes saved before entity positions
// switched from normalized 0..1 coordinates to absolute reference-space
// pixels. A legitimate pixel position is always well above 2 (the smallest
// is the ~0.02*REF_WIDTH edge margin), so anything at or below that is
// unambiguously a leftover normalized value from the old scheme.
export async function migrateLegacyEntityCoordinates() {
  const scenes = await getAll('scenes');
  for (const scene of scenes) {
    let changed = false;
    for (const entity of scene.entities || []) {
      if (entity.x <= 2 && entity.y <= 2) {
        entity.x *= REF_WIDTH;
        entity.y *= REF_HEIGHT;
        changed = true;
      }
    }
    if (changed) await putRecord('scenes', scene);
  }
}

// One-time fixup for browsers that already had a bundled sample character
// saved under an old display name (e.g. "Buddy" before it was renamed to
// "Bruce") — the seed step above only sets the name at creation time, so
// existing records need to be patched in place.
export async function migrateLegacySampleCharacterName() {
  const scenes = await getAll('scenes');
  for (const spec of BUNDLED_CHARACTERS) {
    const character = await getRecord('characters', spec.id);
    if (character && character.name !== spec.name) {
      character.name = spec.name;
      await putRecord('characters', character);
    }
    for (const scene of scenes) {
      let changed = false;
      for (const entity of scene.entities || []) {
        if (entity.refId === spec.id && entity.name !== spec.name) {
          entity.name = spec.name;
          changed = true;
        }
      }
      if (changed) await putRecord('scenes', scene);
    }
  }
}

export async function hasAnyProjectData() {
  const [characters, scenes] = await Promise.all([getAll('characters'), getAll('scenes')]);
  return characters.length > 0 || scenes.length > 0;
}
