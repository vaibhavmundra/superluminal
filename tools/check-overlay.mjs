// ---------------------------------------------------------------------------
// check-overlay.mjs — the two pictures the bed-fit judge is shown.
//
// NOT IN `npm test`, for the same reason e2e.mjs is not: it needs playwright
// and a browser. roomSnapshot() is canvas code, and the one property that
// matters about it here cannot be asserted from Node —
//
//   THE TWO IMAGES MUST DIFFER IN THE RECTANGLES AND IN NOTHING ELSE.
//
// If the crop, the scale, the wash or the ink differed between them, the model
// would have something to prefer that is not the geometry, and the verdict
// would be measuring that instead. This renders both, reads pixels back out,
// and checks it.
//
//   npm i -D playwright && node tools/check-overlay.mjs
// ---------------------------------------------------------------------------

import http from 'http';
import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

const ROOT = process.cwd();
const PORT = 5311;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };

const PAGE = `<!doctype html><meta charset=utf-8><body>
<img id="plan" src="/samples/bedroom-2bed.png">
<script type="module">
import { roomSnapshot } from '/src/lib/accentMask.js';
const el = document.getElementById('plan');
window.__ready = new Promise((r) => { el.complete ? r() : el.onload = r; });
window.__run = async () => {
  const source = { kind: 'raster', w: el.naturalWidth, h: el.naturalHeight, el, pxPerFt: 20 };
  const W = el.naturalWidth, H = el.naturalHeight;
  const poly = [{x:20,y:20},{x:W-20,y:20},{x:W-20,y:H-20},{x:20,y:H-20}];
  const A = [{ x0: W*0.15, y0: H*0.20, x1: W*0.45, y1: H*0.60 }];
  const B = [{ x0: W*0.55, y0: H*0.20, x1: W*0.85, y1: H*0.60 }];
  const mk = (boxes, badge) => roomSnapshot({ source, img: { el }, polygonPx: poly, boxes, badge });
  const [plain, a, b, again] = [await mk([], null), await mk(A, 'A'), await mk(B, 'B'), await mk(A, 'A')];
  const at = async (shot, fx, fy) => {
    const im = new Image(); im.src = shot.dataUrl;
    await new Promise((r) => { im.onload = r; });
    const c = document.createElement('canvas');
    c.width = im.width; c.height = im.height;
    const g = c.getContext('2d'); g.drawImage(im, 0, 0);
    const d = g.getImageData(Math.round(im.width*fx), Math.round(im.height*fy), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const red = (p) => p[0] > 200 && p[1] < 245 && p[2] < 245 && p[0] - p[1] > 10;
  const white = (p) => p[0] > 250 && p[1] > 250 && p[2] > 250;
  return {
    sameSize: a.w === b.w && a.h === b.h && a.w === plain.w && a.h === plain.h,
    sameCrop: JSON.stringify(a.crop) === JSON.stringify(b.crop) && a.scale === b.scale,
    differ: a.dataUrl !== b.dataUrl,
    stable: a.dataUrl === again.dataUrl,
    plainDiffers: plain.dataUrl !== a.dataUrl,
    boxPaints: red(await at(a, 0.30, 0.40)),
    andOnlyThere: white(await at(b, 0.30, 0.40)),
    mirrored: red(await at(b, 0.70, 0.40)) && white(await at(a, 0.70, 0.40)),
    badgeDrawn: (await at(a, 0.01, 0.01))[0] < 80,
    noBadgeWithout: white(await at(plain, 0.01, 0.01)),
  };
};
</script>`;

const srv = http.createServer((q, r) => {
  const f = decodeURIComponent(q.url.split('?')[0]);
  if (f === '/') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end(PAGE); }
  const p = path.join(ROOT, f);
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) {
    r.writeHead(404); return r.end('nf');
  }
  r.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  r.end(fs.readFileSync(p));
});
await new Promise((r) => srv.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.evaluate(() => window.__ready);
const r = await page.evaluate(() => window.__run());
await browser.close();
srv.close();

let fail = 0;
const ok = (c, m) => { console.log((c ? '  ok  ' : '  FAIL') + '  ' + m); if (!c) fail++; };
ok(r.sameSize, 'both images are the same size');
ok(r.sameCrop, 'from the same crop at the same scale');
ok(r.differ, 'and they are not the same picture');
ok(r.plainDiffers, 'a crop with no boxes is a third, different picture');
ok(r.stable, 'the same input renders the same bytes twice');
ok(r.boxPaints, "A's rectangle paints inside A's box");
ok(r.andOnlyThere, '...and the same point on B is untouched — the difference IS the geometry');
ok(r.mirrored, 'and the reverse holds for B');
ok(r.badgeDrawn, 'the letter is burned into the corner');
ok(r.noBadgeWithout, '...and only when one is asked for');
ok(!errs.length, `no page errors: ${errs.join(' | ') || 'none'}`);
console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
