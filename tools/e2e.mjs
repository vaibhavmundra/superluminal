import pw from 'playwright';
const { chromium } = pw;
import fs from 'fs';
import http from 'http';
import path from 'path';

const PORT = 5199;
const ROOT = 'dist';
const MIME = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.json':'application/json' };
const server = http.createServer((req, res) => {
  let f = decodeURIComponent(req.url.split('?')[0]);
  if (f === '/') f = '/index.html';
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end('nf'); }
  res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});
await new Promise((r) => server.listen(PORT, r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

const cases = process.argv.slice(2).length ? process.argv.slice(2) : ['hall', 'lshape', 'corridor'];
fs.mkdirSync('shots', { recursive: true });

for (const name of cases) {
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page.setInputFiles('input[type=file]', `public/samples/${name}.png`);
  await page.waitForTimeout(2200);

  const pills = await page.$$eval('.topbar .pill', (n) => n.map((e) => e.textContent.trim()));
  const stats = await page.$$eval('.stat', (n) => n.map((e) => e.textContent.trim())).catch(() => []);
  const kvs = await page.$$eval('.kv', (n) => n.map((e) => e.textContent.trim())).catch(() => []);
  const note = await page.$$eval('.note.warn', (n) => n.map((e) => e.textContent.trim())).catch(() => []);
  console.log(`\n── ${name}`);
  console.log('  status :', pills.join(' | '));
  console.log('  stats  :', stats.join(' | ') || '(none)');
  console.log('  detail :', kvs.join(' | ') || '(none)');
  if (note.length) console.log('  warn   :', note.join(' | '));
  await page.screenshot({ path: `shots/${name}.png` });
}
console.log('\nconsole errors:', errors.length ? errors : 'none');
await browser.close();
server.close();
