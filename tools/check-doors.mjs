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
//   * the scale panel offers exactly two methods, and on the door screen says
//     ONLY what to click and where to go instead — no door count, no empty
//     scale row, and none of the tracing controls that cannot work yet
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
// THE DOOR SCREEN IS ONE INSTRUCTION AND ONE ESCAPE HATCH. Everything that
// belongs to tracing is inert before there is a ruler, so it is not on screen:
// the count of doors found, the scale row reading "not set", the spaces the
// detector proposed, the trace and snapping controls.
ok(/Select a door whose dimension you know/i.test(t0),
   `it says what to do: "${t0.match(/Select a door[^\n]*/i)?.[0]}"`);
ok(/If you wish to proceed with another dimension, click on the\s+Measure tab above/is.test(t0),
   'and where to go for another dimension');
ok(!/doors? found/i.test(t0), 'the count of doors found is gone');
ok(!/not set/.test(t0), 'and so is the empty scale row');
for (const gone of ['Spaces on the plan', 'Trace', 'Snapping', 'Snap to', 'Outlines']) {
  ok(!new RegExp(gone, 'i').test(t0), `no "${gone}" section on the door screen`);
}
ok(!/Light (all|this)/i.test(await pg.locator('.picker-foot').innerText()),
   'and no Light button before there is a scale');

// THE INSTRUCTION IS THE SCREEN. Bigger than a note, centred in a panel as tall
// as the plan beside it, with the escape hatch under it.
const geom = await pg.evaluate(() => {
  const plan = document.querySelector('.tracer-plan').getBoundingClientRect();
  const side = document.querySelector('.rooms-side').getBoundingClientRect();
  const h = document.querySelector('.door-ask-h'), q = document.querySelector('.door-ask-p');
  if (!h || !q) return null;
  const hb = h.getBoundingClientRect(), qb = q.getBoundingClientRect();
  const cs = getComputedStyle(h);
  return {
    dPlanH: Math.abs(plan.height - side.height), dPlanTop: Math.abs(plan.top - side.top),
    size: parseFloat(cs.fontSize), align: cs.textAlign,
    dMidX: Math.abs((hb.left + hb.width / 2) - (side.left + side.width / 2)),
    dMidY: Math.abs((hb.top + hb.height / 2) - (side.top + side.height / 2)),
    below: qb.top >= hb.bottom - 1, qSize: parseFloat(getComputedStyle(q).fontSize),
  };
});
ok(!!geom, 'the instruction is its own block, not a note');
ok(geom && geom.dPlanH <= 2 && geom.dPlanTop <= 2,
   `the panel is as tall as the plan and aligned with it: ${geom && geom.dPlanH}px / ${geom && geom.dPlanTop}px out`);
ok(geom && geom.size >= 16, `set larger than a note: ${geom && geom.size}px`);
ok(geom && geom.align === 'center' && geom.dMidX <= 3 && geom.dMidY <= 12,
   `centred in the panel both ways: ${geom && Math.round(geom.dMidX)}px / ${geom && Math.round(geom.dMidY)}px off centre`);
ok(geom && geom.below && geom.qSize < geom.size, 'with the supporting sentence beneath it, smaller');

// NOTHING SNAPS ON THIS SCREEN. Move the cursor across the plan and the snap
// engine must stay silent — no glyph, no dotted guides, no pill naming a corner
// nobody is placing, and no crosshair claiming a click would draw something.
const cbox = await pg.locator('.tracer-plan canvas').first().boundingBox();
await pg.mouse.move(cbox.x + cbox.width * 0.55, cbox.y + cbox.height * 0.55);
await pg.waitForTimeout(200);
await pg.mouse.move(cbox.x + cbox.width * 0.52, cbox.y + cbox.height * 0.48);
await pg.waitForTimeout(300);
const hud = (await pg.locator('.tracer-hud').innerText()).trim();
ok(hud === '', `the HUD is empty on the door screen: "${hud.replace(/\n/g, ' | ')}"`);
const drawn = await pg.evaluate(() => {
  const st = window.Konva.stages[0];
  return { lines: st.find('Line').length, texts: st.find('Text').length };
});
ok(drawn.lines === 0 && drawn.texts === 0,
   `no snap glyph, guide or label drawn: ${JSON.stringify(drawn)}`);
ok(await pg.evaluate(() => getComputedStyle(document.querySelector('.tracer-plan')).cursor) === 'default',
   'and the cursor is default over the plan, not a crosshair or not-allowed');

// CLICK A DOOR on the plan. The boxes are in plan pixels; find one on screen by
// walking the Konva stage's own transform.
const box = cbox;

// FIND THE DOOR RECTS ON THE STAGE ITSELF. The plan is drawn into a Konva
// canvas, not an <img>, so there is no DOM element to measure and no way to
// recompute the boxes' screen positions by hand — the source image's real size
// is not exposed. Konva knows: every node can report its own client rect in
// stage coordinates, and the primary-colour fill is what marks a door.
const rects = await pg.evaluate(() => {
  const st = window.Konva?.stages?.[0];
  if (!st) return [];
  return st.find('Rect')
    .filter((n) => String(n.fill() || '').includes('0,112,243'))
    .map((n) => { const r = n.getClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height, sw: n.strokeWidth() }; });
});
ok(rects.length === 4, `the four doors are drawn on the stage in the primary colour: ${rects.length}`);
// HOVER ANSWERS THE POINTER. A door box is a button; thickening its outline is
// the confirmation, and it must be the hovered one only.
{
  const idle = rects.map((r, i) => ({ i, sw: r.sw }));
  const j = 1;
  await pg.mouse.move(cbox.x + rects[j].x + rects[j].w / 2, cbox.y + rects[j].y + rects[j].h / 2);
  await pg.waitForTimeout(250);
  const hot = await pg.evaluate(() => window.Konva.stages[0].find('Rect')
    .filter((n) => String(n.fill() || '').includes('0,112,243')).map((n) => n.strokeWidth()));
  ok(hot[j] > idle[j].sw + 0.5,
     `hovering thickens that door's outline: ${idle[j].sw.toFixed(2)} -> ${hot[j].toFixed(2)}`);
  ok(idle.every((d) => d.i === j || Math.abs(hot[d.i] - d.sw) < 0.01),
     'and leaves the others alone');
  await pg.mouse.move(cbox.x + 4, cbox.y + 4);
  await pg.waitForTimeout(200);
}

const target = rects[0];
const cx = box.x + target.x + target.w / 2;
const cy = box.y + target.y + target.h / 2;
await pg.mouse.click(cx, cy);
await pg.waitForTimeout(400);

const t1 = await side();
ok(/How wide is this door/i.test(t1), `clicking a door asks its width: "${t1.match(/How wide[^\n]*/i)?.[0] ?? t1.slice(0,120)}"`);
ok(/750mm/.test(t1) && /900mm/.test(t1) && /1200mm/.test(t1), 'with 750 / 900 / 1200 offered');
ok(!/measure instead/i.test(t1), 'and no in-tab measure escape — that is the Measure tab');

await pg.getByRole('button', { name: '900mm' }).click();
await pg.waitForTimeout(500);
const t2 = await side();
const m = t2.match(/([\d.]+)\s*px\/ft/);
ok(!!m, `picking 900mm sets the scale: "${t2.match(/[^\n]*px\/ft[^\n]*/)?.[0] ?? t2.slice(0,200)}"`);
const pxft = m ? parseFloat(m[1]) : 0;
const plan = t2.match(/Plan measures[\s\S]{0,40}/)?.[0]?.replace(/\n/g,' ');
console.log('  ..  ' + plan);
ok(pxft > 10 && pxft < 200, `and it is a plausible px/ft: ${pxft}`);

// AND ONCE THERE IS A SCALE the screen becomes the tracer again. Case-
// insensitively: the section headings are uppercased in CSS, so innerText reads
// TRACE and SNAPPING.
const t3 = await side();
ok(/trace/i.test(t3) && /snapping/i.test(t3),
   'the trace and snapping controls come back with the scale');
const foot = await pg.locator('.picker-foot').innerText();
ok(!/\broom/i.test(foot + t3),
   `nothing calls it a room any more: "${(foot+t3).match(/[^\n]*\broom[^\n]*/i)?.[0] ?? ''}"`);
ok(/Light (all \d+ spaces|this space)/i.test(foot) || /Trace an outline/i.test(foot),
   `the button speaks of spaces: "${foot.match(/Light[^\n]*/i)?.[0] ?? foot.split('\n').pop()}"`);

ok(errs.length===0, `no page errors: ${errs.join(' | ')||'none'}`);
await br.close(); srv.close();
console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
