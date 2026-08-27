// ---------------------------------------------------------------------------
// check-tracer.mjs — the space-edges screen, in a real browser.
//
// NOT IN `npm test`: needs playwright and a browser, like e2e.mjs,
// check-doors.mjs, check-overlay.mjs and check-pan.mjs. The arithmetic of
// outlines, snapping and stats is covered by tools/test-outline.mjs and
// tools/test-snap.mjs; what only a browser can check is what is ON SCREEN and
// what the pointer does, and that is where this screen kept going wrong:
//
//   * the spaces are drawn in DISTINCT HUES, not a ramp of greys. Eight
//     polygons edge to edge on a line drawing have no symbol to tell them
//     apart, so the fill is the only thing doing it, and eight greys at 0.1
//     opacity read as eight shades of the drawing.
//   * the swatch beside each name in the panel is the SAME hue as its polygon —
//     that is the whole link between the list and the plan.
//   * NO name/area writeup is drawn on the plan. It is in the panel already.
//   * hovering ANY space thickens its outline, and only that one's.
//   * one section per subject: the detector's tally and the list of spaces it
//     produced are in "Spaces on the plan" together, snapping to what is
//     already traced is a checkbox inside "Snapping", and there is no Grid
//     control at all.
//
// The door route is stubbed so the scale can be set without a key or a network;
// two spaces are then traced by clicking corners, which is also the only way to
// get a screen with more than one hue on it.
//
//   npm i -D playwright && node tools/check-tracer.mjs [dist] [samples/FLOOR_PLAN_03.png]
// ---------------------------------------------------------------------------

import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';
const ROOT = process.argv[2] || 'dist';
const PLAN = process.argv[3] || 'samples/FLOOR_PLAN_03.png';
const PORT = 5327;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.woff2':'font/woff2', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.json':'application/json', '.dxf':'text/plain' };

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`No build at ${ROOT}/index.html — run \`npm run build\` first, or pass a directory.`);
  process.exit(2);
}
const srv = http.createServer((q, r) => {
  let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/') f = '/index.html';
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) { r.writeHead(404); return r.end('nf'); }
  r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  r.end(fs.readFileSync(p));
});
await new Promise((r) => srv.listen(PORT, r));
const br = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const pg = await br.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; pg.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
let fail = 0; const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };

await pg.route('**/api/**', async (route) => {
  const body = route.request().postDataJSON?.() || {};
  if (body.task === 'doors') {
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      meta: { id: 'test', task: 'doors' },
      result: [{ count_objects: 4, predictions: { image: { width: 1042, height: 1642 }, predictions: [
        { x:753, y:181.5, width:150, height:193, confidence:0.999, class:'door' },
        { x:413, y:762,   width:120, height:115, confidence:0.97,  class:'door' },
        { x:551, y:1006,  width:120, height:145, confidence:0.96,  class:'door' },
        { x:757, y:1152,  width:105, height:95,  confidence:0.93,  class:'door' },
      ] } }],
    })});
  }
  return route.fulfill({ status: 502, contentType: 'application/json', body: '{"error":"offline in test"}' });
});

await pg.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await pg.waitForTimeout(400);
await pg.setInputFiles('input[type=file]', path.join(ROOT, PLAN));
await pg.waitForTimeout(900);
await pg.getByText('Residential', { exact: false }).first().click();
await pg.waitForSelector('.modal-wrap', { state: 'detached', timeout: 9000 });
await pg.waitForTimeout(800);

// --- set the scale off a door, so there is a tracer to look at ------------
const cbox = await pg.locator('.tracer-plan canvas').first().boundingBox();
const doors = await pg.evaluate(() => window.Konva.stages[0].find('Rect')
  .filter((n) => String(n.fill() || '').includes('0,112,243'))
  .map((n) => { const r = n.getClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }));
await pg.mouse.click(cbox.x + doors[0].x + doors[0].w / 2, cbox.y + doors[0].y + doors[0].h / 2);
await pg.waitForTimeout(250);
await pg.getByRole('button', { name: '900mm' }).click();
await pg.waitForTimeout(600);

// --- trace two spaces by clicking corners ---------------------------------
const trace = async (x, y, w, h) => {
  for (const [dx, dy] of [[0,0],[w,0],[w,h],[0,h]]) {
    await pg.mouse.click(cbox.x + x + dx, cbox.y + y + dy);
    await pg.waitForTimeout(130);
  }
  await pg.keyboard.press('Enter');
  await pg.waitForTimeout(340);
};
await trace(300, 260, 150, 110);
await pg.waitForTimeout(300);
await trace(300, 470, 150, 110);
await pg.waitForTimeout(500);

const side = await pg.locator('.rooms-side').innerText();
const secs = await pg.locator('.rooms-side .sec h3').allInnerTexts();
console.log('  ..  sections: ' + JSON.stringify(secs));

// --- ONE SECTION PER SUBJECT ----------------------------------------------
ok(await pg.locator('.rooms-side select').count() === 0,
   'no dropdown left in the panel — the Grid control is gone');
ok(!/rounds the space's dimensions/.test(side), 'and the note explaining it went too');
ok(!secs.some((t) => /^SNAP TO$/i.test(t)), 'no standalone "Snap to" section');
ok(!secs.some((t) => /^OUTLINES$/i.test(t)), 'no standalone "Outlines" section');
ok(secs.some((t) => /SPACES ON THE PLAN/i.test(t)) && secs.some((t) => /SNAPPING/i.test(t)),
   'the two that remain are "Spaces on the plan" and "Snapping"');

const secText = (re) => pg.evaluate((src) => {
  const s = [...document.querySelectorAll('.rooms-side .sec')]
    .find((x) => new RegExp(src, 'i').test(x.querySelector('h3')?.textContent || ''));
  return s ? s.innerText : '';
}, re);
const snapSec = await secText('snapping');
ok(/Outlines already traced/.test(snapSec),
   `"Outlines already traced" is a checkbox inside Snapping: "${snapSec.replace(/\n/g, ' | ')}"`);
const spaceSec = await secText('spaces on the plan');
ok(/Space 1/.test(spaceSec) && /Space 2/.test(spaceSec),
   'and both spaces are listed inside "Spaces on the plan"');
ok(await pg.locator('.rooms-side .sec .space-list').count() === 1, 'as one .space-list');

// --- THE HUES ARE BACK ----------------------------------------------------
const isGrey = (c) => { const m = c.match(/\d+/g).map(Number); return m[0] === m[1] && m[1] === m[2]; };
const dots = await pg.evaluate(() => [...document.querySelectorAll('.room-dot')]
  .map((d) => getComputedStyle(d).backgroundColor));
ok(dots.length >= 2 && dots.every((c) => !isGrey(c)),
   `the panel swatches are hues, not greys: ${dots.join(', ')}`);
ok(new Set(dots).size === dots.length, 'and no two spaces share one');

const polys = await pg.evaluate(() => window.Konva.stages[0].find('Line')
  .filter((n) => n.closed() && n.fill())
  .map((n) => { const r = n.getClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, sw: n.strokeWidth(), col: n.stroke() }; }));
ok(polys.length === dots.length, `one polygon per listed space: ${polys.length} vs ${dots.length}`);
ok(polys.every((p) => !isGrey(p.col.replace('#', '').match(/../g).map((h) => parseInt(h, 16)).join(','))),
   `the polygons on the plan are hues too: ${polys.map((p) => p.col).join(', ')}`);
ok(polys.every((p, i) => {
  const [r, g, b] = p.col.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
  return dots[i] === `rgb(${r}, ${g}, ${b})`;
}), 'and each swatch is its own polygon’s hue, which is what links the list to the plan');

// --- NOTHING IS WRITTEN ON THE PLAN --------------------------------------
const texts = await pg.evaluate(() => window.Konva.stages[0].find('Text').map((n) => n.text()));
ok(texts.length === 0,
   `no name, size or area drawn over the spaces — it is all in the panel: ${JSON.stringify(texts)}`);

// --- HOVER ANSWERS THE POINTER, ON ANY SPACE ----------------------------
for (let j = 0; j < polys.length; j++) {
  await pg.mouse.move(cbox.x + polys[j].x + polys[j].w / 2, cbox.y + polys[j].y + polys[j].h / 2);
  await pg.waitForTimeout(280);
  const now = await pg.evaluate(() => window.Konva.stages[0].find('Line')
    .filter((n) => n.closed() && n.fill()).map((n) => n.strokeWidth()));
  ok(now[j] > polys[j].sw + 0.5,
     `hovering space ${j + 1} thickens its outline: ${polys[j].sw.toFixed(2)} -> ${now[j].toFixed(2)}`);
  ok(polys.every((q, k) => k === j || Math.abs(now[k] - q.sw) < 0.01),
     '  ...and leaves every other space where it was');
}

ok(errs.length === 0, `no page errors: ${errs.join(' | ') || 'none'}`);
await br.close(); srv.close();
console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
