// Builds page-light.html (or page-dark.html with `dark`): an Obsidian lookalike that loads the
// real main.js and styles.css, for test.js and capture.js.
const fs = require('fs');
const path = require('path');
const repo = path.join(__dirname, '..');
const iconsDir = path.join(__dirname, 'node_modules/lucide-static/icons');
const icons = {};
for (const name of ['pencil', 'highlighter', 'eraser', 'undo-2', 'redo-2', 'trash-2', 'check', 'circle', 'circle-dot', 'droplet', 'coffee', 'ellipsis-vertical', 'book-open', 'file-text', 'search', 'folder', 'chevron-left', 'chevron-right']) {
  icons[name] = fs.readFileSync(path.join(iconsDir, name + '.svg'), 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '').replace('class="lucide', 'class="svg-icon lucide');
}
const theme = process.argv[2] || 'light';

const note = `
<div class="inline-title">Proposal: a quieter onboarding</div>
<p>New members currently meet <span id="t-eleven">eleven screens</span> before they can write their first note. Most of them skip the tour, and the ones who don't take <span id="t-time">almost four minutes</span> to reach an empty page. This proposal cuts the path down to three screens and moves everything else into gentle hints that appear the first time a feature is useful.</p>
<h2>What changes</h2>
<ul>
<li id="t-li1">The welcome screen asks one question: where do you keep your notes today?</li>
<li id="t-li2">Importing moves to a single page, with the most common sources first.</li>
<li id="t-li3">Themes, plugins and sync wait until the second week.</li>
</ul>
<h2>Why now</h2>
<p>Support tickets about "where did my note go" doubled last quarter, and <span id="t-hl">nearly all of them came from people in their first three days</span>. A shorter start gives them less to forget.</p>
<p>The risk is that people miss features they would have loved. To soften that, each hint can be reopened from the help menu, and a short weekly tip appears for the first month.</p>
<h2>Open questions</h2>
<p>Do we keep the sample vault? It helps people who learn by poking around, but it also leaves notes behind that they never wrote. Should sync appear earlier for people who sign in on a second device?</p>
<p>Next steps: a prototype for the design review on Thursday, and a small test with twenty new members the week after.</p>
`;

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Draw on Notes test page</title>
<style>
:root {
  --font-ui-smaller: 12px; --font-ui-small: 13px; --font-semibold: 600; --radius-m: 8px;
}
body.theme-light {
  --background-primary: #ffffff; --background-secondary: #f6f6f6; --background-modifier-border: #e3e3e3;
  --background-modifier-hover: rgba(0,0,0,0.06); --interactive-accent: #8a5cf5; --text-normal: #222;
  --text-muted: #6b6b6b; --icon-color: #5c5c5c; --shadow-l: 0 2px 10px rgba(0,0,0,0.12), 0 8px 30px rgba(0,0,0,0.1);
  --tab-bg: #ececec; --ribbon: #f6f6f6; --heading: #1a1a1a;
}
body.theme-dark {
  --background-primary: #1e1e1e; --background-secondary: #262626; --background-modifier-border: #363636;
  --background-modifier-hover: rgba(255,255,255,0.07); --interactive-accent: #a882ff; --text-normal: #dadada;
  --text-muted: #9a9a9a; --icon-color: #a3a3a3; --shadow-l: 0 2px 10px rgba(0,0,0,0.5), 0 8px 30px rgba(0,0,0,0.4);
  --tab-bg: #161616; --ribbon: #262626; --heading: #f0f0f0;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body { font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif; color: var(--text-normal); background: var(--tab-bg); display: flex; overflow: hidden; }
.svg-icon { width: 18px; height: 18px; stroke-width: 1.75; }
.ribbon { width: 44px; background: var(--ribbon); border-right: 1px solid var(--background-modifier-border); display: flex; flex-direction: column; align-items: center; gap: 14px; padding-top: 46px; color: var(--icon-color); }
.main { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.tabs { height: 38px; display: flex; align-items: flex-end; padding-left: 8px; }
.tab { background: var(--background-primary); padding: 8px 16px; border-radius: 8px 8px 0 0; font-size: 13px; display: flex; gap: 6px; align-items: center; }
.leaf { flex: 1; display: flex; flex-direction: column; background: var(--background-primary); min-height: 0; }
.view-header { height: 40px; display: flex; align-items: center; padding: 0 10px; gap: 8px; color: var(--icon-color); }
.view-header-title { flex: 1; text-align: center; font-size: 13px; color: var(--text-muted); }
.view-actions { display: flex; gap: 2px; }
.clickable-icon { display: flex; align-items: center; justify-content: center; padding: 4px 6px; border: none; border-radius: 6px; background: transparent; color: var(--icon-color); cursor: pointer; }
.clickable-icon:hover { background: var(--background-modifier-hover); }
button { font: inherit; }
.view-content { flex: 1; min-height: 0; }
.markdown-reading-view { height: 100%; }
.markdown-preview-view { height: 100%; overflow-y: auto; padding: 0 32px 120px; font-size: 16px; line-height: 1.6; }
.markdown-preview-sizer { max-width: 700px; margin: 0 auto; }
.inline-title { font-size: 30px; font-weight: 700; color: var(--heading); margin: 34px 0 18px; letter-spacing: -0.01em; }
h2 { font-size: 21px; color: var(--heading); margin: 28px 0 8px; }
p { margin: 0 0 14px; }
ul { margin: 0 0 14px; padding-left: 24px; }
li { margin: 4px 0; }
.notice { position: fixed; top: 16px; right: 16px; background: var(--background-secondary); border: 1px solid var(--background-modifier-border); padding: 10px 14px; border-radius: 8px; font-size: 13px; box-shadow: var(--shadow-l); }
.settings { position: fixed; inset: 40px 80px; background: var(--background-primary); border-radius: 12px; box-shadow: var(--shadow-l); padding: 28px 36px; overflow: auto; display: none; z-index: 100; }
.settings.open { display: block; }
.setting-item { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 14px 0; border-top: 1px solid var(--background-modifier-border); }
.setting-item-heading .setting-item-name { font-weight: 600; font-size: 16px; }
.setting-item-name { font-size: 14px; }
.setting-item-description { font-size: 12px; color: var(--text-muted); margin-top: 3px; }
input[type=range] { accent-color: var(--interactive-accent); }
kbd { font-family: ui-monospace, monospace; font-size: 12px; padding: 1px 6px; border: 1px solid var(--background-modifier-border); border-radius: 4px; background: var(--background-secondary); }
.mod-warning { background: #e03131; color: #fff; border: none; padding: 6px 12px; border-radius: 6px; }
${fs.readFileSync(path.join(repo, 'styles.css'), 'utf8')}
</style></head>
<body class="theme-${theme}">
<div class="ribbon">${icons['folder']}${icons['search']}${icons['file-text']}</div>
<div class="main">
  <div class="tabs"><div class="tab">${icons['file-text']} Quieter onboarding</div></div>
  <div class="leaf">
    <div class="view-header">
      <button class="clickable-icon">${icons['chevron-left']}</button>
      <button class="clickable-icon">${icons['chevron-right']}</button>
      <div class="view-header-title">Proposals / Quieter onboarding</div>
      <div class="view-actions"><button class="clickable-icon">${icons['book-open']}</button><button class="clickable-icon">${icons['ellipsis-vertical']}</button></div>
    </div>
    <div class="view-content">
      <div class="markdown-reading-view"><div class="markdown-preview-view"><div class="markdown-preview-sizer">${note}</div></div></div>
    </div>
  </div>
</div>
<div class="settings"></div>
<script>
const ICONS = ${JSON.stringify(icons)};
const P = HTMLElement.prototype;
function info(el, o) {
  if (typeof o === 'string') o = { cls: o };
  o = o || {};
  if (o.cls) el.className = [].concat(o.cls).join(' ');
  if (o.text) el.textContent = o.text;
  if (o.type) el.type = o.type;
  if (o.attr) for (const k in o.attr) el.setAttribute(k, o.attr[k]);
  return el;
}
P.createEl = function (tag, o) { const el = info(document.createElement(tag), o); this.appendChild(el); return el; };
P.createDiv = function (o) { return this.createEl('div', o); };
P.createSpan = function (o) { return this.createEl('span', o); };
P.addClass = function (...c) { this.classList.add(...c); };
P.removeClass = function (...c) { this.classList.remove(...c); };
P.toggleClass = function (c, on) { this.classList.toggle(c, on); };
P.toggle = function (show) { this.style.display = show ? '' : 'none'; };
P.empty = function () { this.innerHTML = ''; };
function setIcon(el, name) { el.innerHTML = ICONS[name] || ''; }
class Component { register(cb) { (this._cbs = this._cbs || []).push(cb); } registerEvent() {} registerDomEvent(el, t, cb, o) { el.addEventListener(t, cb, o); } }
class Notice { constructor(text) { const n = document.body.createDiv({ cls: 'notice', text }); window.__notices.push(text); setTimeout(() => n.remove(), 2500); } }
window.__notices = [];
class MarkdownView extends Component {
  constructor() { super(); this.contentEl = document.querySelector('.view-content'); this.file = { path: 'Proposals/Quieter onboarding.md' }; this.mode = 'preview'; }
  getMode() { return this.mode; }
  addAction(icon, title, cb) {
    const b = document.createElement('button'); b.className = 'clickable-icon view-action'; b.setAttribute('aria-label', title);
    setIcon(b, icon); b.addEventListener('click', cb); document.querySelector('.view-actions').prepend(b); return b;
  }
}
const view = new MarkdownView();
const app = {
  workspace: { onLayoutReady: (cb) => setTimeout(cb), on: () => ({}), getLeavesOfType: () => [{ view }], getActiveViewOfType: () => view },
  vault: { on: () => ({}) },
};
class Plugin extends Component {
  constructor(app) { super(); this.app = app; this.commands = []; }
  async loadData() { const s = localStorage.getItem('data'); return s ? JSON.parse(s) : null; }
  async saveData(d) { localStorage.setItem('data', JSON.stringify(d)); window.__saves = (window.__saves || 0) + 1; }
  addSettingTab(t) { this.tab = t; } addCommand(c) { this.commands.push(c); }
}
class PluginSettingTab { constructor(app, plugin) { this.containerEl = document.querySelector('.settings'); } }
class Setting {
  constructor(el) { this.el = el.createDiv('setting-item'); const i = this.el.createDiv('setting-item-info'); this.name = i.createDiv('setting-item-name'); this.desc = i.createDiv('setting-item-description'); this.control = this.el.createDiv('setting-item-control'); }
  setName(t) { this.name.textContent = t; return this; } setDesc(t) { this.desc.textContent = t; return this; }
  setHeading() { this.el.addClass('setting-item-heading'); return this; }
  addToggle(cb) { const i = this.control.createEl('input', { type: 'checkbox' }); const t = { setValue: (v) => { i.checked = v; return t; }, onChange: (f) => { i.onchange = () => f(i.checked); return t; } }; cb(t); return this; }
  addButton(cb) { const b = this.control.createEl('button'); const t = { setButtonText: (x) => { b.textContent = x; return t; }, setWarning: () => { b.className = 'mod-warning'; return t; }, setDisabled: (d) => { b.disabled = d; return t; }, onClick: (f) => { b.onclick = f; return t; } }; cb(t); return this; }
}
const obsidian = { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, setIcon };
const module = { exports: {} };
(function (require, module) {
${fs.readFileSync(path.join(repo, 'main.js'), 'utf8')}
})(() => obsidian, module);
window.plugin = new module.exports(app);
window.view = view;
window.ready = window.plugin.onload();
</script>
</body></html>`;
fs.writeFileSync(path.join(__dirname, `page-${theme}.html`), html);
console.log('built', theme);
