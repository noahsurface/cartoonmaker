import { navigate } from '../main.js';
import { getAll } from '../db.js';

export async function render(root) {
  const [scenes, characters] = await Promise.all([getAll('scenes'), getAll('characters')]);

  root.innerHTML = `
    <div class="panel">
      <h1>Cartoon Maker</h1>
      <p class="lead">Build a scene, puppet each character live with a gamepad (or your keyboard), and export the result as a video.</p>
      <div class="row">
        <button class="btn accent" id="go-scenes">Open Scenes (${scenes.length})</button>
        <button class="btn" id="go-characters">Manage Characters (${characters.length})</button>
        <button class="btn secondary" id="go-assets">Manage Assets</button>
      </div>
    </div>

    <div class="panel">
      <h2>How it works</h2>
      <ol style="line-height:1.7; padding-left: 20px;">
        <li><strong>Assets</strong> — upload background images and character artwork (or use the bundled samples).</li>
        <li><strong>Characters</strong> — build a character from a body layer, a mouth layer, and an eyes layer, and label which frames are the idle pose, the move cycle, the talk loop, and the eye states.</li>
        <li><strong>Scenes</strong> — pick a background and place any number of characters and objects on it.</li>
        <li><strong>Animate</strong> — plug in a gamepad (keyboard works too) and puppeteer one character at a time. Once you record a character, the next character you animate plays back everyone recorded so far, so the whole cast ends up performing together.</li>
        <li><strong>Export</strong> — render the finished scene to a downloadable video file.</li>
      </ol>
    </div>
  `;

  root.querySelector('#go-scenes').addEventListener('click', () => navigate('scenes'));
  root.querySelector('#go-characters').addEventListener('click', () => navigate('characters'));
  root.querySelector('#go-assets').addEventListener('click', () => navigate('assets'));
}
