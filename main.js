'use strict';

const { Plugin, PluginSettingTab, Setting, MarkdownView, Notice, setIcon } = require('obsidian');

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

const SUPPORT_URL = 'https://buymeacoffee.com/nexsiz';

// The swatches in the toolbar. Any other colour is one click away in the picker beside them.
const PALETTE = [
  { name: 'Red', color: '#e03131' },
  { name: 'Orange', color: '#f08c00' },
  { name: 'Yellow', color: '#fab005' },
  { name: 'Green', color: '#2f9e44' },
  { name: 'Blue', color: '#1971c2' },
  { name: 'Purple', color: '#7048e8' },
  { name: 'Grey', color: '#868e96' },
];

const TOOLS = {
  pen: { name: 'Pen', icon: 'pencil', key: 'P' },
  highlighter: { name: 'Highlighter', icon: 'highlighter', key: 'H' },
  eraser: { name: 'Eraser', icon: 'eraser', key: 'E' },
};

const DEFAULT_SETTINGS = {
  tool: 'pen',
  pen: { color: '#e03131', size: 3, opacity: 100 },
  highlighter: { color: '#fab005', size: 18, opacity: 40 },
  eraserSize: 20,
  smoothing: 30,
  showDrawings: true,
  showLayers: true,
};

const MIN_SIZE = 1;
const MAX_SIZE = 40;
const MIN_OPACITY = 5;
const HISTORY = 100;
const SAVE_DELAY = 600;
// How close to level, upright or diagonal a straight line has to be to snap to it, in degrees.
const SNAP_ANGLE = 5;

// ---------------------------------------------------------------------------
// Strokes
// ---------------------------------------------------------------------------

// A stroke is { tool, color, size, opacity, points: [x0, y0, x1, y1, ...] }. Points are in note
// coordinates: x from the middle of the page, so marks stay beside their text when the pane is
// resized, and y from the top of the note, so they scroll with it. Strokes and layers are never
// changed in place: drawing, erasing and every layer change make new ones, and undo keeps the old.

const bounds = new WeakMap();

function boundsOf(stroke) {
  let b = bounds.get(stroke);
  if (!b) {
    const p = stroke.points;
    b = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
    for (let i = 0; i < p.length; i += 2) {
      b.left = Math.min(b.left, p[i]);
      b.right = Math.max(b.right, p[i]);
      b.top = Math.min(b.top, p[i + 1]);
      b.bottom = Math.max(b.bottom, p[i + 1]);
    }
    bounds.set(stroke, b);
  }
  return b;
}

function paintStroke(ctx, stroke) {
  const p = stroke.points;
  ctx.globalAlpha = stroke.opacity / 100;
  ctx.strokeStyle = ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.size;
  // A highlighter has a flat tip, so it stops where the words do.
  ctx.lineCap = stroke.tool === 'highlighter' ? 'butt' : 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (p.length <= 2) {
    // A tap leaves a dot.
    ctx.arc(p[0], p[1], stroke.size / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // A smooth curve through the midpoints, so fast strokes don't look like polylines.
  ctx.moveTo(p[0], p[1]);
  for (let i = 2; i < p.length - 2; i += 2) {
    ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
  }
  ctx.lineTo(p[p.length - 2], p[p.length - 1]);
  ctx.stroke();
}

function distanceToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

// Whether an eraser of radius r at (x, y) touches the stroke.
function touches(stroke, x, y, r) {
  const reach = r + stroke.size / 2;
  const b = boundsOf(stroke);
  if (x < b.left - reach || x > b.right + reach || y < b.top - reach || y > b.bottom + reach) return false;
  const p = stroke.points;
  if (p.length <= 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
  for (let i = 0; i < p.length - 2; i += 2) {
    if (distanceToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
  }
  return false;
}

// The end of a straight line from (x0, y0) towards (x, y), snapped to level, upright or diagonal
// when it's close to one of them.
function straightEnd(x0, y0, x, y) {
  const length = Math.hypot(x - x0, y - y0);
  const angle = Math.atan2(y - y0, x - x0);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  if (Math.abs(angle - snapped) > (SNAP_ANGLE * Math.PI) / 180) return [x, y];
  return [
    Math.round((x0 + Math.cos(snapped) * length) * 10) / 10,
    Math.round((y0 + Math.sin(snapped) * length) * 10) / 10,
  ];
}

// A round cursor the size of the eraser.
function eraserCursor(size) {
  const d = Math.max(8, Math.min(120, Math.round(size)));
  const c = d / 2 + 1;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${d + 2}" height="${d + 2}">`
    + `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="rgba(255,255,255,0.35)" stroke="black" stroke-width="1"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${c} ${c}, cell`;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

// A note's drawing in one view mode is { layers, active }: layers from the back to the front, each
// { id, name, visible, strokes }, and the id of the layer being drawn on.

function newLayer(name, strokes) {
  return { id: Math.random().toString(36).slice(2, 10), name, visible: true, strokes: strokes || [] };
}

function emptyDrawing() {
  return { layers: [newLayer('Layer 1')], active: null };
}

// Version 0.1.0 kept one list of strokes per note, which becomes its first layer.
function readDrawing(saved) {
  if (Array.isArray(saved)) return { layers: [newLayer('Layer 1', saved)], active: null };
  if (saved && Array.isArray(saved.layers) && saved.layers.length) return saved;
  return emptyDrawing();
}

function nextLayerName(layers) {
  let n = layers.length;
  for (const layer of layers) {
    const m = /^Layer (\d+)$/.exec(layer.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `Layer ${n + 1}`;
}

// Whether a drawing is just the empty layer every note starts with, and needn't be saved.
function isBlank(layers) {
  return layers.length === 1 && !layers[0].strokes.length && layers[0].visible && layers[0].name === 'Layer 1';
}

// ---------------------------------------------------------------------------
// The plugin
// ---------------------------------------------------------------------------

module.exports = class DrawOnNotesPlugin extends Plugin {
  async onload() {
    const saved = (await this.loadData()) || {};
    const s = Object.assign({}, DEFAULT_SETTINGS, saved.settings);
    s.pen = Object.assign({}, DEFAULT_SETTINGS.pen, s.pen);
    s.highlighter = Object.assign({}, DEFAULT_SETTINGS.highlighter, s.highlighter);
    if (!TOOLS[s.tool]) s.tool = DEFAULT_SETTINGS.tool;
    this.settings = s;
    // Drawings by note path, with one for Reading view and one for Editing view, since the same
    // note is laid out differently in each.
    this.drawings = saved.drawings || {};
    this.surfaces = new Map();
    this.saveTimer = null;

    this.addSettingTab(new DrawOnNotesSettingTab(this.app, this));

    const attach = () => this.attachAll();
    this.app.workspace.onLayoutReady(attach);
    this.registerEvent(this.app.workspace.on('layout-change', attach));
    this.registerEvent(this.app.workspace.on('active-leaf-change', attach));
    this.registerEvent(this.app.workspace.on('file-open', attach));

    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => this.moveDrawings(oldPath, file.path)));
    this.registerEvent(this.app.vault.on('delete', (file) => this.moveDrawings(file.path, null)));

    this.addCommand({
      id: 'toggle-drawing',
      name: 'Start or stop drawing on this note',
      icon: 'pencil',
      checkCallback: (checking) => {
        const surface = this.activeSurface();
        if (!surface || !surface.path) return false;
        if (!checking) surface.toggle();
        return true;
      },
    });
    this.addCommand({
      id: 'clear-note',
      name: 'Clear the drawings on this note',
      icon: 'trash-2',
      checkCallback: (checking) => {
        const surface = this.activeSurface();
        if (!surface || !surface.strokeCount()) return false;
        if (!checking) surface.clearAll();
        return true;
      },
    });
    this.addCommand({
      id: 'toggle-visibility',
      name: 'Show or hide drawings',
      icon: 'eye',
      callback: () => this.setShowDrawings(!this.settings.showDrawings),
    });

    // Shortcuts while drawing. Capturing them first keeps them from typing into the note.
    this.registerDomEvent(document, 'keydown', (e) => this.onKeyDown(e), true);
  }

  onunload() {
    for (const surface of [...this.surfaces.values()]) surface.destroy();
    this.surfaces.clear();
    if (this.saveTimer) this.saveNow();
  }

  attachAll() {
    for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      let surface = this.surfaces.get(view);
      if (!surface) {
        surface = new DrawingSurface(this, view);
        this.surfaces.set(view, surface);
        view.register(() => {
          surface.destroy();
          this.surfaces.delete(view);
        });
      }
      surface.sync();
    }
  }

  activeSurface() {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    return (view && this.surfaces.get(view)) || null;
  }

  drawingFor(path, mode) {
    const entry = path && this.drawings[path];
    return readDrawing(entry && entry[mode]);
  }

  // Stores a surface's drawing and refreshes any other pane showing the same note.
  storeDrawing(surface) {
    const { path, mode, layers, activeId } = surface;
    if (!path) return;
    const entry = this.drawings[path] || {};
    if (isBlank(layers)) delete entry[mode];
    else entry[mode] = { layers, active: activeId };
    if (entry.preview || entry.source) this.drawings[path] = entry;
    else delete this.drawings[path];
    for (const other of this.surfaces.values()) {
      if (other !== surface && other.path === path && other.mode === mode) other.reload();
    }
    this.requestSave();
  }

  // Follows a note (or a folder of notes) to its new path, or forgets it when deleted (to: null).
  moveDrawings(from, to) {
    const moved = (path) => (path === from ? to : path.startsWith(from + '/') ? to && to + path.slice(from.length) : undefined);
    let changed = false;
    for (const path of Object.keys(this.drawings)) {
      const next = moved(path);
      if (next === undefined) continue;
      if (next) this.drawings[next] = this.drawings[path];
      delete this.drawings[path];
      changed = true;
    }
    for (const surface of this.surfaces.values()) {
      const next = surface.path && moved(surface.path);
      if (next) surface.path = next;
    }
    if (changed) this.requestSave();
  }

  setShowDrawings(show) {
    this.settings.showDrawings = show;
    for (const surface of this.surfaces.values()) surface.updateVisibility();
    this.requestSave();
  }

  setShowLayers(show) {
    this.settings.showLayers = show;
    this.refreshToolbars();
    this.requestSave();
  }

  requestSave() {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), SAVE_DELAY);
  }

  async saveNow() {
    if (this.saveTimer) window.clearTimeout(this.saveTimer);
    this.saveTimer = null;
    await this.saveData({ settings: this.settings, drawings: this.drawings });
  }

  onKeyDown(e) {
    const surface = this.activeSurface();
    if (!surface || !surface.drawing) return;
    const target = e.target;
    if (target instanceof HTMLInputElement && target.type !== 'range' && target.type !== 'color') return;
    if (target instanceof HTMLTextAreaElement) return;
    const key = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    let done = true;
    if (key === 'escape') surface.stop();
    else if (mod && key === 'z' && !e.shiftKey) surface.undo();
    else if (mod && ((key === 'z' && e.shiftKey) || key === 'y')) surface.redo();
    else if (mod || e.altKey) done = false;
    else if (key === 'p') this.setTool('pen');
    else if (key === 'h') this.setTool('highlighter');
    else if (key === 'e') this.setTool('eraser');
    else if (key === 'l') this.setShowLayers(!this.settings.showLayers);
    else if (key === '[') this.changeSize(-1);
    else if (key === ']') this.changeSize(1);
    else done = false;
    if (done) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  setTool(tool) {
    this.settings.tool = tool;
    this.refreshToolbars();
    this.requestSave();
  }

  // Sets the colour, size or opacity of the pen or highlighter in use.
  setStyle(change) {
    Object.assign(this.settings[this.settings.tool], change);
    for (const surface of this.surfaces.values()) surface.updatePreview();
    this.requestSave();
  }

  setSize(size) {
    size = Math.max(MIN_SIZE, Math.min(MAX_SIZE, size));
    if (this.settings.tool === 'eraser') this.settings.eraserSize = size;
    else this.settings[this.settings.tool].size = size;
    for (const surface of this.surfaces.values()) {
      surface.updateCursor();
      surface.updatePreview();
    }
    this.requestSave();
  }

  setSmoothing(smoothing) {
    this.settings.smoothing = Math.max(0, Math.min(100, smoothing));
    this.requestSave();
  }

  changeSize(step) {
    const s = this.settings;
    const size = s.tool === 'eraser' ? s.eraserSize : s[s.tool].size;
    // Bigger steps for bigger sizes, so [ and ] get across the range quickly.
    this.setSize(size + step * (size >= 10 ? 4 : 1));
    this.refreshToolbars();
  }

  refreshToolbars() {
    for (const surface of this.surfaces.values()) {
      if (surface.drawing) {
        surface.buildToolbar();
        surface.buildLayersPanel();
      }
      surface.updateCursor();
    }
  }
};

// ---------------------------------------------------------------------------
// The drawing surface over one note
// ---------------------------------------------------------------------------

class DrawingSurface {
  constructor(plugin, view) {
    this.plugin = plugin;
    this.view = view;
    this.drawing = false;
    this.path = null;
    this.mode = null;
    this.layers = [];
    this.activeId = null;
    this.undoStack = [];
    this.redoStack = [];
    this.scroller = null;
    this.current = null;
    this.erasing = null;
    this.pointer = null;
    this.toolbar = null;
    this.panel = null;
    this.preview = null;
    this.frame = 0;
    this.destroyed = false;

    this.button = view.addAction('pencil', 'Draw on note', () => this.toggle());
    this.button.addClass('draw-on-notes-action');

    view.contentEl.addClass('draw-on-notes-host');
    this.el = view.contentEl.createDiv('draw-on-notes-layer');
    // Highlighter strokes go on a canvas of their own under the pen, blended so the text shows
    // through them crisply.
    this.markerCanvas = this.el.createEl('canvas', { cls: 'draw-on-notes-canvas draw-on-notes-marker' });
    this.penCanvas = this.el.createEl('canvas', { cls: 'draw-on-notes-canvas draw-on-notes-pen' });

    this.onPointerDown = this.onPointerDown.bind(this);
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onWheel = this.onWheel.bind(this);
    this.schedule = this.schedule.bind(this);
    this.penCanvas.addEventListener('pointerdown', this.onPointerDown);
    this.penCanvas.addEventListener('pointermove', this.onPointerMove);
    this.penCanvas.addEventListener('pointerup', this.onPointerUp);
    this.penCanvas.addEventListener('pointercancel', this.onPointerUp);
    this.penCanvas.addEventListener('wheel', this.onWheel, { passive: false });
    // Scroll events don't bubble, but they can be caught on the way down.
    view.contentEl.addEventListener('scroll', this.schedule, true);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(view.contentEl);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.view.contentEl.removeEventListener('scroll', this.schedule, true);
    this.view.contentEl.removeClass('draw-on-notes-host');
    this.el.remove();
    this.button.remove();
  }

  // Catches up with the note and view mode the pane is showing.
  sync() {
    if (this.destroyed) return;
    const file = this.view.file;
    const path = file ? file.path : null;
    const mode = this.view.getMode() === 'preview' ? 'preview' : 'source';
    if (path !== this.path || mode !== this.mode) {
      if (path !== this.path && this.drawing) this.stop();
      this.path = path;
      this.mode = mode;
      this.reload();
    }
    this.scroller = this.findScroller();
    this.updateVisibility();
    this.resize();
  }

  reload() {
    const drawing = this.plugin.drawingFor(this.path, this.mode);
    this.layers = drawing.layers;
    this.activeId = drawing.active;
    this.fixActive();
    this.undoStack = [];
    this.redoStack = [];
    this.current = null;
    this.erasing = null;
    this.updateHistoryButtons();
    this.buildLayersPanel();
    this.updateVisibility();
    this.schedule();
  }

  findScroller() {
    const root = this.view.contentEl;
    const scroller = this.mode === 'preview'
      ? root.querySelector('.markdown-reading-view .markdown-preview-view')
      : root.querySelector('.markdown-source-view .cm-scroller');
    return scroller || root;
  }

  strokeCount(visibleOnly) {
    let n = 0;
    for (const layer of this.layers) if (layer.visible || !visibleOnly) n += layer.strokes.length;
    return n;
  }

  toggle() {
    if (this.drawing) this.stop();
    else this.start();
  }

  start() {
    this.sync();
    if (!this.path) {
      new Notice('Open a note to draw on it.');
      return;
    }
    this.drawing = true;
    // Let go of the editor, so shortcuts don't type into the note.
    const active = this.view.contentEl.ownerDocument.activeElement;
    if (active instanceof HTMLElement && this.view.contentEl.contains(active)) active.blur();
    this.button.addClass('is-active');
    this.button.setAttribute('aria-label', 'Stop drawing');
    this.buildToolbar();
    this.buildLayersPanel();
    this.updateVisibility();
    this.updateCursor();
  }

  stop() {
    if (this.current) this.finishStroke();
    if (this.erasing && this.erasing.before !== this.layers) this.commit(this.erasing.before);
    this.drawing = false;
    this.pointer = null;
    this.erasing = null;
    this.button.removeClass('is-active');
    this.button.setAttribute('aria-label', 'Draw on note');
    if (this.toolbar) this.toolbar.remove();
    this.toolbar = null;
    this.preview = null;
    this.buildLayersPanel();
    this.updateVisibility();
  }

  updateVisibility() {
    const show = this.drawing || (this.plugin.settings.showDrawings && this.strokeCount(true) > 0);
    this.el.toggleClass('is-drawing', this.drawing);
    this.el.toggle(show);
    // A hidden layer has no size, so it measures itself again when it shows.
    if (show) this.resize();
  }

  updateCursor() {
    const s = this.plugin.settings;
    this.penCanvas.style.cursor = s.tool === 'eraser' ? eraserCursor(s.eraserSize) : 'crosshair';
  }

  // -------------------------------------------------------------------------
  // Toolbar
  // -------------------------------------------------------------------------

  buildToolbar() {
    if (this.toolbar) this.toolbar.remove();
    const plugin = this.plugin;
    const s = plugin.settings;
    const bar = this.toolbar = this.el.createDiv('draw-on-notes-toolbar');
    const group = () => bar.createDiv('draw-on-notes-group');
    const button = (parent, icon, label, onClick, cls) => {
      const b = parent.createEl('button', { cls: 'clickable-icon draw-on-notes-button', attr: { 'aria-label': label } });
      if (cls) b.addClass(cls);
      setIcon(b, icon);
      b.addEventListener('click', onClick);
      return b;
    };
    const slider = (parent, icon, label, min, max, value, unit, onInput) => {
      const wrap = parent.createEl('label', { cls: 'draw-on-notes-slider' });
      const title = (v) => `${label}: ${v}${unit}`;
      wrap.setAttribute('aria-label', title(value));
      setIcon(wrap.createSpan('draw-on-notes-slider-icon'), icon);
      const input = wrap.createEl('input', { type: 'range', attr: { min, max, step: 1 } });
      input.value = String(value);
      input.addEventListener('input', () => {
        wrap.setAttribute('aria-label', title(input.value));
        onInput(Number(input.value));
      });
    };

    const tools = group();
    for (const [key, tool] of Object.entries(TOOLS)) {
      button(tools, tool.icon, `${tool.name} (${tool.key})`, () => plugin.setTool(key), s.tool === key && 'is-active');
    }

    if (s.tool === 'eraser') {
      slider(group(), 'circle', 'Eraser size', MIN_SIZE, MAX_SIZE, s.eraserSize, '', (v) => plugin.setSize(v));
    } else {
      const style = s[s.tool];
      // Swatches are plain elements, not buttons, so a theme's button colours can't cover them.
      const swatches = group();
      swatches.addClass('draw-on-notes-swatches');
      const custom = !PALETTE.some((p) => p.color === style.color);
      const choose = (el, color) => {
        const pick = () => {
          plugin.setStyle({ color });
          plugin.refreshToolbars();
        };
        el.addEventListener('click', pick);
        el.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            pick();
          }
        });
      };
      for (const { name, color } of PALETTE) {
        const swatch = swatches.createDiv({ cls: 'draw-on-notes-swatch', attr: { role: 'button', tabindex: 0, 'aria-label': name } });
        swatch.style.setProperty('--draw-on-notes-swatch', color);
        if (color === style.color) swatch.addClass('is-active');
        choose(swatch, color);
      }
      const picker = swatches.createEl('input', { cls: 'draw-on-notes-picker', type: 'color', attr: { 'aria-label': 'Any colour' } });
      if (custom) picker.addClass('is-active');
      picker.value = style.color;
      picker.addEventListener('input', () => plugin.setStyle({ color: picker.value }));
      picker.addEventListener('change', () => plugin.refreshToolbars());

      const brush = group();
      brush.addClass('draw-on-notes-brush');
      this.preview = brush.createDiv({ cls: 'draw-on-notes-preview', attr: { 'aria-label': 'Your brush' } }).createDiv('draw-on-notes-preview-dot');
      this.updatePreview();
      slider(brush, 'circle-dot', 'Size', MIN_SIZE, MAX_SIZE, style.size, '', (v) => plugin.setSize(v));
      slider(brush, 'droplet', 'Opacity', MIN_OPACITY, 100, style.opacity, '%', (v) => plugin.setStyle({ opacity: v }));
      slider(brush, 'waves', 'Smoothing', 0, 100, s.smoothing, '%', (v) => plugin.setSmoothing(v));
    }

    const history = group();
    this.undoButton = button(history, 'undo-2', 'Undo (Ctrl+Z)', () => this.undo());
    this.redoButton = button(history, 'redo-2', 'Redo (Ctrl+Shift+Z)', () => this.redo());
    button(history, 'trash-2', 'Clear this layer', () => this.clearLayer());

    const end = group();
    button(end, 'layers', 'Layers (L)', () => plugin.setShowLayers(!s.showLayers), s.showLayers && 'is-active');
    button(end, 'check', 'Done (Esc)', () => this.stop(), 'draw-on-notes-done');
    this.updateHistoryButtons();
  }

  updatePreview() {
    if (!this.preview) return;
    const s = this.plugin.settings;
    if (s.tool === 'eraser') return;
    const style = s[s.tool];
    const d = Math.max(4, Math.min(24, style.size));
    this.preview.style.setProperty('--draw-on-notes-preview-color', style.color);
    this.preview.style.setProperty('--draw-on-notes-preview-size', `${d}px`);
    this.preview.style.setProperty('--draw-on-notes-preview-opacity', String(style.opacity / 100));
    this.preview.toggleClass('is-highlighter', s.tool === 'highlighter');
  }

  updateHistoryButtons() {
    if (!this.toolbar) return;
    this.undoButton.disabled = !this.undoStack.length;
    this.redoButton.disabled = !this.redoStack.length;
  }

  // -------------------------------------------------------------------------
  // Layers panel, on the right while drawing
  // -------------------------------------------------------------------------

  buildLayersPanel() {
    if (this.panel) this.panel.remove();
    this.panel = null;
    if (!this.drawing || !this.plugin.settings.showLayers || this.destroyed) return;
    const panel = this.panel = this.el.createDiv('draw-on-notes-layers');
    const button = (parent, icon, label, onClick, cls) => {
      const b = parent.createEl('button', { cls: 'clickable-icon draw-on-notes-button', attr: { 'aria-label': label } });
      if (cls) b.addClass(cls);
      setIcon(b, icon);
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick();
      });
      return b;
    };

    const head = panel.createDiv('draw-on-notes-layers-head');
    head.createDiv({ cls: 'draw-on-notes-layers-title', text: 'Layers' });
    button(head, 'plus', 'New layer', () => this.addLayer());
    button(head, 'x', 'Hide layers (L)', () => this.plugin.setShowLayers(false));

    const list = panel.createDiv('draw-on-notes-layers-list');
    const top = this.layers.length - 1;
    // The front layer is listed first.
    for (let i = top; i >= 0; i--) {
      const layer = this.layers[i];
      const row = list.createDiv({ cls: 'draw-on-notes-layer-row', attr: { role: 'button', tabindex: 0, 'data-layer': layer.id } });
      row.toggleClass('is-active', layer.id === this.activeId);
      row.toggleClass('is-hidden', !layer.visible);
      button(row, layer.visible ? 'eye' : 'eye-off', layer.visible ? 'Hide layer' : 'Show layer', () => this.toggleLayer(layer.id), 'draw-on-notes-eye');
      const name = row.createDiv({ cls: 'draw-on-notes-layer-name', text: layer.name, attr: { 'aria-label': 'Double-click to rename' } });
      const n = layer.strokes.length;
      row.createDiv({ cls: 'draw-on-notes-layer-count', text: String(n), attr: { 'aria-label': n === 1 ? '1 stroke' : `${n} strokes` } });
      const actions = row.createDiv('draw-on-notes-layer-actions');
      button(actions, 'chevron-up', 'Move up', () => this.moveLayer(layer.id, 1)).disabled = i === top;
      button(actions, 'chevron-down', 'Move down', () => this.moveLayer(layer.id, -1)).disabled = i === 0;
      button(actions, 'trash-2', 'Delete layer', () => this.deleteLayer(layer.id)).disabled = this.layers.length === 1;
      row.addEventListener('click', () => this.selectLayer(layer.id));
      row.addEventListener('keydown', (e) => {
        if (e.target === row && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          this.selectLayer(layer.id);
        }
      });
      name.addEventListener('dblclick', () => this.renameLayer(layer.id, name));
    }
  }

  fixActive() {
    if (!this.layers.some((l) => l.id === this.activeId)) this.activeId = this.layers[this.layers.length - 1].id;
  }

  activeLayer() {
    return this.layers.find((l) => l.id === this.activeId);
  }

  // Changes one layer, as one undo step.
  updateLayer(id, change) {
    this.change(this.layers.map((l) => (l.id === id ? Object.assign({}, l, change(l)) : l)));
  }

  // Picking a layer to draw on isn't a change to undo, so the panel just marks it.
  selectLayer(id) {
    if (id === this.activeId) return;
    this.activeId = id;
    this.plugin.storeDrawing(this);
    if (this.panel) {
      for (const row of this.panel.querySelectorAll('.draw-on-notes-layer-row')) {
        row.toggleClass('is-active', row.getAttribute('data-layer') === id);
      }
    }
  }

  addLayer() {
    const layer = newLayer(nextLayerName(this.layers));
    const at = this.layers.indexOf(this.activeLayer()) + 1;
    const layers = this.layers.slice();
    layers.splice(at, 0, layer);
    this.activeId = layer.id;
    this.change(layers);
  }

  deleteLayer(id) {
    if (this.layers.length <= 1) return;
    const at = this.layers.findIndex((l) => l.id === id);
    const layers = this.layers.filter((l) => l.id !== id);
    if (id === this.activeId) this.activeId = layers[Math.max(0, at - 1)].id;
    this.change(layers);
    new Notice('Layer deleted. Undo brings it back.');
  }

  // Moves a layer one step towards the front (1) or the back (-1).
  moveLayer(id, step) {
    const at = this.layers.findIndex((l) => l.id === id);
    const to = at + step;
    if (at < 0 || to < 0 || to >= this.layers.length) return;
    const layers = this.layers.slice();
    [layers[at], layers[to]] = [layers[to], layers[at]];
    this.change(layers);
  }

  toggleLayer(id) {
    this.updateLayer(id, (l) => ({ visible: !l.visible }));
  }

  renameLayer(id, nameEl) {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    const input = nameEl.ownerDocument.createElement('input');
    input.className = 'draw-on-notes-layer-input';
    input.type = 'text';
    input.value = layer.name;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save) => {
      if (done) return;
      done = true;
      const name = input.value.trim();
      if (save && name && name !== layer.name) this.updateLayer(id, () => ({ name }));
      else this.buildLayersPanel();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
    input.addEventListener('click', (e) => e.stopPropagation());
  }

  // -------------------------------------------------------------------------
  // History
  // -------------------------------------------------------------------------

  // Makes new layers the current ones, as one undo step.
  change(layers) {
    const before = this.layers;
    this.layers = layers;
    this.fixActive();
    this.commit(before);
  }

  // Keeps the layers as they were before a change, for undo, and stores the new ones.
  commit(before) {
    this.undoStack.push(before);
    if (this.undoStack.length > HISTORY) this.undoStack.shift();
    this.redoStack = [];
    this.changed();
  }

  changed() {
    this.plugin.storeDrawing(this);
    this.updateHistoryButtons();
    this.buildLayersPanel();
    this.updateVisibility();
    this.schedule();
  }

  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.layers);
    this.layers = this.undoStack.pop();
    this.fixActive();
    this.changed();
  }

  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.layers);
    this.layers = this.redoStack.pop();
    this.fixActive();
    this.changed();
  }

  clearLayer() {
    const layer = this.activeLayer();
    if (!layer || !layer.strokes.length) return;
    this.updateLayer(layer.id, () => ({ strokes: [] }));
    new Notice(`${layer.name} cleared. Undo brings it back.`);
  }

  clearAll() {
    if (!this.strokeCount()) return;
    this.change(this.layers.map((l) => (l.strokes.length ? Object.assign({}, l, { strokes: [] }) : l)));
    new Notice('Drawings cleared. Undo brings them back.');
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  // Where the note's origin is on the layer: the middle of the page, at the top of the note.
  origin() {
    const layer = this.el.getBoundingClientRect();
    const s = this.scroller;
    const box = s.getBoundingClientRect();
    return {
      x: box.left - layer.left + s.clientWidth / 2,
      y: box.top - layer.top - s.scrollTop,
      left: layer.left,
      top: layer.top,
    };
  }

  toNote(e, o) {
    return [
      Math.round((e.clientX - o.left - o.x) * 10) / 10,
      Math.round((e.clientY - o.top - o.y) * 10) / 10,
    ];
  }

  onPointerDown(e) {
    if (!this.drawing || this.pointer !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!this.scroller || !this.scroller.isConnected) this.sync();
    e.preventDefault();
    this.penCanvas.setPointerCapture(e.pointerId);
    this.pointer = e.pointerId;
    const s = this.plugin.settings;
    // The eraser end of a stylus erases whatever tool is picked.
    const tool = e.buttons & 32 ? 'eraser' : s.tool;
    if (tool === 'eraser') {
      this.erasing = { before: this.layers, size: s.eraserSize };
      this.eraseAt([e]);
    } else {
      const style = s[tool];
      this.current = { tool, color: style.color, size: style.size, opacity: style.opacity, points: [] };
      // Up to 90% of each new point is the last one, which steadies a shaky hand.
      this.smoothing = (s.smoothing / 100) * 0.9;
      this.raw = null;
      this.addPoints([e]);
    }
  }

  onPointerMove(e) {
    if (e.pointerId !== this.pointer) return;
    const events = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    const all = events.length ? events : [e];
    if (this.erasing) this.eraseAt(all);
    else if (this.current) this.addPoints(all);
  }

  onPointerUp(e) {
    if (e.pointerId !== this.pointer) return;
    this.pointer = null;
    if (this.erasing) {
      const { before } = this.erasing;
      this.erasing = null;
      if (before !== this.layers) this.commit(before);
    } else if (this.current) {
      this.finishStroke();
    }
  }

  addPoints(events) {
    const o = this.origin();
    const p = this.current.points;
    for (const e of events) {
      const [x, y] = this.toNote(e, o);
      this.raw = [x, y];
      // Holding Shift draws a straight line from where the stroke started.
      if (e.shiftKey && p.length) {
        const [ex, ey] = straightEnd(p[0], p[1], x, y);
        p.length = 2;
        if (ex !== p[0] || ey !== p[1]) p.push(ex, ey);
        this.current.straight = true;
        continue;
      }
      if (!p.length) {
        p.push(x, y);
        continue;
      }
      const lx = p[p.length - 2];
      const ly = p[p.length - 1];
      const k = this.current.straight ? 0 : this.smoothing;
      const sx = Math.round((lx + (x - lx) * (1 - k)) * 10) / 10;
      const sy = Math.round((ly + (y - ly) * (1 - k)) * 10) / 10;
      // Skip points that barely moved, to keep saved drawings small.
      if (Math.hypot(sx - lx, sy - ly) < 0.75) continue;
      p.push(sx, sy);
    }
    this.schedule();
  }

  finishStroke() {
    const stroke = this.current;
    this.current = null;
    const p = stroke.points;
    if (!p.length) return;
    // Smoothing trails behind the pen, so the stroke catches up to where it was lifted.
    if (!stroke.straight && this.raw && p.length > 2) {
      const [x, y] = this.raw;
      if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) >= 0.75) p.push(x, y);
    }
    delete stroke.straight;
    // Drawing on a hidden layer shows it, so the stroke doesn't vanish.
    this.updateLayer(this.activeId, (l) => ({ visible: true, strokes: l.strokes.concat([stroke]) }));
  }

  // The eraser works on the layer being drawn on.
  eraseAt(events) {
    const layer = this.activeLayer();
    if (!layer || !layer.visible) return;
    const o = this.origin();
    const r = this.erasing.size / 2;
    let strokes = layer.strokes;
    for (const e of events) {
      const [x, y] = this.toNote(e, o);
      strokes = strokes.filter((stroke) => !touches(stroke, x, y, r));
    }
    if (strokes.length !== layer.strokes.length) {
      this.layers = this.layers.map((l) => (l === layer ? Object.assign({}, l, { strokes }) : l));
      this.schedule();
    }
  }

  // The layer sits over the note, so it passes the mouse wheel on to keep the note scrolling.
  onWheel(e) {
    if (!this.drawing || e.ctrlKey || !this.scroller) return;
    e.preventDefault();
    const step = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.scroller.clientHeight : 1;
    this.scroller.scrollBy(e.deltaX * step, e.deltaY * step);
  }

  // -------------------------------------------------------------------------
  // Painting
  // -------------------------------------------------------------------------

  resize() {
    if (this.destroyed) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(this.el.clientWidth * dpr);
    const h = Math.round(this.el.clientHeight * dpr);
    for (const canvas of [this.markerCanvas, this.penCanvas]) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }
    this.schedule();
  }

  schedule() {
    if (!this.frame && !this.destroyed) this.frame = requestAnimationFrame(() => this.paint());
  }

  paint() {
    this.frame = 0;
    const view = this.view.getMode() === 'preview' ? 'preview' : 'source';
    if (view !== this.mode) {
      this.sync();
      return;
    }
    const marker = this.markerCanvas.getContext('2d');
    const pen = this.penCanvas.getContext('2d');
    for (const ctx of [marker, pen]) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.penCanvas.width, this.penCanvas.height);
    }
    if (!this.scroller || !this.el.clientHeight) return;
    if (!this.scroller.isConnected) this.scroller = this.findScroller();
    const dpr = window.devicePixelRatio || 1;
    const o = this.origin();
    const top = -o.y;
    const bottom = top + this.el.clientHeight;
    for (const ctx of [marker, pen]) ctx.setTransform(dpr, 0, 0, dpr, o.x * dpr, o.y * dpr);
    const paint = (stroke) => paintStroke(stroke.tool === 'highlighter' ? marker : pen, stroke);
    // Layers from the back to the front.
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      for (const stroke of layer.strokes) {
        if (!stroke.points.length) continue;
        const b = boundsOf(stroke);
        if (b.bottom + stroke.size < top || b.top - stroke.size > bottom) continue;
        paint(stroke);
      }
    }
    // The stroke being drawn keeps growing, so it is painted without bounds to go stale.
    if (this.current && this.current.points.length) paint(this.current);
  }
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

class DrawOnNotesSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display() {
    const el = this.containerEl;
    const plugin = this.plugin;
    el.empty();

    // A thank-you at the top, for anyone who'd like to support the plugin.
    const support = el.createDiv('draw-on-notes-support');
    const words = support.createDiv('draw-on-notes-support-text');
    words.createDiv({ cls: 'draw-on-notes-support-title', text: 'Enjoying Draw on Notes?' });
    words.createDiv({ cls: 'draw-on-notes-support-desc', text: 'It is made by one person in their spare time. A coffee keeps the ink flowing.' });
    const coffee = support.createEl('a', { cls: 'draw-on-notes-coffee', attr: { href: SUPPORT_URL, target: '_blank', rel: 'noopener', 'aria-label': 'Buy me a coffee (opens in your browser)' } });
    setIcon(coffee.createSpan('draw-on-notes-coffee-icon'), 'coffee');
    coffee.createSpan({ text: 'Buy me a coffee' });

    new Setting(el)
      .setName('Show drawings')
      .setDesc('Show your drawings on top of your notes when you are not drawing. They are always shown while you draw.')
      .addToggle((t) => t.setValue(plugin.settings.showDrawings).onChange((v) => plugin.setShowDrawings(v)));

    new Setting(el).setName('Shortcuts').setHeading();
    const keys = el.createDiv('draw-on-notes-keys');
    for (const [key, what] of [
      ['P', 'Pen'],
      ['H', 'Highlighter'],
      ['E', 'Eraser'],
      ['L', 'Show or hide layers'],
      ['[  ]', 'Smaller or bigger'],
      ['Shift', 'Hold for a straight line'],
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z', 'Redo'],
      ['Esc', 'Stop drawing'],
    ]) {
      const row = keys.createDiv('draw-on-notes-key-row');
      row.createEl('kbd', { text: key });
      row.createSpan({ text: what });
    }
    el.createDiv({
      cls: 'setting-item-description draw-on-notes-keys-note',
      text: 'On a Mac, use Cmd for Ctrl. The eraser end of a stylus erases, and the mouse wheel scrolls the note while you draw. To start drawing from the keyboard, give "Start or stop drawing on this note" a hotkey.',
    });

    new Setting(el).setName('Your drawings').setHeading();
    const count = Object.keys(plugin.drawings).length;
    let armed = null;
    new Setting(el)
      .setName('Delete all drawings')
      .setDesc(count === 1 ? 'You have drawings on 1 note.' : `You have drawings on ${count} notes.`)
      .addButton((b) => b
        .setButtonText('Delete all')
        .setWarning()
        .setDisabled(!count)
        .onClick(() => {
          if (!armed) {
            b.setButtonText('Click again to delete');
            armed = window.setTimeout(() => {
              armed = null;
              b.setButtonText('Delete all');
            }, 4000);
            return;
          }
          window.clearTimeout(armed);
          plugin.drawings = {};
          for (const surface of plugin.surfaces.values()) surface.reload();
          plugin.requestSave();
          new Notice('All drawings deleted.');
          this.display();
        }));
  }
}
