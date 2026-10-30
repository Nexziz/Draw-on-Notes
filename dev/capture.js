// Records the README images from the real plugin running on the test page.
const { chromium } = require('playwright');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');
const { PNG } = require('pngjs');
const fs = require('fs');
const path = require('path');
const images = path.join(__dirname, '..', 'images');
fs.mkdirSync(images, { recursive: true });

const W = 960, H = 600;

async function open(browser, scale) {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
  await page.goto('file://' + path.join(__dirname, 'page-light.html'));
  await page.evaluate(() => { localStorage.clear(); });
  await page.reload();
  await page.evaluate(() => window.ready);
  // A visible pointer, since screenshots leave out the real one.
  await page.addStyleTag({ content: `#fake-cursor { position: fixed; z-index: 1000; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%; background: rgba(30,30,30,0.85); border: 2px solid #fff; box-shadow: 0 1px 4px rgba(0,0,0,.4); pointer-events: none; left: -50px; top: -50px; transition: none; }` });
  await page.evaluate(() => {
    const c = document.body.createDiv({ attr: { id: 'fake-cursor' } });
    document.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    document.addEventListener('pointermove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
  });
  await page.waitForTimeout(100);
  return page;
}

const rect = (page, sel) => page.locator(sel).boundingBox();

// Shapes, as lists of points.
function ellipse(b, padX = 10, padY = 7) {
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2, pts = [];
  for (let i = 0; i <= 44; i++) {
    const a = -2.2 + (i / 44) * Math.PI * 2.15;
    const wobble = 1 + 0.04 * Math.sin(i * 0.7);
    pts.push([cx + Math.cos(a) * (b.width / 2 + padX) * wobble, cy + Math.sin(a) * (b.height / 2 + padY)]);
  }
  return pts;
}
const check = (x, y) => [[x, y], [x + 4, y + 5], [x + 8, y + 10], [x + 14, y + 1], [x + 20, y - 8], [x + 25, y - 14]];
const line = (x1, y1, x2, y2, n = 16, wave = 0) => Array.from({ length: n + 1 }, (_, i) => [x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n + (wave ? Math.sin(i * 1.3) * wave : 0)]);
function question(x, y) {
  const pts = [];
  for (let i = 0; i <= 14; i++) { const a = Math.PI * 1.1 - (i / 14) * Math.PI * 1.45; pts.push([x + Math.cos(a) * 8, y + Math.sin(a) * -8 + 2]); }
  pts.push([x + 2, y + 10], [x + 1, y + 16]);
  return pts;
}
function arrow(x1, y1, x2, y2) {
  const pts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push([x1 + (x2 - x1) * t + Math.sin(t * Math.PI) * 14, y1 + (y2 - y1) * t]); }
  return pts;
}
function arrowHead(x, y, dx, dy) {
  const len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len, s = 13;
  const side = (k) => [x - ux * s - uy * s * 0.6 * k, y - uy * s + ux * s * 0.6 * k];
  return [side(1), [x, y], side(-1)];
}
const bracket = (x, y1, y2) => [[x + 8, y1], [x, y1 + 6], [x, y2 - 6], [x + 8, y2]];

async function stroke(page, pts, snap, every = 3) {
  await page.mouse.move(pts[0][0], pts[0][1]);
  await page.mouse.down();
  for (let i = 1; i < pts.length; i++) {
    await page.mouse.move(pts[i][0], pts[i][1], { steps: 2 });
    if (snap && i % every === 0) await snap(40);
  }
  await page.mouse.up();
  if (snap) await snap(120);
}

async function glide(page, x, y, snap, frames = 6) {
  const from = await page.evaluate(() => { const c = document.getElementById('fake-cursor'); return [parseFloat(c.style.left) || 480, parseFloat(c.style.top) || 300]; });
  for (let i = 1; i <= frames; i++) {
    const t = i / frames, e = t * t * (3 - 2 * t);
    await page.mouse.move(from[0] + (x - from[0]) * e, from[1] + (y - from[1]) * e);
    if (snap) await snap(30);
  }
}

async function setTool(page, tool, snap) {
  const b = await rect(page, `.draw-on-notes-button[aria-label^="${tool}"]`);
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, snap);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  if (snap) await snap(250);
}

async function pick(page, color, snap) {
  const b = await rect(page, `.draw-on-notes-swatch[aria-label="${color}"]`);
  await glide(page, b.x + b.width / 2, b.y + b.height / 2, snap);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  if (snap) await snap(250);
}

// Drags a toolbar slider to a value, with the pointer following the thumb.
async function slide(page, index, to, snap) {
  const input = page.locator('.draw-on-notes-slider input').nth(index);
  const b = await input.boundingBox();
  const [min, max, from] = await input.evaluate((el) => [Number(el.min), Number(el.max), Number(el.value)]);
  const xAt = (v) => b.x + 7 + (b.width - 14) * (v - min) / (max - min);
  await glide(page, xAt(from), b.y + b.height / 2, snap);
  if (snap) await snap(150);
  const steps = 10;
  for (let i = 1; i <= steps; i++) {
    const v = Math.round(from + (to - from) * i / steps);
    await page.mouse.move(xAt(v), b.y + b.height / 2);
    await input.evaluate((el, v) => { el.value = String(v); el.dispatchEvent(new Event('input')); }, v);
    if (snap) await snap(45);
  }
  if (snap) await snap(200);
}

function recorder(page) {
  const frames = [];
  const snap = async (delay) => {
    const png = PNG.sync.read(await page.screenshot());
    frames.push({ png, delay });
  };
  snap.frames = frames;
  return snap;
}

function writeGif(file, frames) {
  const gif = GIFEncoder();
  const first = frames[0].png, last = frames[frames.length - 1].png;
  const sample = new Uint8Array(first.data.length * 2);
  sample.set(first.data, 0);
  sample.set(last.data, first.data.length);
  const palette = quantize(sample, 255);
  const clear = palette.length;
  const withClear = palette.concat([[255, 0, 255]]);
  let prev = null;
  frames.forEach(({ png, delay }, n) => {
    const index = applyPalette(png.data, palette);
    const out = new Uint8Array(index);
    if (prev) for (let i = 0; i < index.length; i++) if (index[i] === prev[i]) out[i] = clear;
    gif.writeFrame(out, png.width, png.height, n === 0
      ? { palette: withClear, delay, transparent: true, transparentIndex: clear, dispose: 1 }
      : { delay, transparent: true, transparentIndex: clear, dispose: 1 });
    prev = index;
  });
  gif.finish();
  fs.writeFileSync(file, gif.bytes());
  console.log(path.basename(file), frames.length, 'frames', Math.round(fs.statSync(file).size / 1024) + ' KB');
}

// The marks for the hero image and the markup demo.
async function markUp(page, snap) {
  const s = (pts, every) => stroke(page, pts, snap, every);
  await s(ellipse(await rect(page, '#t-eleven')));
  await setTool(page, 'Highlighter', snap);
  const t = await rect(page, '#t-time');
  await s(line(t.x - 2, t.y + t.height / 2 + 1, t.x + t.width + 2, t.y + t.height / 2, 12), 2);
  await setTool(page, 'Pen', snap);
  await pick(page, 'Green', snap);
  for (const id of ['#t-li1', '#t-li2']) {
    const b = await rect(page, id);
    await s(check(b.x - 58, b.y + b.height / 2 - 2), 2);
  }
  await pick(page, 'Purple', snap);
  const li3 = await rect(page, '#t-li3');
  await s(question(li3.x - 44, li3.y + 2), 4);
  await pick(page, 'Red', snap);
  const p = await rect(page, '#t-hl');
  await s(arrow(p.x + 760, p.y - 70, p.x + 720, p.y + 4), 4);
  await s(arrowHead(p.x + 720, p.y + 4, -14, 34), 1);
  await s(line(p.x + 30, p.y + 22, p.x + 420, p.y + 22, 18, 1.5), 4);
}

(async () => {
  const browser = await chromium.launch();

  // Hero: drawing mode with a marked-up note.
  {
    const page = await open(browser, 2);
    await page.click('.draw-on-notes-action');
    await markUp(page, null);
    await page.evaluate(() => document.getElementById('fake-cursor').remove());
    await page.evaluate(() => document.querySelectorAll('.notice').forEach((n) => n.remove()));
    await page.screenshot({ path: path.join(images, 'hero.png') });
    console.log('hero.png', Math.round(fs.statSync(path.join(images, 'hero.png')).size / 1024) + ' KB');
    await page.close();
  }

  // Marking up a note, from clicking the pen to Done.
  {
    const page = await open(browser, 1);
    const snap = recorder(page);
    await page.mouse.move(700, 300);
    await snap(700);
    const pen = await rect(page, '.draw-on-notes-action');
    await glide(page, pen.x + pen.width / 2, pen.y + pen.height / 2, snap, 10);
    await page.mouse.click(pen.x + pen.width / 2, pen.y + pen.height / 2);
    await snap(500);
    await markUp(page, snap);
    const done = await rect(page, '.draw-on-notes-done');
    await glide(page, done.x + done.width / 2, done.y + done.height / 2, snap, 10);
    await page.mouse.click(done.x + done.width / 2, done.y + done.height / 2);
    await page.evaluate(() => { document.getElementById('fake-cursor').style.left = '-50px'; });
    await snap(2500);
    writeGif(path.join(images, 'markup-demo.gif'), snap.frames);
    await page.close();
  }

  // Colour, size and transparency.
  {
    const page = await open(browser, 1);
    await page.click('.draw-on-notes-action');
    await page.evaluate(() => { document.querySelector('.markdown-preview-view').scrollTop = 0; });
    const snap = recorder(page);
    await page.mouse.move(880, 200);
    await snap(600);
    const y0 = 170;
    const wave = (y) => line(862, y, 938, y, 16, 4);
    await stroke(page, wave(y0), snap, 4);
    await pick(page, 'Blue', snap);
    await stroke(page, wave(y0 + 40), snap, 4);
    await slide(page, 0, 12, snap);
    await stroke(page, wave(y0 + 85), snap, 4);
    await slide(page, 1, 35, snap);
    await stroke(page, wave(y0 + 135), snap, 4);
    await setTool(page, 'Highlighter', snap);
    await pick(page, 'Orange', snap);
    const b = await rect(page, '#t-li2');
    await stroke(page, line(b.x - 2, b.y + b.height / 2, b.x + b.width * 0.62, b.y + b.height / 2, 12), snap, 2);
    await page.evaluate(() => { document.getElementById('fake-cursor').style.left = '-50px'; });
    await snap(2500);
    writeGif(path.join(images, 'pen-settings.gif'), snap.frames);
    await page.close();
  }

  await browser.close();
})();
