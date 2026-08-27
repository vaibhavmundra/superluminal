// ---------------------------------------------------------------------------
// check-loading.mjs — the panel while the plan is being worked out.
//
// NOT IN `npm test`: needs playwright and a browser.
//
// ONE SCREEN, TWO LIVE READOUTS OF ONE PROCESS is the thing this guards
// against. The loader over the drawing carries the phase, the space being
// worked on and the checklist that gives them context; the panel used to carry
// the phase, the space, a done-of-total count and two buttons, three inches to
// the right. That is not twice the information — it is the same information
// asking to be reconciled, and the eye goes back and forth checking the two
// agree instead of watching the plan light up.
//
// So the panel says the one thing the loader does not — that this is a wait
// with an end — and offers the way out, centred, at a size you can read from
// across a desk. What is checked here is mostly ABSENCE, which is exactly the
// kind of thing that creeps back one line at a time.
//
// The model route is deliberately slowed to four seconds so the state is
// observable at all; with the calls failing instantly the panel flashes past.
//
//   npm i -D playwright && node tools/check-loading.mjs [dist] [samples/FLOOR_PLAN_03.png]
// ---------------------------------------------------------------------------

import http from 'http'; import fs from 'fs'; import path from 'path';
import { chromium } from 'playwright';
const ROOT = process.argv[2] || 'dist';
const PLAN = process.argv[3] || 'samples/FLOOR_PLAN_03.png';
const PORT = 5350;
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
// SLOW the model calls right down so the loading panel is observable.
await pg.route('**/api/**', async (route)=>{const b=route.request().postDataJSON?.()||{};
 if(b.task==='doors') return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({meta:{id:'t',task:'doors'},
  result:[{count_objects:4,predictions:{image:{width:1042,height:1642},predictions:[
   {x:753,y:181.5,width:150,height:193,confidence:0.999,class:'door'},
   {x:413,y:762,width:120,height:115,confidence:0.97,class:'door'},
   {x:551,y:1006,width:120,height:145,confidence:0.96,class:'door'},
   {x:757,y:1152,width:105,height:95,confidence:0.93,class:'door'}]}}]})});
 await new Promise(r=>setTimeout(r,4000));
 return route.fulfill({status:502,contentType:'application/json',body:'{"error":"slow"}'});});
await pg.goto(`http://localhost:${PORT}/`,{waitUntil:'load'}); await pg.waitForTimeout(500);
await pg.setInputFiles('input[type=file]', path.join(ROOT,PLAN)); await pg.waitForTimeout(900);
await pg.getByText('Residential',{exact:false}).first().click();
await pg.waitForSelector('.modal-wrap',{state:'detached',timeout:9000}); await pg.waitForTimeout(800);
const cbox=await pg.locator('.tracer-plan canvas').first().boundingBox();
const doors=await pg.evaluate(()=>window.Konva.stages[0].find('Rect')
  .filter(n=>String(n.fill()||'').includes('0,112,243')).map(n=>{const r=n.getClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};}));
await pg.mouse.click(cbox.x+doors[0].x+doors[0].w/2, cbox.y+doors[0].y+doors[0].h/2); await pg.waitForTimeout(250);
await pg.getByRole('button',{name:'900mm'}).click(); await pg.waitForTimeout(600);
const trace=async(x,y,w,h)=>{for(const [dx,dy] of [[0,0],[w,0],[w,h],[0,h]]){await pg.mouse.click(cbox.x+x+dx,cbox.y+y+dy);await pg.waitForTimeout(130);} await pg.keyboard.press('Enter'); await pg.waitForTimeout(320);};
await trace(300,290,240,200);
await pg.waitForTimeout(300);
await trace(300,520,240,150);
await pg.getByRole('button',{name:/Light (this space|all)/}).click();
await pg.waitForTimeout(1500);
await pg.waitForSelector('.loading-sec',{timeout:20000}); await pg.waitForTimeout(700);

const panel=(await pg.locator('.side').innerText()).trim();
console.log('  ..   panel:',JSON.stringify(panel.replace(/\n/g,' | ')));
ok(/Lighting up your space/.test(panel), 'the panel says what is happening, once');
for (const gone of ['Loading','Done','of 15','Clear and start again','Accents in']) {
  ok(!new RegExp(gone,'i').test(panel), `no "${gone}" repeated from the canvas`);
}
ok((await pg.getByRole('button').filter({hasText:/stop/i}).count())===1,
   'one way out, not two');
ok(/Stop and start over/.test(panel), 'and it says so plainly');

const geom=await pg.evaluate(()=>{
  const side=document.querySelector('.side').getBoundingClientRect();
  const say=document.querySelector('.loading-say').getBoundingClientRect();
  const btn=document.querySelector('.loading-mid .btn').getBoundingClientRect();
  const cs=getComputedStyle(document.querySelector('.loading-say'));
  return {size:parseFloat(cs.fontSize), align:cs.textAlign,
    // THE GROUP'S CENTRE, not the sentence's. The sentence sits above the
    // middle by half the button's height, which is what "below it a button"
    // means and is not an alignment bug.
    dMidY:Math.abs(((say.top+btn.bottom)/2)-(side.top+side.height/2)),
    dMidX:Math.abs((say.left+say.width/2)-(side.left+side.width/2)),
    below:btn.top>=say.bottom-1};
});
console.log('  ..   geom:',JSON.stringify(geom));
ok(geom.size>=16, `a decent text size: ${geom.size}px`);
ok(geom.dMidY<18 && geom.dMidX<4, `vertically and horizontally centred: ${Math.round(geom.dMidY)}/${Math.round(geom.dMidX)}px off`);
ok(geom.below, 'with the button beneath it');
await pg.screenshot({path:'/tmp/loading.png'});

// the loader over the canvas still carries the detail
const loader=(await pg.locator('.plan-loader, .loader, [class*=loader]').first().innerText().catch(()=>''))||'';
console.log('  ..   canvas loader still says:',JSON.stringify(loader.split('\n').slice(0,3).join(' | ')));
ok(errs.length===0, `no page errors: ${errs.join(' | ')||'none'}`);
await br.close(); srv.close();
console.log(fail?`\n${fail} FAILED`:'\nall good'); process.exit(fail?1:0);
