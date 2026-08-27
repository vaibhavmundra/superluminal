// ---------------------------------------------------------------------------
// check-doors.mjs — the scale, from upload to px/ft, in a real browser.
//
// NOT IN `npm test`: needs playwright and a browser, like e2e.mjs,
// check-overlay.mjs and check-pan.mjs. tools/test-doors.mjs already covers the
// arithmetic and every rejection; what only a browser can check is the FLOW,
// and the flow is where this feature can go wrong without anything throwing:
//
//   * the dialog asks the project question BEFORE any door call is made
//   * picking a type turns THAT SAME DIALOG into a loading state, rather than
//     dropping the user on an empty tracer with doors arriving underneath them
//   * the detector runs exactly once
//   * the doors are drawn on the plan in the primary colour and are CLICKABLE —
//     which is not the same claim. They first shipped inside a
//     `listening={false}` layer: they drew perfectly, the cursor never changed,
//     and clicking one did nothing. Same family as the sconce whose grab area
//     was painted under its own symbol.
//   * clicking one asks the width, and picking 900mm produces a plausible px/ft
//   * the scale panel offers exactly two methods
//
// The workflow response is stubbed, verbatim in shape — a top-level array with
// predictions.predictions and the model's own image size — so this needs no key
// and no network.
//
//   npm i -D playwright && node tools/check-doors.mjs [dist] [samples/FLOOR_PLAN_03.png]
// ---------------------------------------------------------------------------

import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';
const ROOT = process.argv[2] || 'dist';
const PLAN = process.argv[3] || 'samples/FLOOR_PLAN_03.png';
const PORT = 5320;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.json':'application/json', '.dxf':'text/plain' };

if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`No build at ${ROOT}/index.html — run \`npm run build\` first, or pass a directory.`);
  process.exit(2);
}
const srv=http.createServer((q,r)=>{let f=decodeURIComponent(q.url.split('?')[0]); if(f==='/')f='/index.html';
  const p=path.join(ROOT,f);
  if(!fs.existsSync(p)||fs.statSync(p).isDirectory()){r.writeHead(404);return r.end('nf');}
  r.writeHead(200,{'content-type':MIME[path.extname(p)]||'application/octet-stream'});
  r.end(fs.readFileSync(p));});
await new Promise(r=>srv.listen(PORT,r));
// CHROME_PATH is for a machine with a Chromium but not playwright's own — a CI
// image, or this repo's cloud sandbox.
const br = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const pg=await br.newPage({viewport:{width:1500,height:950}});
const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
pg.on('console',m=>{if(m.type()==='error'&&!/fonts.googleapis|ERR_TUNNEL|404|502/.test(m.text()))errs.push(m.text())});

let fail=0; const ok=(c,m)=>{console.log((c?'  ok  ':'  FAIL')+'  '+m); if(!c)fail++;};

// STUB THE DOOR ROUTE with the real workflow response, verbatim in shape.
let doorCalls = 0;
await pg.route('**/api/**', async (route) => {
  const url = route.request().url();
  const body = route.request().postDataJSON?.() || {};
  if (body.task === 'doors') {
    doorCalls++;
    await new Promise(r=>setTimeout(r,900));   // so the loading state is observable
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      meta: { id:'test', task:'doors' },
      result: [{ count_objects: 5, predictions: { image: { width: 1042, height: 1642 }, predictions: [
        { x:753, y:181.5, width:150, height:193, confidence:0.999, class:'door' },
        { x:413, y:762,   width:120, height:115, confidence:0.97,  class:'door' },
        { x:551, y:1006,  width:120, height:145, confidence:0.96,  class:'door' },
        { x:757, y:1152,  width:105, height:95,  confidence:0.93,  class:'door' },
      ] } }],
    })});
  }
  return route.fulfill({ status: 502, contentType:'application/json', body: '{"error":"offline in test"}' });
});

await pg.goto(`http://localhost:${PORT}/`,{waitUntil:'load'});
await pg.waitForTimeout(400);
await pg.setInputFiles('input[type=file]', path.join(ROOT, PLAN));
await pg.waitForTimeout(900);

ok(await pg.locator('.proj-grid').count() > 0, 'the project dialog asks first');
ok(await pg.locator('.modal-busy').count() === 0, 'and is not loading before a type is picked');
ok(doorCalls === 0, 'no door call before the project type is chosen');

await pg.getByText('Residential', { exact: false }).first().click();
await pg.waitForTimeout(250);

// THE LOADING STATE, in the same dialog.
ok(await pg.locator('.modal-busy').count() > 0, 'picking a type turns the SAME dialog into a loading state');
const busyTxt = await pg.locator('.modal').innerText();
ok(/Looking for doors/i.test(busyTxt), `and it says what it is doing: "${busyTxt.split('\n')[0]}"`);
ok(await pg.locator('.proj-grid').count() === 0, 'the question is gone while it loads');

await pg.waitForSelector('.modal-wrap', { state: 'detached', timeout: 8000 });
ok(doorCalls === 1, `the door detector ran exactly once: ${doorCalls}`);
ok(await pg.locator('.tracer-plan canvas').count() > 0, 'and the user lands on the tracer');

const side = () => pg.locator('.rooms-side').innerText();
const t0 = await side();
ok(/Doors/.test(t0) && /Measure/.test(t0), 'the scale offers exactly Doors and Measure');
ok(!/From fan/.test(t0), 'From fan is gone');
ok(!/Pixels per foot/i.test(t0), 'and so is the pixels-per-foot box');
ok(/4 doors.*found/is.test(t0), `it reports what it found: "${t0.match(/\d+ doors? found[^\n]*/i)?.[0]}"`);
ok(/not set/.test(t0), 'and there is no scale yet');

// CLICK A DOOR on the plan. The boxes are in plan pixels; find one on screen by
// walking the Konva stage's own transform.
const canvas = pg.locator('.tracer-plan canvas').first();
const box = await canvas.boundingBox();

// FIND THE DOOR RECTS ON THE STAGE ITSELF. The plan is drawn into a Konva
// canvas, not an <img>, so there is no DOM element to measure and no way to
// recompute the boxes' screen positions by hand — the source image's real size
// is not exposed. Konva knows: every node can report its own client rect in
// stage coordinates, and the primary-colour fill is what marks a door.
const rects = await pg.evaluate(() => {
  const st = window.Konva?.stages?.[0];
  if (!st) return [];
  return st.find('Rect')
    .filter((n) => String(n.fill() || '').includes('97,97,245'))
    .map((n) => { const r = n.getClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
});
ok(rects.length === 4, `the four doors are drawn on the stage in the primary colour: ${rects.length}`);
const target = rects[0];
const cx = box.x + target.x + target.w / 2;
const cy = box.y + target.y + target.h / 2;
await pg.mouse.click(cx, cy);
await pg.waitForTimeout(400);

const t1 = await side();
ok(/How wide is this door/i.test(t1), `clicking a door asks its width: "${t1.match(/How wide[^\n]*/i)?.[0] ?? t1.slice(0,120)}"`);
ok(/750mm/.test(t1) && /900mm/.test(t1) && /1200mm/.test(t1), 'with 750 / 900 / 1200 offered');
ok(/measure instead/i.test(t1), 'and a way out to measuring');

await pg.getByRole('button', { name: '900mm' }).click();
await pg.waitForTimeout(500);
const t2 = await side();
const m = t2.match(/([\d.]+)\s*px\/ft/);
ok(!!m, `picking 900mm sets the scale: "${t2.match(/[^\n]*px\/ft[^\n]*/)?.[0] ?? t2.slice(0,200)}"`);
const pxft = m ? parseFloat(m[1]) : 0;
const plan = t2.match(/Plan measures[\s\S]{0,40}/)?.[0]?.replace(/\n/g,' ');
console.log('  ..  ' + plan);
ok(pxft > 10 && pxft < 200, `and it is a plausible px/ft: ${pxft}`);

ok(errs.length===0, `no page errors: ${errs.join(' | ')||'none'}`);
await br.close(); srv.close();
console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
