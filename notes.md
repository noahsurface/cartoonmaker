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

## Coordinate system

Entity positions are stored as absolute pixels in a fixed 2560x1440 reference space (`src/engine/coords.js`), matching the sample background's native resolution — not normalized 0..1. This matters because it's what makes movement speed/acceleration isotropic (the same in x and y); a 0..1-per-axis scheme would silently move faster vertically than horizontally, since the background isn't square. Every render target (the 1280x720 live stage, a 1920x1080 export) is a uniform scale of this space (`scale = canvas.width / REF_WIDTH`), so nothing needs to change per resolution.

## Movement & animation feel (paper-cutout aesthetic)

This was the part most worth getting right, so it's centralized in `src/engine/character.js`:

- **Physics**: `TrackRecorder` (`src/engine/recorder.js`) integrates a velocity that accelerates/decelerates toward the input direction at a fixed rate (2000 px/s²) up to a max speed (500 px/s), rather than snapping to a target velocity — matching a specific request for that exact feel. Diagonal input is normalized so it isn't faster than a single axis.
- `CharacterAnimState` is a tiny state machine that is fed nothing but a stream of absolute (x, y) positions + dt (+ whether the character is currently talking). It derives everything else: whether the character is "moving" (speed above a threshold), a walk phase used for sway/bounce, a facing flag, automatic eye direction, and independent random blinking.
- **Sway**: a rotation (not a translate) of ±7°, pivoted at the character's feet — `ctx.rotate()` around the same point the body/mouth/eyes are anchored to, so the head swings side to side while the feet stay planted. One full sway cycle takes a fixed 0.75s while moving (not scaled by speed). **Bounce** lifts the same pivot straight up (never down, so feet never dip below the shadow), height = 6.7% of the character's rendered height. Both are driven by the same `walkPhase` — sway is `sin(walkPhase)`, bounce is `abs(sin(walkPhase))`, which has exactly half the period, so bounce completes two full up-down cycles (0.375s each) per one sway cycle for free, with no separate rate to keep in sync. When the character stops, `walkPhase` eases toward the *nearest multiple of 2π* rather than freezing mid-step, so sway/bounce decay to zero smoothly instead of snapping.
- **Paper-flip turn**: when horizontal direction reverses, we start a 0.32s transition and compute `scaleX(t) = flipFrom * cos(t * π)`. At t=0 this equals the old facing (±1); at t=1 it equals the new facing (∓1); at t=0.5 it passes through exactly 0 — the character goes edge-on, like a card flipping.
- **Automatic eyes**: no button controls these at all. Eyes show the side-look frame whenever horizontal speed exceeds a small threshold, forward otherwise (vertical-only movement, or standing still). Because the eyes layer is drawn inside the same rotated/flipped transform as the body, a character moving left automatically mirrors the same "side" art that a character moving right uses — no separate mirrored asset needed.
- **Blinking**: each `CharacterAnimState` keeps its own independent timer, randomized 2-4s, that triggers a 0.125s blink (overriding whatever eye frame was showing, then reverting to it) — this runs for every character in a scene continuously, including ones that are just sitting at their placed position with no recorded track.
- **Shadow**: now the uploaded `character-shadow.png` art (not a drawn ellipse), positioned every frame at the character's raw (x, y), *before* the sway/bounce/flip transform, so it tracks movement but doesn't wobble, tilt, or flip with the body above it.
- **Speech bubble**: while a character is talking (mouth held), a 4-frame bubble loops at 8fps above and to the side of its head. It translates and bounces with the character but does not inherit the sway rotation or the facing flip — it stays upright.
- **Talking**: mouth and body both cycle through their `talk`/`cycle` frames in lockstep at 10fps, driven by a `talkClock` that runs only while the talk button/key is held (reset to 0 each time a new utterance starts) — not by movement or by the same clock as anything else. An earlier version of this accidentally reused the movement-driven pose clock for the mouth, so it only advanced while the character was walking and looked frozen on frame 0 while talking-in-place; `talkClock` is now a separate, dedicated clock for exactly this.
- Because this state machine only depends on a position (+talking) stream, the exact same `update()`/`drawCharacter()` pair is used for live puppeteering, played-back recorded tracks, and video export — movement looks identical in all three.

## Recording model

Recording a character does *not* bake in sway/bounce/flip/eyes/blink/pose-frame-index — it only stores what the user actually controlled: a timestamped list of `{t, x, y, mouthHeld}` samples (`src/engine/recorder.js`). Everything visual (including eye direction and blinking) is re-derived at playback time from that stream, same as during live control. Interpolation is linear for position; `mouthHeld` is a step function (holds the last sample's value) since it's a discrete input.

Layered recording (record character 1, then record character 2 while character 1's track plays back, etc.) works by having the scene renderer accept one `resolvePose(entityId)` callback that returns either a live-input-driven position (for the character currently being recorded) or a `sampleTrackAt(track, t)` lookup (for every previously-recorded character) or `null` (falls back to the character's static placed position from the scene editor, for anyone not yet recorded).

## Gamepad + keyboard

`src/engine/input.js` polls `navigator.getGamepads()` every animation frame and always also reads keyboard state, so every gamepad action has a keyboard equivalent — both because a keyboard is a reasonable fallback, and because a physical gamepad can't be exercised in an automated test.

Every key this app reads (arrows, WASD, Space) is also a key the browser scrolls the page with by default, so `InputSource` calls `preventDefault()` on those specific key events — otherwise puppeteering with the keyboard fallback scrolls the stage out of view.

Mapping: left stick / d-pad → move (Arrow keys / WASD), face button 0 or right trigger → hold to talk (Space). That's the entire mapping — eye direction and blinking are fully automatic and have no input at all.

## Dialogue audio

A scene can have exactly one imported dialogue audio file (`scene.dialogueAudio = {assetId, duration}`), meant for a track recorded/mixed externally with all characters' lines already laid out on one timeline. It's stored as an ordinary asset blob, decoded once with the Web Audio API to draw a waveform (`src/engine/audio.js`) in the Animate view's Timeline panel, and its duration becomes a floor for the overall scene length (`sceneDuration()`) so "Play all" and export run for at least as long as the dialogue.

Playback sync is a plain `<audio>` element whose `currentTime` is set to match the scene clock whenever recording/preview starts (and paused/resumed alongside it) — there's no drift correction beyond that, which is fine for the short clips this is meant for. The animator is expected to listen to it while puppeteering and hold the talk button at the right moments (the existing mouth/speech-bubble mechanism), rather than the app trying to auto-detect who's speaking when from a single mixed-down track.

For export, the dialogue audio is decoded again into an `AudioBufferSourceNode`, routed through a `MediaStreamAudioDestinationNode`, and its audio track is combined with the canvas's `captureStream()` video track into one `MediaStream` before handing it to `MediaRecorder` — so the exported file has a real muxed audio track (verified with `ffprobe`/`volumedetect`), not just video.

## Export

Canvas capture via `canvas.captureStream()` + `MediaRecorder`, recording webm (with an opus audio track mixed in when the scene has dialogue audio). The export view plays the full composited scene at real time speed while capturing, then offers the result as a download. Resolution/frame rate default to 1280x720 @ 30fps; a control for picking an alternate resolution/frame rate is exposed since it was cheap to add.

## Testing

Since I can't operate a physical gamepad, the app was driven end-to-end with a headless browser using the keyboard fallback path (which shares all the same code as gamepad input past `InputSource.sample()`):

- Full flow: seed content loads → assets/characters/scenes list correctly → character builder shows all three layer blocks with working add/remove/role assignment → scene editor drag-to-place/scale/z-order/remove works → recording via keyboard produces a saved track → play/pause/restart transport works → export produces a real, playable webm (verified with ffprobe).
- **Physics**: read the actual recorded `{t, x, y}` samples back out of IndexedDB after a hold-right recording and computed per-sample instantaneous speed directly — confirmed a smooth ramp from 0 to ~500px/s over ~0.25s (matches 500px/s ÷ 2000px/s²), a steady ~500px/s plateau, and a symmetric ~0.25s ramp back down to a full stop after releasing the key. This is exact, not eyeballed off a video.
- **Sway/bounce/flip/shadow**: rapid-fire canvas screenshots during a walk → direction-reverse → stop sequence, confirming visually the character's silhouette narrows to an edge-on sliver mid-turn (paper-flip), the new shadow art tracks translation without wobbling, and the body visibly tilts while moving.
- **Eyes**: zoomed pixel comparison of the eye region while moving right vs. left — pupils sit on the right side of the socket when moving right, left side when moving left (confirming both the automatic look-direction and that mirroring via the existing body-flip works with no extra code).
- **Blinking**: a multi-second idle screenshot burst with two characters on screen caught independent blink frames on each, at different times, consistent with the 2-4s-per-character random interval.
- **Speech bubble**: confirmed it appears above/beside the head only while the talk button is held, cycles through its 4 frames, and translates along with the character as it walks.
- **Dialogue audio**: imported a synthesized test clip, confirmed the waveform canvas actually draws non-blank content, confirmed `sceneDuration()`/the export's "ready" duration reflects the audio's length (not just character track lengths), and confirmed the exported file has a real second audio stream (`ffprobe`) with non-silent content (`ffmpeg -af volumedetect`, mean/max volume well above silence).
- Re-ran the earlier layered-recording (character 2 records while character 1's track plays back) and object-placement regression tests after the coordinate-system rewrite — both still pass with no console errors.
- Checked layout at a 390px-wide mobile viewport with the new dialogue-audio panel added — still single-column, usable, no overflow.
- No gamepad hardware was available to test the actual Gamepad API branch of `input.js` directly; the code path is a straightforward `navigator.getGamepads()` poll using the standard button/axis indices, mirrored 1:1 with the keyboard path that was tested.

## Known simplifications (given the "work independently" brief)

- The "move cycle" and "talk loop" are just an ordered list of frames the user assigns and are stepped through by elapsed time — there's no concept of matching cycle speed to actual movement speed beyond capping the walk-phase oscillation rate at top speed. Fine for the flat crayon-style sample art; a more physically-accurate walk cycle would need pose data this art doesn't have.
- Scrubbing a recorded track backward during playback can cause a visible flip-turn glitch (the flip state machine assumes forward time). Play/pause/restart all work correctly; only manual backward scrubbing is affected, and it self-corrects within one flip cycle.
- Object props are static per scene (position/scale/z only, no animation) since the spec explicitly describes them as non-posed.
- Dialogue audio is one file per scene with no in-app trimming/offsetting — it always starts at scene time 0. It's meant to be fully assembled in external audio software first, per the given direction, so this wasn't built out further (no per-clip placement/multi-track).
- Audio/video sync during live preview is "set `currentTime` once and let both clocks run," not frame-accurate drift correction — acceptable for short dialogue clips, but a very long recording session could drift a little between the visual scene clock and the audio element's own playback clock.
