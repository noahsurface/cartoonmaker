# Build notes

Running log of what was built and any non-obvious decisions, as the app is built out in one long pass.

## Architecture

- Plain ES modules, no build step, no framework, no backend. `index.html` loads `src/main.js` as a module; a tiny hash router (`#/home`, `#/assets`, `#/characters`, `#/scenes`, `#/editor?id=`, `#/puppet?id=`, `#/export?id=`) swaps view modules in and out of a single `<main>` element.
- Persistence is IndexedDB via `src/db.js` (generic get/getAll/put/delete over `assets`, `characters`, `objects`, `scenes` stores). Uploaded images are stored as `Blob`s; `getAssetUrl()` lazily creates and caches `URL.createObjectURL()` values.
- `src/seed.js` imports the bundled sample art from `assets/samples/` into the asset store under fixed ids the first time the app runs (idempotent — safe to call on every boot), plus a starter character ("Buddy") and starter scene, so the app is usable with zero uploads.

## Character model

A character is three independently-posed layers — `body`, `mouth`, `eyes` — each a list of labelled frames (`{id, label, assetId}`) plus a `roles` map that says which frame(s) are special:

- `body.roles.idle` (single frame), `body.roles.cycle` (ordered list, played on a loop while the character is moving — there's no true walk-cycle art, so this cycles through whatever frames the user assigns).
- `mouth.roles.silent` (single frame), `mouth.roles.talk` (ordered list, looped while the talk button/key is held).
- `eyes.roles.forward` / `side` / `blink` (single frames each).

All three layers are drawn on top of each other at the same anchor point every frame. This only works because the sample art is authored that way (all layers are 1200x1200 canvases pre-aligned to a shared origin) — the character builder doesn't do any per-frame offset editing, it assumes new custom characters follow the same convention (documented in the Characters view's help text).

## Movement & animation feel (paper-cutout aesthetic)

This was the part most worth getting right, so it's centralized in `src/engine/character.js`:

- `CharacterAnimState` is a tiny state machine that is fed nothing but a stream of absolute (x, y) positions + dt. It derives everything else: whether the character is "moving" (speed above a threshold), a walk phase used for sway/bounce, and a facing flag.
- **Sway + bounce**: `sin(walkPhase)` and `abs(sin(walkPhase))` scaled by small amplitudes, applied as a pixel offset before drawing. When the character stops, `walkPhase` eases toward the *nearest multiple of 2π* rather than freezing in place, so sway/bounce decay to zero smoothly instead of snapping.
- **Paper-flip turn**: when horizontal direction reverses, we start a 0.32s transition and compute `scaleX(t) = flipFrom * cos(t * π)`. At t=0 this equals the old facing (±1); at t=1 it equals the new facing (∓1); at t=0.5 it passes through exactly 0 — the character goes edge-on, like a card flipping — which is the Paper Mario-style turn effect, achieved with one closed-form expression rather than a sprite swap.
- **Shadow**: drawn every frame at the character's raw (x, y) position, *before* the sway/bounce/flip transform is applied, so it tracks the character's actual movement through the scene but doesn't wobble or flip with the body above it.
- Because this state machine only depends on a position stream, the exact same `update()`/`drawCharacter()` pair is used for live puppeteering, for played-back recorded tracks, and for video export — movement is guaranteed to look identical in all three.

## Recording model

Recording a character does *not* bake in the sway/bounce/flip/pose-frame-index — it only stores what the user actually controlled: a timestamped list of `{t, x, y, mouthHeld, eyesState}` samples (`src/engine/recorder.js`). Everything visual is re-derived at playback time from that stream, same as during live control. Interpolation is linear for position; mouth/eyes state is a step function (holds the last sample's value) since those are discrete inputs, not continuous ones.

Layered recording (record character 1, then record character 2 while character 1's track plays back, etc.) works by having the scene renderer accept one `resolvePose(entityId)` callback that returns either a live-input-driven position (for the character currently being recorded) or a `sampleTrackAt(track, t)` lookup (for every previously-recorded character) or `null` (falls back to the character's static placed position from the scene editor, for anyone not yet recorded).

## Gamepad + keyboard

`src/engine/input.js` polls `navigator.getGamepads()` every animation frame and always also reads keyboard state, so every gamepad action has a keyboard equivalent — both because a keyboard is a reasonable fallback, and because a physical gamepad can't be exercised in an automated test.

Mapping: left stick / d-pad → move (Arrow keys / WASD), face button 0 or right trigger → hold to talk (Space), face button 2 → hold for side-look (Shift), face button 1 → hold to blink (B).

## Export

Canvas capture via `canvas.captureStream()` + `MediaRecorder`, recording webm. The export view plays the full composited scene at real time speed while capturing, then offers the result as a download. Resolution/frame rate are fixed to a 1280x720 stage (matches the 16:9 sample background) with a 30fps capture default; a control for picking an alternate resolution is exposed since it was cheap to add.

## Testing

Since I can't operate a physical gamepad, the app was driven end-to-end with a headless browser using the keyboard fallback path (which shares all the same code as gamepad input past `InputSource.sample()`):

- Full flow: seed content loads → assets/characters/scenes list correctly → character builder shows all three layer blocks with working add/remove/role assignment → scene editor drag-to-place/scale/z-order/remove works → recording via keyboard produces a saved track → play/pause/restart transport works → export produces a real, playable 1280x720/30fps webm (verified with ffprobe).
- Recorded rapid-fire canvas screenshots during a walk → direction-reverse → stop sequence and confirmed visually: the character's silhouette narrows to an edge-on sliver mid-turn (the paper-flip), the shadow tracks the character's translation, and sway/bounce are present while moving.
- Recorded character 1, then started recording character 2 while character 1's track played back, and confirmed via screenshots that character 1 continued advancing along its recorded path (not frozen) while character 2 moved independently under live keyboard control — this is the core "animate one at a time, others play back" requirement.
- Added an object (prop) to a scene and confirmed it places, drags, and renders correctly alongside a character.
- Checked layout at a 390px-wide mobile viewport — single-column, usable, no overflow.
- No gamepad hardware was available to test the actual Gamepad API branch of `input.js` directly; the code path is a straightforward `navigator.getGamepads()` poll using the standard button/axis indices, mirrored 1:1 with the keyboard path that was tested.

## Known simplifications (given the "work independently" brief)

- The "move cycle" and "talk loop" are just an ordered list of frames the user assigns and are stepped through by elapsed time — there's no concept of matching cycle speed to actual movement speed beyond a fixed frame rate. Fine for the flat crayon-style sample art; a more physically-accurate walk cycle would need pose data this art doesn't have.
- Scrubbing a recorded track backward during playback can cause a visible flip-turn glitch (the flip state machine assumes forward time). Play/pause/restart all work correctly; only manual backward scrubbing is affected, and it self-corrects within one flip cycle.
- Object props are static per scene (position/scale/z only, no animation) since the spec explicitly describes them as non-posed.
