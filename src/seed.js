// Seeds the bundled sample assets (background + one 3-layer character) into
// IndexedDB on first run, and creates a starter scene so the app is usable
// with zero uploads. Uses fixed ids so this is idempotent across reloads.
import { importAssetFromUrl, putRecord, getRecord, getAll } from './db.js';

const BASE = 'assets/samples/';

const SAMPLE_IDS = {
  background: 'sample-asset-background',
  bodyIdle: 'sample-asset-body-idle',
  bodyTalk: ['sample-asset-body-talk-0', 'sample-asset-body-talk-1', 'sample-asset-body-talk-2', 'sample-asset-body-talk-3'],
  mouthSilent: 'sample-asset-mouth-silent',
  mouthTalk: Array.from({ length: 8 }, (_, i) => `sample-asset-mouth-talk-${i}`),
  eyesForward: 'sample-asset-eyes-forward',
  eyesSide: 'sample-asset-eyes-side',
  eyesBlink: 'sample-asset-eyes-blink',
};

export const SAMPLE_CHARACTER_ID = 'sample-character-buddy';
export const SAMPLE_SCENE_ID = 'sample-scene-starter';

async function ensureAsset(id, name, path) {
  return importAssetFromUrl(BASE + path, name, id);
}

export async function seedSampleContent() {
  await Promise.all([
    ensureAsset(SAMPLE_IDS.background, 'Roadside background', 'background.png'),
    ensureAsset(SAMPLE_IDS.bodyIdle, 'Body - idle', 'character/body/idle.png'),
    ensureAsset(SAMPLE_IDS.bodyTalk[0], 'Body - move 1', 'character/body/talking-000.png'),
    ensureAsset(SAMPLE_IDS.bodyTalk[1], 'Body - move 2', 'character/body/talking-001.png'),
    ensureAsset(SAMPLE_IDS.bodyTalk[2], 'Body - move 3', 'character/body/talking-002.png'),
    ensureAsset(SAMPLE_IDS.bodyTalk[3], 'Body - move 4', 'character/body/talking-003.png'),
    ensureAsset(SAMPLE_IDS.mouthSilent, 'Mouth - silent', 'character/mouth/silent.png'),
    ...SAMPLE_IDS.mouthTalk.map((id, i) =>
      ensureAsset(id, `Mouth - talk ${i + 1}`, `character/mouth/talking-${String(i).padStart(3, '0')}.png`)
    ),
    ensureAsset(SAMPLE_IDS.eyesForward, 'Eyes - forward', 'character/eyes/open.png'),
    ensureAsset(SAMPLE_IDS.eyesSide, 'Eyes - side', 'character/eyes/side.png'),
    ensureAsset(SAMPLE_IDS.eyesBlink, 'Eyes - blink', 'character/eyes/blink.png'),
  ]);

  const existingChar = await getRecord('characters', SAMPLE_CHARACTER_ID);
  if (!existingChar) {
    const f = (assetId, label) => ({ id: `f_${assetId}`, label, assetId });
    const bodyIdleFrame = f(SAMPLE_IDS.bodyIdle, 'Idle');
    const bodyCycleFrames = SAMPLE_IDS.bodyTalk.map((id, i) => f(id, `Move ${i + 1}`));
    const mouthSilentFrame = f(SAMPLE_IDS.mouthSilent, 'Silent');
    const mouthTalkFrames = SAMPLE_IDS.mouthTalk.map((id, i) => f(id, `Talk ${i + 1}`));
    const eyesForwardFrame = f(SAMPLE_IDS.eyesForward, 'Forward');
    const eyesSideFrame = f(SAMPLE_IDS.eyesSide, 'Side');
    const eyesBlinkFrame = f(SAMPLE_IDS.eyesBlink, 'Blink');

    const character = {
      id: SAMPLE_CHARACTER_ID,
      name: 'Buddy',
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

  const existingScene = await getRecord('scenes', SAMPLE_SCENE_ID);
  if (!existingScene) {
    const scene = {
      id: SAMPLE_SCENE_ID,
      name: 'My First Scene',
      backgroundAssetId: SAMPLE_IDS.background,
      updatedAt: Date.now(),
      entities: [
        { id: 'entity-buddy-1', kind: 'character', refId: SAMPLE_CHARACTER_ID, name: 'Buddy', x: 0.3, y: 0.72, scale: 0.34, z: 1 },
      ],
      tracks: {},
    };
    await putRecord('scenes', scene);
  }
}

export async function hasAnyProjectData() {
  const [characters, scenes] = await Promise.all([getAll('characters'), getAll('scenes')]);
  return characters.length > 0 || scenes.length > 0;
}
