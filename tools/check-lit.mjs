// ---------------------------------------------------------------------------
// check-lit.mjs — the layout screen, once there are fittings on it.
//
// NOT IN `npm test`: needs playwright and a browser. The geometry of the
// layout is covered by tools/test-planner.mjs and friends; what only a browser
// can check is that the drawing READS as a lighting drawing and that the three
// hand-placement tools do what their symbols promise.
//
//   * every fitting is drawn in the accent, with a soft pool of light under it
//     that is actually animating — and animating about its own centre, which is
//     the one thing an SVG transform gets wrong by default
//   * the working is off the sheet: no ambient grid, no task-surface boxes
//   * hovering a fitting raises a frosted card carrying the SAME watts, beam
//     and lumens the schedule bills, and thickens the fitting's stroke
//   * a strip is a dotted run with current flowing along it, and hovering it
//     stops the flow
//   * LED strip = two clicks, sconce = one click on a wall, spot = a dragged
//     box that becomes a task surface and gets its fitting from the grid
//   * and the SVG export is a still: the motion is CSS, so nothing about it
//     survives serialisation, which is what keeps the deliverable a drawing
//
// The one bug this exists to prevent recurring: everything inside `.plan` is
// `pointer-events: none` by deliberate rule (see styles.css), so a hover
// handler on a fitting silently never fires unless the SHAPE carries `.hit`.
// It cost an afternoon the first time.
//
//   npm i -D playwright && node tools/check-lit.mjs [dist] [samples/FLOOR_PLAN_03.png]
// ---------------------------------------------------------------------------

import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';
const ROOT = process.argv[2] || 'dist';
const PLAN = process.argv[3] || 'samples/FLOOR_PLAN_03.png';
const PORT = 5331;
if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
  console.error(`No build at ${ROOT}/index.html — run \`npm run build\` first, or pass a directory.`);
  process.exit(2);
}
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.woff2':'font/woff2'};
const srv=http.createServer((q,r)=>{let f=decodeURIComponent(q.url.split('?')[0]); if(f==='/')f='/index.html';
  const p=path.join(ROOT,f); if(!fs.existsSync(p)||fs.statSync(p).isDirectory()){r.writeHead(404);return r.end('nf');}
  r.writeHead(200,{'content-type':MIME[path.extname(p)]||'application/octet-stream'}); r.end(fs.readFileSync(p));});
await new Promise(r=>srv.listen(PORT,r));
const br=await chromium.launch({executablePath:process.env.CHROME_PATH || undefined});
const pg=await br.newPage({viewport:{width:1500,height:950},deviceScaleFactor:2});
let fail=0; const ok=(c,m)=>{console.log((c?'  ok  ':'  FAIL')+'  '+m); if(!c)fail++;};
const errs=[]; pg.on('pageerror',e=>errs.push('PAGEERROR '+e.message));
await pg.route('**/api/**', async (route)=>{const b=route.request().postDataJSON?.()||{};
 if(b.task==='doors') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({meta:{id:'t',task:'doors'},
  result:[{count_objects:4,predictions:{image:{width:1042,height:1642},predictions:[
   {x:753,y:181.5,width:150,height:193,confidence:0.999,class:'door'},
   {x:413,y:762,width:120,height:115,confidence:0.97,class:'door'},
   {x:551,y:1006,width:120,height:145,confidence:0.96,class:'door'},
   {x:757,y:1152,width:105,height:95,confidence:0.93,class:'door'}]}}]})});
 return route.fulfill({status:502,contentType:'application/json',body:'{"error":"off"}'});});
await pg.goto(`http://localhost:${PORT}/`,{waitUntil:'load'}); await pg.waitForTimeout(500);
await pg.setInputFiles('input[type=file]', path.join(ROOT,PLAN)); await pg.waitForTimeout(900);
await pg.getByText('Residential',{exact:false}).first().click();
await pg.waitForSelector('.modal-wrap',{state:'detached',timeout:9000}); await pg.waitForTimeout(900);
const cbox=await pg.locator('.tracer-plan canvas').first().boundingBox();
const doors=await pg.evaluate(()=>window.Konva.stages[0].find('Rect')
  .filter(n=>String(n.fill()||'').includes('0,112,243')).map(n=>{const r=n.getClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));
await pg.mouse.click(cbox.x+doors[0].x+doors[0].w/2, cbox.y+doors[0].y+doors[0].h/2); await pg.waitForTimeout(250);
await pg.getByRole('button',{name:'900mm'}).click(); await pg.waitForTimeout(600);
const trace=async(x,y,w,h)=>{for(const [dx,dy] of [[0,0],[w,0],[w,h],[0,h]]){await pg.mouse.click(cbox.x+x+dx,cbox.y+y+dy);await pg.waitForTimeout(130);} await pg.keyboard.press('Enter'); await pg.waitForTimeout(320);};
await trace(300,300,230,190);
await pg.getByRole('button',{name:/Light (this space|all)/}).click();
await pg.waitForSelector('svg.plan',{timeout:20000}); await pg.waitForTimeout(2200);
// zoom out so the whole space is reachable
await pg.getByRole('button',{name:'−'}).click(); await pg.waitForTimeout(400);

const ACCENT='rgb(0, 112, 243)';
const norm=(c)=>c.startsWith('#')?`rgb(${c.slice(1).match(/../g).map(h=>parseInt(h,16)).join(', ')})`:c;

// --- 1. the fittings are the accent -------------------------------------
const lights=await pg.evaluate(()=>[...document.querySelectorAll('svg.plan circle')]
  .filter(c=>c.getAttribute('stroke') && c.getAttribute('r') && !c.closest('[class*=lp-]'))
  .map(c=>({stroke:c.getAttribute('stroke'), sw:c.getAttribute('stroke-width')})));
const lit=lights.filter(l=>norm(l.stroke)===ACCENT);
ok(lit.length>0, `fittings are drawn in the accent: ${lit.length} of ${lights.length} stroked circles`);

// --- 2. the glow, and it pulses -----------------------------------------
const glows=await pg.locator('svg.plan .lp-pulse').count();
ok(glows>0, `a glow under every fitting: ${glows}`);
const anim=await pg.evaluate(()=>{const e=document.querySelector('.lp-pulse');
  const cs=getComputedStyle(e);
  return {name:cs.animationName, dur:cs.animationDuration, box:cs.transformBox,
          r:e.getAttribute('r'), fill:e.getAttribute('fill'),
          running:e.getAnimations().length>0 && e.getAnimations()[0].playState};});
console.log('  ..   glow:',JSON.stringify(anim));
ok(anim.name==='lp-pulse' && anim.running==='running', 'and it is actually running');
ok(anim.box==='fill-box', 'scaling about its own centre, not the drawing origin');
ok(String(anim.fill).includes('lp-glow'), 'filled with the soft gradient');

// --- 3. the working artefacts are gone ----------------------------------
const hasGrid=await pg.evaluate(()=>!![...document.querySelectorAll('svg.plan [stroke="#C8C8C8"]')].length);
ok(!hasGrid, 'no ambient grid drawn');
const hasSurf=await pg.evaluate(()=>!![...document.querySelectorAll('svg.plan [stroke="#B45309"], svg.plan [stroke="#0EA5E9"]')].length);
ok(!hasSurf, 'no task-surface boxes drawn');
// The accent detector's own regions — the wardrobe, the TV unit — are working
// too, and a dashed box in the lights' colour beside the strip it produced is
// three marks where the drawing needs one.
const accBoxes=await pg.evaluate(()=>[...document.querySelectorAll('svg.plan rect[stroke="#0070F3"]')]
  .filter(r=>(r.getAttribute('stroke-dasharray')||'').length).length);
ok(accBoxes===0, `no accent regions drawn behind the fittings: ${accBoxes}`);

// --- 4. hover a light: popup + thicker stroke ---------------------------
// The GLOW's own rect, because it is concentric with the fitting and unique to
// it — the enclosing <g> spans every light in the space.
const lightPos=await pg.evaluate(()=>{const halo=document.querySelector('svg.plan .lp-pulse');
  if(!halo) return null; const r=halo.getBoundingClientRect();
  const c=halo.parentElement.querySelector('circle[stroke]');
  return {x:r.left+r.width/2, y:r.top+r.height/2, sw:c.getAttribute('stroke-width')};});
ok(!!lightPos, 'found a fitting to hover');
await pg.mouse.move(lightPos.x, lightPos.y); await pg.waitForTimeout(350);
const tipVisible=await pg.locator('.fixture-tip').count();
ok(tipVisible===1, 'hovering a light raises the spec card');
const tipTxt=(await pg.locator('.fixture-tip').innerText().catch(()=>''))||'';
console.log('  ..   tip:',JSON.stringify(tipTxt.replace(/\n/g,' | ')));
ok(/W/.test(tipTxt) && /°/.test(tipTxt) && /lm/.test(tipTxt), 'with watts, beam angle and lumens on it');
const glass=await pg.evaluate(()=>{const e=document.querySelector('.fixture-tip');
  if(!e) return {bd:'',bg:'',pos:''};
  const cs=getComputedStyle(e);
  return {bd:cs.backdropFilter||cs.webkitBackdropFilter, bg:cs.backgroundColor, pos:cs.position};});
console.log('  ..   card:',JSON.stringify(glass));
ok(/blur/.test(glass.bd||''), 'and the frosted-glass backdrop');
const swNow=await pg.evaluate(()=>document.querySelector('svg.plan .lp-pulse')
  .parentElement.querySelector('circle[stroke]').getAttribute('stroke-width'));
ok(parseFloat(swNow)>parseFloat(lightPos.sw), `and the stroke thickens: ${lightPos.sw} -> ${swNow}`);
await pg.mouse.move(20,20); await pg.waitForTimeout(250);
ok(await pg.locator('.fixture-tip').count()===0, 'the card goes when the pointer leaves');

// ---- the three tools -----------------------------------------------------
// A point well inside the space, from the space outline's own bbox.
const room=await pg.evaluate(()=>{const p=document.querySelector('svg.plan polygon[stroke="#000000"]');
  const r=p.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};});
console.log('  ..   space bbox:',JSON.stringify(room));
const at=(fx,fy)=>({x:room.x+room.w*fx, y:room.y+room.h*fy});

// --- LED strip: two clicks ------------------------------------------------
await pg.getByRole('button',{name:'LED strip'}).click(); await pg.waitForTimeout(200);
const a=at(0.22,0.30), b=at(0.72,0.30);
await pg.mouse.move(a.x,a.y); await pg.mouse.down(); await pg.mouse.up(); await pg.waitForTimeout(250);
await pg.mouse.move(b.x,b.y); await pg.waitForTimeout(250);
await pg.mouse.down(); await pg.mouse.up(); await pg.waitForTimeout(400);
// OFF THE STRIP FIRST. The second click leaves the pointer sitting on the run
// it just made, and hovering a strip is supposed to pause it — so reading the
// play state from here would be reading the hover behaviour, not the idle one.
await pg.mouse.move(20,20); await pg.waitForTimeout(250);
const strips=await pg.evaluate(()=>[...document.querySelectorAll('svg.plan line.lp-flow')]
  .map(l=>{
    // The pulse is the SIBLING drawn under the dots — one run is two elements.
    const glow=l.parentElement.querySelector('line.lp-breathe');
    const gs=glow?getComputedStyle(glow):null;
    const caps=l.parentElement.querySelectorAll('rect');

    return {sw:+(+l.getAttribute('stroke-width')).toFixed(2), dash:l.getAttribute('stroke-dasharray'),
            dotsAnim:getComputedStyle(l).animationName,
            anim:gs&&gs.animationName, play:gs&&gs.animationPlayState,
            dur:gs&&gs.animationDuration, delay:gs&&gs.animationDelay,
            glow:!!glow, glowFilter:glow&&glow.getAttribute('filter'),
            spark:!!l.parentElement.querySelector('line.lp-spark'),
            caps:caps.length, capW:caps[0]&&+(+caps[0].getAttribute('width')).toFixed(2),
            len:Math.hypot(l.x2.baseVal.value-l.x1.baseVal.value, l.y2.baseVal.value-l.y1.baseVal.value)|0};
  }));
console.log('  ..   strips:',JSON.stringify(strips));
ok(strips.length===1, `two clicks spanned one strip: ${strips.length}`);
ok(strips[0] && /\d/.test(strips[0].dash||''), 'drawn as a dotted run');
ok(strips[0] && strips[0].dotsAnim==='none',
   `the dots themselves hold still: ${strips[0] && strips[0].dotsAnim}`);
ok(strips[0] && !strips[0].spark, 'nothing travels along the run any more');
ok(strips[0] && strips[0].glow && /lp-strip-glow/.test(strips[0].glowFilter||''),
   'it has the blurred glow the spots have');
ok(strips[0] && strips[0].anim==='lp-breathe' && strips[0].play==='running',
   `and that glow is animating: ${strips[0] && strips[0].anim}`);
// SAMPLED, NOT ASSUMED. "The animation is attached" is not "the band is
// visibly breathing" — the version before this one animated opacity between
// .38 and .62 on an already-blurred band, which is attached, running, and
// indistinguishable from a still image. So the width is read off the live
// element over a full cycle and the swing is measured.
const widths=[];
for (let i=0;i<14;i++){
  widths.push(await pg.evaluate(()=>parseFloat(
    getComputedStyle(document.querySelector('svg.plan line.lp-breathe')).strokeWidth)));
  await pg.waitForTimeout(130);
}
const wMin=Math.min(...widths), wMax=Math.max(...widths);
console.log('  ..   glow width over a cycle:', widths.map(n=>n.toFixed(1)).join(' '));
ok(wMax - wMin > 1.5,
   `the band swells and shrinks in WIDTH, like a spot's halo: ${wMin.toFixed(1)} -> ${wMax.toFixed(1)}`);
// And it must not get LONGER while doing it: butt caps, so the run's extent is
// fixed no matter how fat the glow gets.
ok(await pg.evaluate(()=>getComputedStyle(
     document.querySelector('svg.plan line.lp-breathe')).strokeLinecap)==='butt',
   'with butt caps, so it never creeps past its own end caps');
// THE SAME IDIOM AS A SPOT, which is the whole point of dropping the spark: one
// way of saying "this is on" across every fitting on the sheet.
const spotCycle=await pg.evaluate(()=>getComputedStyle(document.querySelector('.lp-pulse')).animationDuration);
ok(strips[0] && Math.abs(parseFloat(strips[0].dur) - parseFloat(spotCycle)) < 0.5,
   `on the same cycle as a spot's halo: strip ${strips[0] && strips[0].dur} vs spot ${spotCycle}`);
// The stagger is tested at the bottom, with a SECOND strip on the plan: the
// first one's offset is legitimately zero, so one strip can never show it.
ok(strips[0] && strips[0].caps===2 && strips[0].capW < strips[0].sw * 2,
   `and two small square end caps: ${strips[0] && strips[0].caps} at ${strips[0] && strips[0].capW}`);
ok(strips[0] && strips[0].sw < 3.6,
   `the run is tape and not a duct: stroke ${strips[0] && strips[0].sw}`);
ok(await pg.getByRole('button',{name:'LED strip'}).getAttribute('aria-pressed')==='false',
   'and the tool put itself away');

// hovering the strip stops the strobe
const sp=await pg.evaluate(()=>{const l=document.querySelector('svg.plan line.lp-flow');
  const r=l.getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2};});
await pg.mouse.move(sp.x,sp.y); await pg.waitForTimeout(300);
const paused=await pg.evaluate(()=>getComputedStyle(document.querySelector('svg.plan line.lp-breathe')).animationPlayState);
ok(paused==='paused', `hovering the strip holds it still: ${paused}`);
// GRIPS ON HOVER. The run is draggable; handles that appear only after a click
// make it look fixed.
const gripsOnHover=await pg.evaluate(()=>
  [...document.querySelectorAll('svg.plan rect[stroke="#0070F3"]')]
    .filter(r=>r.getAttribute('fill')==='#fff').length);
ok(gripsOnHover>=2, `hovering the strip shows its end grips: ${gripsOnHover}`);
const stripTip=(await pg.locator('.fixture-tip').innerText().catch(()=>''))||'';
console.log('  ..   strip tip:',JSON.stringify(stripTip.replace(/\n/g,' | ')));
ok(/LED strip/.test(stripTip) && /W\/m/.test(stripTip) && /\bm\b/.test(stripTip),
   'and names it, with its run and its rating');
await pg.mouse.move(20,20); await pg.waitForTimeout(200);

// --- sconce: one click on a wall -----------------------------------------
const sconceBefore=await pg.locator('svg.plan circle.hit').count();
await pg.getByRole('button',{name:'Sconce'}).click(); await pg.waitForTimeout(200);
const w=at(0.03,0.55);
await pg.mouse.move(w.x,w.y); await pg.mouse.down(); await pg.mouse.up(); await pg.waitForTimeout(450);
const sconceAfter=await pg.locator('svg.plan circle.hit').count();
ok(sconceAfter>sconceBefore, `clicking a wall seats a sconce: ${sconceBefore} -> ${sconceAfter} fittings`);
ok(await pg.getByRole('button',{name:'Sconce'}).getAttribute('aria-pressed')==='false','and disarms');

// --- directional spot: drag a zone ---------------------------------------
const spotsBefore=await pg.evaluate(()=>document.querySelectorAll('svg.plan path[fill="#0070F3"]').length);
await pg.getByRole('button',{name:'Directional spot'}).click(); await pg.waitForTimeout(200);
const s0=at(0.35,0.62), s1=at(0.62,0.80);
await pg.mouse.move(s0.x,s0.y); await pg.mouse.down();
await pg.mouse.move(s1.x,s1.y,{steps:8}); await pg.waitForTimeout(200);
await pg.mouse.up(); await pg.waitForTimeout(700);
const spotsAfter=await pg.evaluate(()=>document.querySelectorAll('svg.plan path[fill="#0070F3"]').length);
ok(spotsAfter>spotsBefore, `dragging a zone places a spot on the grid: ${spotsBefore} -> ${spotsAfter} arrowheads`);
const panel=await pg.evaluate(()=>{const s=[...document.querySelectorAll('.sec')]
  .find(x=>/additional lighting/i.test(x.querySelector('h3')?.textContent||'')); return s?s.innerText:'';});
console.log('  ..   panel:',JSON.stringify(panel.replace(/\n/g,' | ')));
ok(/strip/.test(panel) && /sconce/.test(panel) && /spot/.test(panel),
   'and the panel counts all three');
// --- a second strip, to see the stagger -------------------------------
// A per-fitting phase offset is invisible with one fitting, which is exactly
// how a stagger bug survives a test: strip one's delay is legitimately 0s.
await pg.getByRole('button',{name:'LED strip'}).click(); await pg.waitForTimeout(200);
const c0=at(0.22,0.52), c1=at(0.78,0.52);
await pg.mouse.click(c0.x,c0.y); await pg.waitForTimeout(200);
await pg.mouse.click(c1.x,c1.y); await pg.waitForTimeout(350);
await pg.mouse.move(20,20); await pg.waitForTimeout(250);
const delays=await pg.evaluate(()=>[...document.querySelectorAll('svg.plan line.lp-breathe')]
  .map(l=>getComputedStyle(l).animationDelay));
console.log('  ..   glow delays:',JSON.stringify(delays));
ok(delays.length===2, `two strips on the plan: ${delays.length}`);
ok(new Set(delays).size===2,
   `and they breathe out of phase, so the plan reads as several lamps: ${delays.join(', ')}`);

// --- WHAT A CLICK WILL DO, BEFORE IT IS SPENT -------------------------
// Each of the three tools promises something different about the next click,
// and each promise has its own way of going quiet: a cursor that never changed
// because `overRoom` was only maintained for ceiling objects, a snap that fires
// but says nothing, a sconce preview drawn at the pointer instead of on the
// wall it will actually seat itself on.
const spaceBox = await pg.evaluate(() => {
  const r = document.querySelector('svg.plan polygon[stroke="#000000"]').getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const inSpace = (fx, fy) => ({ x: spaceBox.x + spaceBox.w * fx, y: spaceBox.y + spaceBox.h * fy });
const planCursor = () => pg.evaluate(() => getComputedStyle(document.querySelector('svg.plan')).cursor);

await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
await pg.getByRole('button', { name: 'LED strip' }).click(); await pg.waitForTimeout(200);
const centreOfSpace = inSpace(0.5, 0.5);
await pg.mouse.move(centreOfSpace.x, centreOfSpace.y); await pg.waitForTimeout(300);
ok(await planCursor() === 'crosshair',
   `the strip tool puts a crosshair over the plan: ${await planCursor()}`);
const wallish = inSpace(0.5, 0.015);
await pg.mouse.move(wallish.x, wallish.y); await pg.waitForTimeout(350);
const marks = await pg.evaluate(() => document.querySelectorAll(
  'svg.plan rect[stroke="#0070F3"][fill="#fff"], svg.plan circle[stroke="#0070F3"][fill="#fff"]').length);
ok(marks > 0, `and near a wall it says what it caught on: ${marks} indicator(s)`);

await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
await pg.getByRole('button', { name: 'Sconce' }).click(); await pg.waitForTimeout(200);
const off = inSpace(0.25, 0.30);
await pg.mouse.move(off.x, off.y); await pg.waitForTimeout(400);
const ghost = await pg.evaluate(() => {
  const g = [...document.querySelectorAll('svg.plan g[opacity="0.55"]')]
    .find((x) => x.querySelectorAll('circle').length >= 2);
  if (!g) return null;
  const r = g.getBoundingClientRect();
  return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
});
ok(!!ghost, 'the sconce tool shows a ghosted fitting');
// SEATED, NOT AT THE POINTER. The whole point of this fitting is that the wall
// decides where it goes, so a preview under the cursor would show something
// that never lands.
const seated = ghost ? Math.hypot(ghost.cx - off.x, ghost.cy - off.y) : 0;
ok(ghost && seated > 10,
   `and seats it on a wall rather than under the pointer: ${seated.toFixed(0)}px away`);

await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);
await pg.getByRole('button', { name: 'Directional spot' }).click(); await pg.waitForTimeout(200);
await pg.mouse.move(centreOfSpace.x, centreOfSpace.y); await pg.waitForTimeout(300);
ok(await planCursor() === 'crosshair',
   `the spot tool puts a crosshair over the plan too: ${await planCursor()}`);
await pg.keyboard.press('Escape'); await pg.waitForTimeout(150);

// --- a spot says what it is aimed at, on hover ------------------------
const ghosted = () => pg.evaluate(() =>
  document.querySelectorAll('svg.plan rect[stroke="#0070F3"][stroke-dasharray]').length);
const spotAt = await pg.evaluate(() => {
  const p = document.querySelector('svg.plan path[fill="#0070F3"]');
  if (!p) return null;
  const c = p.parentElement.querySelector('circle.hit');
  const r = c.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
const surfBefore = await ghosted();
await pg.mouse.move(spotAt.x, spotAt.y); await pg.waitForTimeout(400);
const surfAfter = await ghosted();
ok(surfAfter > surfBefore,
   `hovering a spot ghosts the surface it lights: ${surfBefore} -> ${surfAfter}`);
await pg.mouse.move(20, 20); await pg.waitForTimeout(300);
ok(await ghosted() === surfBefore, 'and it goes again when the pointer leaves');

// --- ZOOM, THE WAY THE DOOR SCREEN DOES IT -----------------------------
// The layout screen has always had zoom BUTTONS; what it did not have was the
// tracer's wheel. The thing worth testing is not that the number changes — it
// is that the point under the pointer does not move, which is the whole
// difference between zooming and rescaling.
//
// A VIEWPORT POINT THAT IS ACTUALLY ON THE DRAWING, which is not the same as a
// fraction of the SVG: the plan is 1642px tall in a 950px window, so most of
// the element is off screen and a naive fraction lands on nothing at all. That
// mistake made the first run of this report "the wheel does not zoom" when the
// wheel was fine and the pointer was below the fold.
const pct = async () => +((await pg.locator('.side .btnrow .btn', { hasText: '%' })
  .first().innerText()).replace('%', ''));
const visiblePoint = () => pg.evaluate(() => {
  const r = document.querySelector('svg.plan').getBoundingClientRect();
  const s = document.querySelector('.stage').getBoundingClientRect();
  const x = (Math.max(r.left, s.left) + 30 + Math.min(r.right, s.right) - 30) / 2;
  const y = (Math.max(r.top, s.top) + 30 + Math.min(r.bottom, s.bottom) - 30) / 2;
  return { x, y, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height };
});
const whereIs = (fx, fy) => pg.evaluate(([fx, fy]) => {
  const r = document.querySelector('svg.plan').getBoundingClientRect();
  return { x: r.left + r.width * fx, y: r.top + r.height * fy };
}, [fx, fy]);

await pg.keyboard.press('0'); await pg.waitForTimeout(300);
const z0 = await pct();
const anchorPt = await visiblePoint();
await pg.mouse.move(anchorPt.x, anchorPt.y);
await pg.mouse.wheel(0, -300);
await pg.waitForTimeout(450);
const z1 = await pct();
ok(z1 > z0, `the wheel zooms in: ${z0}% -> ${z1}%`);
const after = await whereIs(anchorPt.fx, anchorPt.fy);
const drift = Math.hypot(after.x - anchorPt.x, after.y - anchorPt.y);
ok(drift < 8, `anchored on the pointer — the point under it stays put: ${drift.toFixed(1)}px drift`);
await pg.mouse.wheel(0, 600); await pg.waitForTimeout(450);
ok(await pct() < z1, `and back out again: ${z1}% -> ${await pct()}%`);

await pg.keyboard.press('f'); await pg.waitForTimeout(400);
const fitted = await pct();
const fits = await pg.evaluate(() => {
  const a = document.querySelector('svg.plan').getBoundingClientRect();
  const b = document.querySelector('.stage').getBoundingClientRect();
  return a.width <= b.width + 2 && a.height <= b.height + 2;
});
ok(fits, `F fits the whole plan inside the stage: ${fitted}%`);
await pg.keyboard.press('0'); await pg.waitForTimeout(350);
ok(await pct() === 100, `0 returns to actual size: ${await pct()}%`);
await pg.getByRole('button', { name: 'Fit' }).click(); await pg.waitForTimeout(350);
ok(await pct() === fitted, `the Fit button agrees with the F key: ${await pct()}% vs ${fitted}%`);

// The buttons have no pointer to anchor on, so they use the middle of the view.
// Tested while ZOOMED IN, because a centred scroll box physically cannot hold a
// point still while the drawing still fits inside it — that is the container's
// nature, not a bug in the anchoring.
await pg.mouse.move(600, 500); await pg.mouse.wheel(0, -600); await pg.waitForTimeout(450);
const mid = await visiblePoint();
await pg.getByRole('button', { name: '+' }).click(); await pg.waitForTimeout(400);
const mid2 = await whereIs(mid.fx, mid.fy);
const midDrift = Math.hypot(mid2.x - mid.x, mid2.y - mid.y);
ok(midDrift < 12, `the + button keeps the middle of the view still: ${midDrift.toFixed(1)}px`);
await pg.keyboard.press('0'); await pg.waitForTimeout(300);

// --- the exports still work, and carry no animation -------------------
const exp=await pg.evaluate(()=>{
  const svg=document.querySelector('svg.plan');
  const xml=new XMLSerializer().serializeToString(svg);
  return {bytes:xml.length, hasAnimTag:/<animate/.test(xml),
          lights:(xml.match(/circle/g)||[]).length,
          classes:/class="lp-(pulse|flow)/.test(xml)};
});
console.log('  ..   export:',JSON.stringify(exp));
ok(exp.bytes>2000 && !exp.hasAnimTag,
   'the SVG serialises with geometry only — the motion is CSS, so an export is a still');
ok(exp.classes, 'the class names ride along harmlessly (no stylesheet, no animation)');
console.log('  ..   errors:', errs.join(' | ')||'none');
await br.close(); srv.close();
console.log(fail?`\n${fail} FAILED`:'\nall good'); process.exit(fail?1:0);
