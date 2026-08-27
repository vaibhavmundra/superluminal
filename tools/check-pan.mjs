// ---------------------------------------------------------------------------
// check-pan.mjs — middle-button panning, on both canvases.
//
// NOT IN `npm test`: it needs playwright and a browser, like e2e.mjs and
// check-overlay.mjs. And it needs a browser for a reason that is not laziness —
// a pan is nothing but pointer events, and pointer events are where this app has
// been bitten hardest. The copy bug (a synthesized click that pointerdown could
// not stop) and the unclickable sconce (a grab area painted under the symbol it
// was meant to catch) were both invisible to every unit test in the repo and
// obvious the first time a real browser clicked the thing.
//
// WHAT IT ASSERTS, and why each one is a way this could plausibly break:
//   * a MIDDLE drag moves the plan                 — the feature
//   * a LEFT drag does not                         — panning must not steal the
//                                                    gesture tracing needs
//   * the cursor and the HUD say so WHILE dragging — feedback, not just effect
//   * mouseup ends it, INCLUDING outside the canvas — the listeners are on the
//     window precisely so that reaching the edge of what you are panning away
//     from does not end the pan
//   * no page errors throughout
//
// Pixels are compared as a FRACTION of the frame rather than for equality. A
// left drag legitimately repaints a few dozen pixels — the tracer draws a snap
// marker under the cursor — and a test that demanded a byte-identical frame
// would fail on that and teach everyone to ignore it.
//
//   npm i -D playwright && node tools/check-pan.mjs
// ---------------------------------------------------------------------------

import http from 'http';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { chromium } from 'playwright';

const ROOT = process.argv[2] || 'dist';
const PLAN = process.argv[3] || 'samples/hall.png';
const PORT = 5314;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.dxf': 'text/plain', '.json': 'application/json', '.jpg': 'image/jpeg' };

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`No build at ${ROOT}/index.html — run \`npm run build\` first, or pass a directory.`);
  process.exit(2);
}

const srv = http.createServer((q, r) => {
  let f = decodeURIComponent(q.url.split('?')[0]);
  if (f === '/') f = '/index.html';
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  r.end(fs.readFileSync(p));
});
await new Promise((r) => srv.listen(PORT, r));

/** Just enough PNG to count differing pixels without a dependency. */
function decode(buf) {
  let i = 8, w = 0, h = 0, ct = 0, idat = [];
  while (i < buf.length) {
    const ln = buf.readUInt32BE(i), typ = buf.toString('ascii', i + 4, i + 8);
    if (typ === 'IHDR') { w = buf.readUInt32BE(i + 8); h = buf.readUInt32BE(i + 12); ct = buf[i + 17]; }
    if (typ === 'IDAT') idat.push(buf.subarray(i + 8, i + 8 + ln));
    i += 12 + ln;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[ct];
  const stride = w * ch, out = Buffer.alloc(stride * h);
  let prev = Buffer.alloc(stride), pos = 0;
  for (let y = 0; y < h; y++) {
    const f = raw[pos++];
    const line = Buffer.from(raw.subarray(pos, pos + stride)); pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? line[x - ch] : 0, b = prev[x], c = x >= ch ? prev[x - ch] : 0;
      if (f === 1) line[x] = (line[x] + a) & 255;
      else if (f === 2) line[x] = (line[x] + b) & 255;
      else if (f === 3) line[x] = (line[x] + ((a + b) >> 1)) & 255;
      else if (f === 4) {
        const p0 = a + b - c;
        const pa = Math.abs(p0 - a), pb = Math.abs(p0 - b), pc = Math.abs(p0 - c);
        line[x] = (line[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
      }
    }
    line.copy(out, y * stride); prev = line;
  }
  return { w, h, ch, px: out };
}

/** What fraction of the frame changed. */
function changed(a, b) {
  const A = decode(a), B = decode(b);
  if (A.w !== B.w || A.h !== B.h) return 1;
  let n = 0;
  for (let i = 0; i < A.px.length; i += A.ch) {
    if (A.px[i] !== B.px[i] || A.px[i + 1] !== B.px[i + 1] || A.px[i + 2] !== B.px[i + 2]) n++;
  }
  return n / (A.px.length / A.ch);
}

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };

// CHROME_PATH is for a machine that has a Chromium but not playwright's own —
// a CI image, or this repo's cloud sandbox, where the browser is at a fixed path
// and `npx playwright install` has nothing to download from.
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !/fonts\.googleapis|ERR_TUNNEL|404/.test(m.text())) errs.push(m.text());
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(500);
await page.setInputFiles('input[type=file]', path.join(ROOT, PLAN));
await page.waitForTimeout(1200);
// The project-type dialog opens over the tracer on upload.
await page.getByText('Residential', { exact: false }).first().click();
await page.waitForTimeout(1200);

const hud = () => page.evaluate(() => document.querySelector('.tracer-hud')?.innerText || '');
const cursor = () => page.evaluate(() => getComputedStyle(document.querySelector('.tracer-plan')).cursor);

const canvas = page.locator('.tracer-plan canvas').first();
ok(await canvas.count() > 0, 'the tracer canvas is on screen');
const box = await canvas.boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

// PARK THE POINTER OFF-CANVAS BEFORE EVERY SHOT. The tracer draws a snap marker
// under the cursor, so a frame taken with the pointer over the plan differs from
// one taken with it elsewhere for reasons that have nothing to do with the pan.
const shot = async () => { await page.mouse.move(10, 10); await page.waitForTimeout(250); return canvas.screenshot(); };

console.log('-- the tracer (Konva) --');
const before = await shot();

await page.mouse.move(cx, cy);
await page.mouse.down({ button: 'left' });
for (let i = 1; i <= 8; i++) await page.mouse.move(cx - i * 20, cy - i * 12);
await page.mouse.up({ button: 'left' });
const afterLeft = await shot();
const dl = changed(before, afterLeft);
ok(dl < 0.01, `a LEFT drag does not pan: ${(dl * 100).toFixed(3)}% of the frame changed`);

await page.mouse.move(cx, cy);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(cx - 60, cy - 40);
await page.waitForTimeout(150);
const h = await hud();
ok(/panning/i.test(h), `the HUD says it is panning mid-gesture: "${h.replace(/\n/g, ' · ')}"`);
ok(await cursor() === 'grabbing', 'and the cursor is grabbing');
for (let i = 4; i <= 10; i++) await page.mouse.move(cx - i * 20, cy - i * 12);
await page.mouse.up({ button: 'middle' });
const afterMid = await shot();
const dm = changed(before, afterMid);
ok(dm > 0.05, `a MIDDLE drag moves the plan: ${(dm * 100).toFixed(1)}% of the frame changed`);
ok(!/panning/i.test(await hud()), 'and the pan ends on mouseup');
ok(await cursor() !== 'grabbing', 'with the cursor back to what it was');

// The listeners are on the WINDOW for exactly this: reaching the edge of the
// thing you are panning away from must not end the pan.
await page.mouse.move(cx, cy);
await page.mouse.down({ button: 'middle' });
await page.mouse.move(20, 20);
await page.mouse.up({ button: 'middle' });
await page.waitForTimeout(200);
ok(!/panning/i.test(await hud()), 'a release outside the canvas ends it too');

ok(errs.length === 0, `no page errors: ${errs.join(' | ') || 'none'}`);

await browser.close();
srv.close();
console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
