// Drives the real plugin on the test page and checks that drawing works.
const { chromium } = require('playwright');
const path = require('path');
const out = path.join(__dirname, 'out');
require('fs').mkdirSync(out, { recursive: true });

const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };
const NOTE = 'Proposals/Quieter onboarding.md';

async function stroke(page, pts, { shift } = {}) {
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
  if (shift) await page.keyboard.up('Shift');
}

// What the drawing surface over the note holds.
const count = (page) => page.evaluate(() => window.plugin.surfaces.get(window.view).strokeCount());
const layers = (page) => page.evaluate(() => {
  const s = window.plugin.surfaces.get(window.view);
  return { active: s.activeId, layers: s.layers.map((l) => ({ id: l.id, name: l.name, visible: l.visible, strokes: l.strokes.length })) };
});
const lastStroke = (page) => page.evaluate(() => {
  const s = window.plugin.surfaces.get(window.view);
  const strokes = s.activeLayer().strokes;
  return strokes[strokes.length - 1];
});
const alphaAt = (page, x, y) => page.evaluate(({ x, y }) => {
  const s = window.plugin.surfaces.get(window.view);
  const r = s.el.getBoundingClientRect();
  return s.penCanvas.getContext('2d').getImageData(Math.round((x - r.left) * devicePixelRatio), Math.round((y - r.top) * devicePixelRatio), 1, 1).data[3];
}, { x, y });

function pathLength(points) {
  let length = 0;
  for (let i = 2; i < points.length; i += 2) length += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]);
  return length;
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('file://' + path.join(__dirname, 'page-light.html'));
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(100);

  const action = page.locator('.draw-on-notes-action');
  ok(await action.count() === 1, 'pen button added to the note header');
  ok(await page.locator('.draw-on-notes-layer').isHidden(), 'layer hidden while the note has no drawings');

  await action.click();
  ok(await page.locator('.draw-on-notes-toolbar').isVisible(), 'toolbar shows in drawing mode');
  ok(await action.evaluate((b) => b.classList.contains('is-active')), 'pen button shows it is active');

  // Swatches show their colours, even with the theme colouring every button.
  const swatchColor = await page.locator('.draw-on-notes-swatch[aria-label="Blue"]').evaluate((el) => getComputedStyle(el).backgroundColor);
  ok(swatchColor === 'rgb(25, 113, 194)', 'swatches show their colours under a theme\'s button styles (' + swatchColor + ')');
  ok(await page.locator('.draw-on-notes-preview-dot').evaluate((el) => getComputedStyle(el).backgroundColor) === 'rgb(224, 49, 49)', 'brush preview shows the pen colour');

  const box = await page.locator('#t-eleven').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const ring = [];
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2.1 - 2; ring.push([cx + Math.cos(a) * (box.width / 2 + 10), cy + Math.sin(a) * (box.height / 2 + 7)]); }
  await stroke(page, ring);
  ok(await count(page) === 1, 'drawing a stroke adds it to the note');

  // A mark in the margin, outside the text column.
  await stroke(page, [[1000, 230], [1010, 260], [1040, 200]]);
  ok(await count(page) === 2, 'drawing in the margin works');

  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('data')));
  ok(saved && saved.drawings[NOTE].preview.layers[0].strokes.length === 2, 'strokes are saved under the note, view mode and layer');

  // Undo and redo, from the keyboard.
  await page.keyboard.press('Control+z');
  ok(await count(page) === 1, 'Ctrl+Z undoes');
  await page.keyboard.press('Control+Shift+z');
  ok(await count(page) === 2, 'Ctrl+Shift+Z redoes');

  // Marks scroll with the note.
  await page.waitForTimeout(50);
  ok(await alphaAt(page, 1025, 230) > 0, 'margin mark is painted where it was drawn');
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(150);
  const scrolled = await page.evaluate(() => document.querySelector('.markdown-preview-view').scrollTop);
  ok(scrolled > 0, 'mouse wheel scrolls the note while drawing');
  ok(await alphaAt(page, 1025, 230) === 0, 'the mark has moved off that spot after scrolling');
  ok(await alphaAt(page, 1025, 230 - scrolled) > 0, 'the mark is painted higher up by exactly the scroll');
  await page.evaluate(() => { document.querySelector('.markdown-preview-view').scrollTop = 0; });
  await page.waitForTimeout(50);

  // Highlighter and toolbar controls.
  await page.keyboard.press('h');
  ok(await page.evaluate(() => window.plugin.settings.tool) === 'highlighter', 'H picks the highlighter');
  ok(await page.locator('.draw-on-notes-button.is-active[aria-label^="Highlighter"]').count() === 1, 'toolbar shows the highlighter picked');
  await page.locator('.draw-on-notes-swatch[aria-label="Green"]').click();
  ok(await page.evaluate(() => window.plugin.settings.highlighter.color) === '#2f9e44', 'a swatch sets the colour');
  await page.locator('.draw-on-notes-swatch[aria-label="Yellow"]').click();
  const hl = await page.locator('#t-time').boundingBox();
  await stroke(page, [[hl.x, hl.y + hl.height / 2], [hl.x + hl.width * 0.5, hl.y + hl.height / 2], [hl.x + hl.width, hl.y + hl.height / 2]]);
  const last = await lastStroke(page);
  ok(last.tool === 'highlighter' && last.color === '#fab005' && last.opacity === 40, 'highlighter stroke has its colour and opacity');

  // Size, opacity and smoothing sliders.
  await page.keyboard.press('p');
  const sliders = page.locator('.draw-on-notes-slider input');
  await sliders.nth(0).fill('12');
  await sliders.nth(1).fill('50');
  const pen = await page.evaluate(() => window.plugin.settings.pen);
  ok(pen.size === 12 && pen.opacity === 50, 'size and opacity sliders set the pen');
  ok(await page.locator('.draw-on-notes-preview-dot').evaluate((el) => getComputedStyle(el).width) === '12px', 'brush preview grows with the size');
  await sliders.nth(0).fill('3');
  await sliders.nth(1).fill('100');

  // Smoothing steadies a shaky line.
  const zigzag = Array.from({ length: 30 }, (_, i) => [300 + i * 12, 570 + (i % 2 ? 8 : -8)]);
  await sliders.nth(2).fill('0');
  await stroke(page, zigzag);
  const roughPoints = (await lastStroke(page)).points;
  const rough = pathLength(roughPoints);
  await page.keyboard.press('Control+z');
  await sliders.nth(2).fill('100');
  await stroke(page, zigzag);
  const smooth = pathLength((await lastStroke(page)).points);
  ok(await page.evaluate(() => window.plugin.settings.smoothing) === 100, 'smoothing slider sets the smoothing');
  ok(smooth < rough * 0.75, `smoothing steadies a shaky line (${Math.round(rough)}px of line down to ${Math.round(smooth)}px)`);
  const lastPoint = (await lastStroke(page)).points.slice(-2);
  const roughEnd = roughPoints.slice(-2);
  ok(Math.hypot(lastPoint[0] - roughEnd[0], lastPoint[1] - roughEnd[1]) < 1, 'a smoothed line still ends where the pen was lifted');
  await page.keyboard.press('Control+z');
  await sliders.nth(2).fill('30');

  // Shift draws straight lines, snapped level when close.
  await stroke(page, [[300, 580], [360, 570], [420, 590], [500, 582]], { shift: true });
  let line = await lastStroke(page);
  ok(line.points.length === 4, 'Shift draws a straight line, whatever the path');
  ok(line.points[1] === line.points[3], 'a nearly level Shift line snaps level');
  await stroke(page, [[300, 560], [340, 520], [372, 500]], { shift: true });
  line = await lastStroke(page);
  ok(line.points.length === 4 && line.points[3] !== line.points[1], 'a steep Shift line keeps its angle');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');

  // Layers, on the right.
  const panel = page.locator('.draw-on-notes-layers');
  ok(await panel.isVisible(), 'layers panel shows on the right while drawing');
  const pb = await panel.boundingBox();
  ok(pb.x + pb.width > 1000 && pb.x > 800, 'layers panel sits at the right side');
  let state = await layers(page);
  ok(state.layers.length === 1 && state.layers[0].name === 'Layer 1' && state.layers[0].strokes === 3, 'a note starts with one layer holding its strokes');
  await page.locator('.draw-on-notes-layers-head .draw-on-notes-button[aria-label="New layer"]').click();
  state = await layers(page);
  ok(state.layers.length === 2 && state.layers[1].name === 'Layer 2' && state.active === state.layers[1].id, 'New layer adds Layer 2 on top and picks it');
  ok(await page.locator('.draw-on-notes-layer-row').first().textContent().then((t) => t.includes('Layer 2')), 'the front layer is listed first');
  await stroke(page, [[400, 590], [500, 600]]);
  state = await layers(page);
  ok(state.layers[0].strokes === 3 && state.layers[1].strokes === 1, 'drawing goes on the picked layer');

  // The eraser works on the picked layer only.
  await page.keyboard.press('e');
  await stroke(page, [[1010, 240], [1025, 230], [1030, 215]]);
  ok((await layers(page)).layers[0].strokes === 3, 'the eraser leaves other layers alone');
  await page.keyboard.press('p');

  // Picking, hiding, renaming, moving and deleting layers.
  await page.locator('.draw-on-notes-layer-row', { hasText: 'Layer 1' }).click();
  ok((await layers(page)).active === state.layers[0].id, 'clicking a layer picks it');
  await page.locator('.draw-on-notes-layer-row', { hasText: 'Layer 1' }).locator('.draw-on-notes-eye').click();
  ok((await layers(page)).layers[0].visible === false, 'the eye hides a layer');
  await page.waitForTimeout(50);
  ok(await alphaAt(page, 1025, 230) === 0, 'a hidden layer is not painted');
  await page.locator('.draw-on-notes-layer-row', { hasText: 'Layer 1' }).locator('.draw-on-notes-eye').click();
  await page.waitForTimeout(50);
  ok(await alphaAt(page, 1025, 230) > 0, 'showing it paints it again');
  await page.locator('.draw-on-notes-layer-row', { hasText: 'Layer 2' }).locator('.draw-on-notes-layer-name').dblclick();
  await page.keyboard.type('Questions');
  await page.keyboard.press('Enter');
  ok((await layers(page)).layers[1].name === 'Questions', 'double-clicking a layer renames it');
  ok(await page.evaluate(() => window.plugin.settings.tool) === 'pen', 'typing a name does not switch tools');
  await page.locator('.draw-on-notes-layer-row', { hasText: 'Questions' }).click();
  await page.locator('.draw-on-notes-layer-row.is-active .draw-on-notes-button[aria-label="Move down"]').click();
  state = await layers(page);
  ok(state.layers[0].name === 'Questions' && state.layers[1].name === 'Layer 1', 'Move down sends a layer back');
  await page.locator('.draw-on-notes-layer-row.is-active .draw-on-notes-button[aria-label="Delete layer"]').click();
  state = await layers(page);
  ok(state.layers.length === 1 && state.layers[0].name === 'Layer 1', 'Delete layer removes it');
  await page.keyboard.press('Control+z');
  ok((await layers(page)).layers.length === 2, 'undo brings a deleted layer back');
  await page.keyboard.press('l');
  ok(await panel.count() === 0, 'L hides the layers panel');
  await page.keyboard.press('l');
  ok(await panel.isVisible(), 'and L shows it again');

  // Clear the picked layer, then undo.
  await page.locator('.draw-on-notes-layer-row', { hasText: 'Layer 1' }).click();
  await page.locator('.draw-on-notes-button[aria-label="Clear this layer"]').click();
  state = await layers(page);
  ok(state.layers[1].strokes === 0 && state.layers[0].strokes === 1, 'clear empties only the picked layer');
  await page.keyboard.press('Control+z');
  ok(await count(page) === 4, 'undo brings a clear back');
  const n = await count(page);

  // Leaving drawing mode keeps the marks visible but lets clicks through to the note.
  await page.keyboard.press('Escape');
  ok(await page.locator('.draw-on-notes-toolbar').count() === 0, 'Esc stops drawing');
  ok(await panel.count() === 0, 'and puts the layers panel away');
  ok(await page.locator('.draw-on-notes-layer').isVisible(), 'drawings stay visible after drawing');
  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).id, { x: cx, y: cy });
  ok(under === 't-eleven', 'clicks reach the note when not drawing');
  await page.screenshot({ path: path.join(out, 'reading.png') });

  // Editing view keeps its own drawings.
  await page.evaluate(() => { window.view.mode = 'source'; window.plugin.attachAll(); });
  ok(await count(page) === 0, 'Editing view has its own, empty drawing');
  await page.evaluate(() => { window.view.mode = 'preview'; window.plugin.attachAll(); });
  ok(await count(page) === n, 'Reading view drawings come back');

  // A fresh load shows the saved drawings and layers.
  await page.waitForTimeout(800);
  await page.reload();
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(150);
  ok(await count(page) === n, 'drawings survive a reload');
  ok((await layers(page)).layers.map((l) => l.name).join() === 'Questions,Layer 1', 'and so do the layers');
  ok(await page.locator('.draw-on-notes-layer').isVisible(), 'and show without entering drawing mode');

  // Settings.
  await page.evaluate(() => { window.plugin.tab.display(); document.querySelector('.settings').classList.add('open'); });
  ok(await page.locator('.draw-on-notes-coffee').getAttribute('href') === 'https://buymeacoffee.com/nexsiz', 'settings has the coffee link');
  await page.screenshot({ path: path.join(out, 'settings.png') });
  await page.locator('.draw-on-notes-support ~ .setting-item input[type=checkbox]').first().uncheck();
  ok(await page.locator('.draw-on-notes-layer').isHidden(), 'Show drawings off hides them');

  // Drawings saved by 0.1.0, one list of strokes per note, open as Layer 1.
  await page.evaluate((note) => {
    const old = [{ tool: 'pen', color: '#e03131', size: 3, opacity: 100, points: [-100, 100, 0, 120] }];
    localStorage.setItem('data', JSON.stringify({ settings: { tool: 'pen' }, drawings: { [note]: { preview: old } } }));
  }, NOTE);
  await page.reload();
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(150);
  state = await layers(page);
  ok(state.layers.length === 1 && state.layers[0].name === 'Layer 1' && state.layers[0].strokes === 1, 'drawings from 0.1.0 open as Layer 1');

  ok(errors.length === 0, 'no errors on the page' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
})();
