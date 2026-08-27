// ---------------------------------------------------------------------------
// check-boq.mjs — the BOQ tab, and the three files, in a real browser.
//
// NOT IN `npm test`: needs playwright, like e2e.mjs and the other check-*.mjs.
// tools/test-boq.mjs already proves the arithmetic and reads all three formats
// back byte by byte. What only a browser can prove is the part that is about the
// PRODUCT rather than the data:
//
//   * the tab pair is absent until there is a plan, and appears once there is
//   * BOQ REPLACES the canvas — the drawing is gone, not underneath it
//   * the right panel collapses to the export and nothing else. Every other
//     section there is a control over a drawing you can no longer see.
//   * clicking each format actually produces a file, with the right extension,
//     and the xlsx is a real zip and the csv really starts with a BOM
//
// The door detector is stubbed so the run needs no key and no network.
//
//   npm i -D playwright && node tools/check-boq.mjs [dist] [samples/FLOOR_PLAN_03.png]
// ---------------------------------------------------------------------------

import http from 'http'; import fs from 'fs'; import path from 'path';
import zlib from 'zlib';
import { chromium } from 'playwright';
const ROOT = process.argv[2] || 'dist';
const PLAN = process.argv[3] || 'samples/FLOOR_PLAN_03.png';
const PORT = 5330;
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.jpg':'image/jpeg', '.json':'application/json', '.dxf':'text/plain' };
const OUT = fs.mkdtempSync('/tmp/boqcheck-');

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
// CHROME_PATH is for a machine with a Chromium but not playwright's own.
const br = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const ctx=await br.newContext({viewport:{width:1500,height:950},acceptDownloads:true});
const pg=await ctx.newPage();
const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
pg.on('console',m=>{if(m.type()==='error'&&!/fonts.googleapis|ERR_TUNNEL|404|502/.test(m.text()))errs.push(m.text())});
let fail=0; const ok=(c,m)=>{console.log((c?'  ok  ':'  FAIL')+'  '+m); if(!c)fail++;};

await pg.route('**/api/**', async (route) => {
  const b = route.request().postDataJSON?.() || {};
  if (b.task === 'doors') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
    meta:{task:'doors'}, result:[{predictions:{image:{width:1042,height:1642},predictions:[
      {x:753,y:181.5,width:150,height:193,confidence:0.999,class:'door'},
      {x:413,y:762,width:120,height:115,confidence:0.97,class:'door'}]}}]})});
  return route.fulfill({status:502,contentType:'application/json',body:'{"error":"offline"}'});
});

await pg.goto(`http://localhost:${PORT}/`,{waitUntil:'load'});
await pg.waitForTimeout(400);
ok(await pg.locator('.tabs').count() === 0, 'no tabs before a plan is loaded — an empty BOQ tab is a blank page');

await pg.setInputFiles('input[type=file]', path.join(ROOT, PLAN));
await pg.waitForTimeout(800);
await pg.getByText('Residential',{exact:false}).first().click();
await pg.waitForSelector('.modal-wrap',{state:'detached',timeout:8000});

ok(await pg.locator('.tabs').count() === 1, 'the tab pair appears once a plan is loaded');
const tabs = await pg.locator('.tabs button').allInnerTexts();
ok(tabs.join('/') === 'Design/BOQ', `two tabs, in order: ${tabs.join(' / ')}`);
ok(await pg.locator('.tabs button.on').innerText() === 'Design', 'Design is the one selected');

// Set the scale off a door so there is a layout to schedule.
const rects = await pg.evaluate(() => {
  const st = window.Konva?.stages?.[0]; if (!st) return [];
  return st.find('Rect').filter(n=>String(n.fill()||'').includes('97,97,245'))
    .map(n=>{const r=n.getClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};});
});
const box = await pg.locator('.tracer-plan canvas').first().boundingBox();
await pg.mouse.click(box.x + rects[0].x + rects[0].w/2, box.y + rects[0].y + rects[0].h/2);
await pg.waitForTimeout(300);
await pg.getByRole('button',{name:'900mm'}).click();
await pg.waitForTimeout(400);
ok(/px\/ft/.test(await pg.locator('.rooms-side').innerText()), 'the scale is set, so there is something to lay out');

// --- switch to BOQ from the tracer: honest, not broken
await pg.locator('.tabs button', {hasText:'BOQ'}).click();
await pg.waitForTimeout(400);
ok(await pg.locator('.boq-wrap').count() === 1, 'the BOQ replaces the canvas');
ok(await pg.locator('.tracer-plan').count() === 0, 'and the tracer is gone, not underneath it');
const sideTxt = await pg.locator('.side').innerText();
ok(/Export the schedule/i.test(sideTxt), 'the right panel is the export, and only that');
for (const gone of ['Ceiling objects','No-light zones','View','Accent']) {
  ok(!new RegExp(gone,'i').test(sideTxt), `  …no "${gone}" section`);
}
const btns = await pg.locator('.boq-export button').allInnerTexts();
ok(btns.length === 3, `three formats offered: ${btns.map(b=>b.split('\n')[0]).join(', ')}`);
ok(/Excel/.test(btns.join()) && /CSV/.test(btns.join()) && /PDF/.test(btns.join()),
  'Excel, CSV and PDF');

// --- back, light the rooms, and return
await pg.locator('.tabs button',{hasText:'Design'}).click();
await pg.waitForTimeout(300);
ok(await pg.locator('.boq-wrap').count() === 0, 'Design switches back');
ok(await pg.locator('.tracer-plan').count() === 1, 'to the tracer it came from');

console.log('\n  ..  tracing a room and lighting it');
// trace a rectangle inside the plan, then light it
const b2 = await pg.locator('.tracer-plan canvas').first().boundingBox();
const pts = [[0.30,0.30],[0.62,0.30],[0.62,0.58],[0.30,0.58]];
for (const [fx,fy] of pts) { await pg.mouse.click(b2.x+b2.width*fx, b2.y+b2.height*fy); await pg.waitForTimeout(120); }
await pg.keyboard.press('Enter');
await pg.waitForTimeout(500);
const traceSide = await pg.locator('.rooms-side').innerText();
console.log('  ..  ' + (traceSide.match(/[^\n]*Room 1[^\n]*/)?.[0] ?? traceSide.slice(0,80)).trim());
const light = pg.getByRole('button',{name:/Light/i}).first();
if (await light.count()) { await light.click(); await pg.waitForTimeout(2500); }

await pg.locator('.tabs button',{hasText:'BOQ'}).click();
await pg.waitForTimeout(600);
const boqTxt = await pg.locator('.boq-sheet').innerText().catch(()=>'');
ok(/Lighting schedule/.test(boqTxt), 'the schedule has a heading');
const rows = await pg.locator('table.boq tbody tr').count();
ok(rows > 0, `and ${rows} fitting row(s)`);
ok(/Recessed downlight/.test(boqTxt), 'with the downlights named');
ok(/7 W/.test(boqTxt) && /36°/.test(boqTxt), 'at 7W and 36 degrees');
const tiles = await pg.locator('.boq-tile').allInnerTexts();
console.log('  ..  tiles: ' + tiles.map(t=>t.replace(/\n/g,' ')).join(' | '));
// Two or three: the strip tile only appears when there is strip, because a tile
// reading "0.00 m of strip" spends a third of the summary on an absence.
ok(tiles.length === 2 || tiles.length === 3, `summary tiles: ${tiles.length}`);
ok(!tiles.some(t => /^0\.00/.test(t)), 'and none of them reports a zero');
// The room area must be rounded — it printed as 125.53257067756813 once.
const areaCell = await pg.locator('table.boq').last().locator('tbody tr td').nth(1).innerText();
ok(/^\d+$/.test(areaCell.trim()), `the room area is rounded: "${areaCell.trim()}"`);

// --- the three downloads actually download
for (const [name, ext] of [['Excel','xlsx'],['CSV','csv'],['PDF','pdf']]) {
  const [dl] = await Promise.all([
    pg.waitForEvent('download', {timeout: 8000}),
    pg.locator('.boq-export button', {hasText: name}).click(),
  ]);
  const to = path.join(OUT, `out.${ext}`);
  await dl.saveAs(to);
  const size = fs.statSync(to).size;
  ok(dl.suggestedFilename().endsWith('.'+ext), `${name} downloads as ${dl.suggestedFilename()}`);
  ok(size > 300, `  …${size} bytes`);
}
// and the xlsx is a real zip with the right parts
const x = fs.readFileSync(path.join(OUT,'out.xlsx'));
ok(x[0]===0x50 && x[1]===0x4B, 'the downloaded xlsx is a zip');
const pdf = fs.readFileSync(path.join(OUT,'out.pdf')).toString('latin1');
ok(pdf.startsWith('%PDF') && pdf.includes('Recessed downlight'), 'and the PDF carries the fittings');
const csv = fs.readFileSync(path.join(OUT,'out.csv'),'utf8');
ok(csv.charCodeAt(0)===0xFEFF, 'the CSV starts with a BOM, so Excel reads it as UTF-8');
ok(csv.includes('36°'), 'and the degree sign survives');

ok(errs.length===0, `no page errors: ${errs.join(' | ')||'none'}`);
await br.close(); srv.close();
fs.rmSync(OUT, { recursive: true, force: true });
console.log(fail ? `\n${fail} FAILED` : '\nall good');
process.exit(fail ? 1 : 0);
