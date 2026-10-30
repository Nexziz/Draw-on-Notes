// Drives the real plugin on the test page and checks that drawing works.
const { chromium } = require('playwright');
const path = require('path');
const out = path.join(__dirname, 'out');
require('fs').mkdirSync(out, { recursive: true });

const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) process.exitCode = 1; };

async function stroke(page, pts) {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  await page.mouse.up();
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1100, height: 700 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('file://' + path.join(__dirname, 'page-light.html'));
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(100);

  const action = page.locator('.draw-on-notes-action');
  ok(await action.count() === 1, 'pen button added to the note header');
  ok(await page.locator('.draw-on-notes-layer').isHidden(), 'layer hidden while the note has no drawings');

  await action.click();
  ok(await page.locator('.draw-on-notes-toolbar').isVisible(), 'toolbar shows in drawing mode');
  ok(await action.evaluate((b) => b.classList.contains('is-active')), 'pen button shows it is active');

  const box = await page.locator('#t-eleven').boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const ring = [];
  for (let i = 0; i <= 40; i++) { const a = (i / 40) * Math.PI * 2.1 - 2; ring.push([cx + Math.cos(a) * (box.width / 2 + 10), cy + Math.sin(a) * (box.height / 2 + 7)]); }
  await stroke(page, ring);
  let n = await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length);
  ok(n === 1, 'drawing a stroke adds it to the note');

  // A mark in the margin, outside the text column.
  await stroke(page, [[1000, 200], [1010, 230], [1040, 170]]);
  n = await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length);
  ok(n === 2, 'drawing in the margin works');

  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('data')));
  ok(saved && saved.drawings['Proposals/Quieter onboarding.md'].preview.length === 2, 'strokes are saved under the note and view mode');

  // Undo and redo, from the keyboard.
  await page.keyboard.press('Control+z');
  n = await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length);
  ok(n === 1, 'Ctrl+Z undoes');
  await page.keyboard.press('Control+Shift+z');
  n = await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length);
  ok(n === 2, 'Ctrl+Shift+Z redoes');

  // Marks scroll with the note.
  const pixel = () => page.evaluate(({ x, y }) => {
    const layer = window.plugin.layers.get(window.view);
    const r = layer.el.getBoundingClientRect();
    const dpr = window.devicePixelRatio;
    return layer.penCanvas.getContext('2d').getImageData(Math.round((x - r.left) * dpr), Math.round((y - r.top) * dpr), 1, 1).data[3];
  }, { x: 1025, y: 200 });
  await page.waitForTimeout(50);
  ok(await pixel() > 0, 'margin mark is painted where it was drawn');
  await page.mouse.move(600, 400);
  await page.mouse.wheel(0, 100);
  await page.waitForTimeout(150);
  const scrolled = await page.evaluate(() => document.querySelector('.markdown-preview-view').scrollTop);
  ok(scrolled > 0, 'mouse wheel scrolls the note while drawing');
  ok(await pixel() === 0, 'the mark has moved off that spot after scrolling');
  const moved = await page.evaluate(({ y, s }) => {
    const layer = window.plugin.layers.get(window.view);
    const r = layer.el.getBoundingClientRect();
    return layer.penCanvas.getContext('2d').getImageData(Math.round((1025 - r.left) * devicePixelRatio), Math.round((y - s - r.top) * devicePixelRatio), 1, 1).data[3];
  }, { y: 200, s: scrolled });
  ok(moved > 0, 'the mark is painted higher up by exactly the scroll');
  await page.evaluate(() => { document.querySelector('.markdown-preview-view').scrollTop = 0; });
  await page.waitForTimeout(50);

  // Highlighter and toolbar controls.
  await page.keyboard.press('h');
  ok(await page.evaluate(() => window.plugin.settings.tool) === 'highlighter', 'H picks the highlighter');
  ok(await page.locator('.draw-on-notes-button.is-active[aria-label^="Highlighter"]').count() === 1, 'toolbar shows the highlighter picked');
  await page.locator('.draw-on-notes-swatch[aria-label="Green"]').click();
  ok(await page.evaluate(() => window.plugin.settings.highlighter.color) === '#2f9e44', 'a swatch sets the colour');
  await page.locator('.draw-on-notes-swatch[aria-label="Yellow"]').click();
  const hl = await page.locator('#t-hl').boundingBox();
  await stroke(page, [[hl.x, hl.y + hl.height / 2], [hl.x + hl.width * 0.5, hl.y + hl.height / 2], [hl.x + hl.width, hl.y + hl.height / 2]]);
  const last = await page.evaluate(() => { const s = window.plugin.layers.get(window.view).strokes; return s[s.length - 1]; });
  ok(last.tool === 'highlighter' && last.color === '#fab005' && last.opacity === 40, 'highlighter stroke has its colour and transparency');

  // Size and transparency sliders.
  await page.keyboard.press('p');
  const sliders = page.locator('.draw-on-notes-slider input');
  await sliders.nth(0).fill('12');
  await sliders.nth(1).fill('50');
  const pen = await page.evaluate(() => window.plugin.settings.pen);
  ok(pen.size === 12 && pen.opacity === 50, 'size and transparency sliders set the pen');
  await sliders.nth(0).fill('3');
  await sliders.nth(1).fill('100');

  // Eraser removes what it touches, as one undo step.
  await page.keyboard.press('e');
  n = await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length);
  await stroke(page, [[995, 190], [1015, 215], [1030, 190]]);
  let m = await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length);
  ok(m === n - 1, 'eraser removes the stroke it touches');
  await page.keyboard.press('Control+z');
  m = await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length);
  ok(m === n, 'undo brings an erased stroke back');

  // Clear, then undo.
  await page.locator('.draw-on-notes-button[aria-label="Clear this note"]').click();
  ok(await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length) === 0, 'clear removes everything');
  await page.keyboard.press('Control+z');
  ok(await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length) === n, 'undo brings a clear back');

  // Leaving drawing mode keeps the marks visible but lets clicks through to the note.
  await page.keyboard.press('p');
  await page.keyboard.press('Escape');
  ok(await page.locator('.draw-on-notes-toolbar').count() === 0, 'Esc stops drawing');
  ok(await page.locator('.draw-on-notes-layer').isVisible(), 'drawings stay visible after drawing');
  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y).id, { x: cx, y: cy });
  ok(under === 't-eleven', 'clicks reach the note when not drawing');
  await page.screenshot({ path: path.join(out, 'reading.png') });

  // Editing view keeps its own drawings.
  await page.evaluate(() => { window.view.mode = 'source'; window.plugin.attachAll(); });
  ok(await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length) === 0, 'Editing view has its own, empty layer');
  await page.evaluate(() => { window.view.mode = 'preview'; window.plugin.attachAll(); });
  ok(await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length) === n, 'Reading view drawings come back');

  // A fresh load shows the saved drawings.
  await page.waitForTimeout(800);
  await page.reload();
  await page.evaluate(() => window.ready);
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => window.plugin.layers.get(window.view).strokes.length) === n, 'drawings survive a reload');
  ok(await page.locator('.draw-on-notes-layer').isVisible(), 'and show without entering drawing mode');

  // Settings.
  await page.evaluate(() => { window.plugin.tab.display(); document.querySelector('.settings').classList.add('open'); });
  ok(await page.locator('.draw-on-notes-coffee').getAttribute('href') === 'https://buymeacoffee.com/nexsiz', 'settings has the coffee link');
  await page.screenshot({ path: path.join(out, 'settings.png') });
  await page.locator('.draw-on-notes-support ~ .setting-item input[type=checkbox]').first().uncheck();
  ok(await page.locator('.draw-on-notes-layer').isHidden(), 'Show drawings off hides them');

  ok(errors.length === 0, 'no errors on the page' + (errors.length ? ': ' + errors.join(' | ') : ''));
  await browser.close();
})();
