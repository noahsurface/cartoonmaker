import { seedSampleContent } from './seed.js';

import * as homeView from './views/home.js';
import * as assetsView from './views/assets.js';
import * as charactersView from './views/characters.js';
import * as scenesView from './views/scenes.js';
import * as editorView from './views/editor.js';
import * as puppetView from './views/puppet.js';
import * as exportView from './views/export.js';

const ROUTES = [
  { path: 'home', label: 'Home', view: homeView },
  { path: 'assets', label: 'Assets', view: assetsView },
  { path: 'characters', label: 'Characters', view: charactersView },
  { path: 'scenes', label: 'Scenes', view: scenesView },
  { path: 'editor', label: 'Edit Scene', view: editorView, hidden: true },
  { path: 'puppet', label: 'Animate', view: puppetView, hidden: true },
  { path: 'export', label: 'Export', view: exportView, hidden: true },
];

const app = document.getElementById('app');

let currentCleanup = null;

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, queryString] = raw.split('?');
  const params = Object.fromEntries(new URLSearchParams(queryString || ''));
  return { path: path || 'home', params };
}

function buildShell() {
  app.innerHTML = '';

  const topbar = document.createElement('div');
  topbar.className = 'topbar';

  const brand = document.createElement('div');
  brand.className = 'brand';
  brand.innerHTML = '<span class="dot"></span> Cartoon Maker';
  brand.addEventListener('click', () => {
    location.hash = '#/home';
  });
  topbar.appendChild(brand);

  const tabs = document.createElement('div');
  tabs.className = 'nav-tabs';
  for (const route of ROUTES) {
    if (route.hidden) continue;
    const btn = document.createElement('button');
    btn.className = 'nav-tab';
    btn.textContent = route.label;
    btn.dataset.path = route.path;
    btn.addEventListener('click', () => {
      location.hash = `#/${route.path}`;
    });
    tabs.appendChild(btn);
  }
  topbar.appendChild(tabs);

  const main = document.createElement('main');
  main.className = 'view';
  main.id = 'view-root';

  const footer = document.createElement('footer');
  footer.className = 'appfoot';
  footer.textContent = 'Cartoon Maker — scenes are saved automatically in this browser.';

  app.appendChild(topbar);
  app.appendChild(main);
  app.appendChild(footer);
}

function highlightActiveTab(path) {
  const topLevel = ['editor', 'puppet', 'export'].includes(path) ? null : path;
  document.querySelectorAll('.nav-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.path === topLevel);
  });
}

async function renderRoute() {
  const { path, params } = parseHash();
  const route = ROUTES.find((r) => r.path === path) || ROUTES[0];
  highlightActiveTab(route.path);

  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch (err) {
      console.error('view cleanup failed', err);
    }
    currentCleanup = null;
  }

  const root = document.getElementById('view-root');
  root.innerHTML = '';
  try {
    currentCleanup = await route.view.render(root, params, navigate);
  } catch (err) {
    console.error(err);
    root.innerHTML = `<div class="panel"><h2>Something went wrong</h2><p>${escapeHtml(err.message || String(err))}</p></div>`;
  }
}

export function navigate(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  location.hash = `#/${path}${qs ? `?${qs}` : ''}`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function boot() {
  buildShell();
  try {
    await seedSampleContent();
  } catch (err) {
    console.error('Failed to seed sample content', err);
  }
  window.addEventListener('hashchange', renderRoute);
  await renderRoute();
}

boot();
