// Unified input abstraction: reads a real gamepad when one is connected and
// always also reads the keyboard, so every gamepad action has a keyboard
// equivalent. This is both an accessibility fallback and the only way this
// app's own automated checks can exercise the puppeteering feature.
//
// Mapping (standard W3C gamepad layout):
//   left stick / d-pad      -> move                | Arrow keys / WASD
//   face button 0 (A/Cross) -> hold to talk (mouth) | Space
//   right trigger (7)       -> hold to talk (mouth) | (no separate key)
//
// Eye direction and blinking are fully automatic (see CharacterAnimState)
// and have no input mapping at all.

const DEADZONE = 0.18;

export class InputSource {
  constructor() {
    this.keys = new Set();
    this._onKeyDown = (e) => {
      this.keys.add(e.code);
    };
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
  }

  isGamepadConnected() {
    if (!navigator.getGamepads) return false;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p) return true;
    return false;
  }

  /** @returns {{dx:number, dy:number, mouthHeld:boolean, gamepadConnected:boolean}} */
  sample() {
    let dx = 0;
    let dy = 0;
    let mouthHeld = false;

    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dx -= 1;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dx += 1;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) dy -= 1;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) dy += 1;
    if (this.keys.has('Space')) mouthHeld = true;

    let gamepadConnected = false;
    if (navigator.getGamepads) {
      for (const pad of navigator.getGamepads()) {
        if (!pad) continue;
        gamepadConnected = true;
        const ax = pad.axes[0] || 0;
        const ay = pad.axes[1] || 0;
        if (Math.abs(ax) > DEADZONE) dx += ax;
        if (Math.abs(ay) > DEADZONE) dy += ay;
        if (pad.buttons[14]?.pressed) dx -= 1;
        if (pad.buttons[15]?.pressed) dx += 1;
        if (pad.buttons[12]?.pressed) dy -= 1;
        if (pad.buttons[13]?.pressed) dy += 1;
        if (pad.buttons[0]?.pressed) mouthHeld = true;
        if (pad.buttons[7]?.value > 0.3 || pad.buttons[7]?.pressed) mouthHeld = true;
        break; // use the first connected pad
      }
    }

    dx = Math.max(-1, Math.min(1, dx));
    dy = Math.max(-1, Math.min(1, dy));
    return { dx, dy, mouthHeld, gamepadConnected };
  }
}
