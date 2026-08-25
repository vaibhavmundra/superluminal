import pw from 'playwright';
const { chromium } = pw;
import fs from 'fs';

// A hand-ish architectural plan: walls, doors with swing arcs, furniture,
// then the two annotations the app expects.
function plan({ title, W, H, ppf, walls, doors, furniture, green, fan, extra = '' }) {
  const g = green;
  const dots = [];
  const N = 44;
  for (let i = 0; i < N; i++) {
    if (i % 2) continue;
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    dots.push(`M ${fan.x + fan.r * Math.cos(a0)} ${fan.y + fan.r * Math.sin(a0)} A ${fan.r} ${fan.r} 0 0 1 ${fan.x + fan.r * Math.cos(a1)} ${fan.y + fan.r * Math.sin(a1)}`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#ffffff"/>
  <g stroke="#c9c9c9" stroke-width="0.5">
    ${Array.from({length:Math.ceil(W/ppf)},(_,i)=>`<line x1="${i*ppf}" y1="0" x2="${i*ppf}" y2="${H}"/>`).join('')}
    ${Array.from({length:Math.ceil(H/ppf)},(_,i)=>`<line x1="0" y1="${i*ppf}" x2="${W}" y2="${i*ppf}"/>`).join('')}
  </g>
  <g fill="#2b2b2b">${walls}</g>
  <g stroke="#555" stroke-width="1.6" fill="none">${doors}</g>
  <g stroke="#777" stroke-width="1.4" fill="none">${furniture}</g>
  ${extra}
  <text x="14" y="${H-14}" font-family="Helvetica" font-size="13" fill="#444">${title}</text>
  <path d="${dots.join(' ')}" stroke="#e01b1b" stroke-width="3" fill="none"/>
  <polygon points="${g.map(p=>p.join(',')).join(' ')}" fill="none" stroke="#12b32a" stroke-width="4"/>
</svg>`;
}

const ppf = 18; // 18 px per foot -> a 900mm door is 3ft = 54px

// 1. Simple rectangular hall 36 x 24 ft, fan in the middle
const hall = plan({
  title: 'HALL — rectangular, fan centred', W: 780, H: 560, ppf,
  walls: `<rect x="60" y="60" width="660" height="440"/><rect x="69" y="69" width="642" height="422" fill="#fff"/>`,
  doors: `<path d="M 300 500 L 300 494 M 300 494 A 54 54 0 0 1 354 440" /><line x1="300" y1="500" x2="354" y2="500" stroke="#fff" stroke-width="10"/><line x1="300" y1="497" x2="354" y2="497"/>`,
  furniture: `<rect x="110" y="130" width="126" height="60" rx="6"/><rect x="110" y="210" width="90" height="54" rx="6"/>
              <rect x="560" y="150" width="108" height="54" rx="6"/><circle cx="420" cy="330" r="54"/>`,
  green: [[69,69],[711,69],[711,491],[69,491]],
  fan: { x: 390, y: 280, r: 35.5 },   // 1200mm sweep = 3.94ft * 18 = 71px dia
});

// 2. L-shaped living + dining, fan off-centre
const lshape = plan({
  title: 'LIVING + DINING — L-shaped, fan off-centre', W: 820, H: 700, ppf,
  walls: `<path d="M 60 60 H 760 V 400 H 420 V 640 H 60 Z" />
          <path d="M 69 69 H 751 V 391 H 411 V 631 H 69 Z" fill="#fff"/>`,
  doors: `<path d="M 150 631 L 150 625 M 150 625 A 54 54 0 0 1 204 571"/><line x1="150" y1="631" x2="204" y2="631" stroke="#fff" stroke-width="10"/><line x1="150" y1="628" x2="204" y2="628"/>
          <path d="M 751 200 L 745 200 M 745 200 A 54 54 0 0 1 691 254"/>`,
  furniture: `<rect x="110" y="110" width="126" height="60" rx="6"/><rect x="110" y="190" width="126" height="60" rx="6"/>
              <rect x="600" y="110" width="108" height="180" rx="6"/>
              <rect x="150" y="450" width="180" height="108" rx="6"/>
              <rect x="470" y="110" width="54" height="54"/><rect x="470" y="180" width="54" height="54"/>`,
  green: [[69,69],[751,69],[751,391],[411,391],[411,631],[69,631]],
  fan: { x: 300, y: 220, r: 35.5 },
});

// 3. Narrow corridor + room, tests the small-light path
const corridor = plan({
  title: 'CORRIDOR + ROOM', W: 900, H: 420, ppf,
  walls: `<path d="M 60 60 H 400 V 160 H 840 V 300 H 400 V 360 H 60 Z"/>
          <path d="M 69 69 H 391 V 169 H 831 V 291 H 391 V 351 H 69 Z" fill="#fff"/>`,
  doors: `<path d="M 391 200 L 391 206 M 391 206 A 48 48 0 0 0 439 254"/>`,
  furniture: `<rect x="110" y="110" width="90" height="200" rx="6"/><rect x="600" y="190" width="180" height="80" rx="6"/>`,
  green: [[69,69],[391,69],[391,169],[831,169],[831,291],[391,291],[391,351],[69,351]],
  fan: { x: 620, y: 230, r: 35.5 },
});

fs.mkdirSync('public/samples', { recursive: true });
const set = { hall, lshape, corridor };
const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
for (const [name, svg] of Object.entries(set)) {
  fs.writeFileSync(`public/samples/${name}.svg`, svg);
  const m = svg.match(/width="(\d+)" height="(\d+)"/);
  await page.setViewportSize({ width: +m[1], height: +m[2] });
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.screenshot({ path: `public/samples/${name}.png` });
  console.log('wrote', name, m[1] + 'x' + m[2]);
}
await browser.close();

// --- edge cases -------------------------------------------------------------
const br = await chromium.launch();
const pg = await br.newPage({ deviceScaleFactor: 1 });
const cases = {
  // green box drawn with a visible gap in the stroke
  gap: `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="520"><rect width="700" height="520" fill="#fff"/>
    <rect x="60" y="60" width="580" height="400" fill="none" stroke="#2b2b2b" stroke-width="9"/>
    <path d="M 70 70 H 400 M 460 70 H 630 V 450 H 70 Z" fill="none" stroke="#12b32a" stroke-width="4"/>
    ${Array.from({length:22},(_,i)=>{const a0=(2*i/44)*Math.PI*2,a1=((2*i+1)/44)*Math.PI*2,cx=350,cy=255,r=35.5;
      return `<path d="M ${cx+r*Math.cos(a0)} ${cy+r*Math.sin(a0)} A ${r} ${r} 0 0 1 ${cx+r*Math.cos(a1)} ${cy+r*Math.sin(a1)}" stroke="#e01b1b" stroke-width="3" fill="none"/>`}).join('')}
    <text x="14" y="500" font-family="Helvetica" font-size="13" fill="#444">GAP IN GREEN STROKE</text></svg>`,
  // no fan at all — forces the reference-measurement path; door is 54px = 3ft
  nofan: `<svg xmlns="http://www.w3.org/2000/svg" width="700" height="520"><rect width="700" height="520" fill="#fff"/>
    <rect x="60" y="60" width="580" height="400" fill="none" stroke="#2b2b2b" stroke-width="9"/>
    <path d="M 200 455 L 200 449 M 200 449 A 54 54 0 0 1 254 395" fill="none" stroke="#555" stroke-width="1.6"/>
    <line x1="200" y1="452" x2="254" y2="452" stroke="#555" stroke-width="1.6"/>
    <polygon points="70,70 630,70 630,450 70,450" fill="none" stroke="#12b32a" stroke-width="4"/>
    <text x="14" y="500" font-family="Helvetica" font-size="13" fill="#444">NO FAN MARKER — door is 900mm</text></svg>`,
};
for (const [n, svg] of Object.entries(cases)) {
  const m = svg.match(/width="(\d+)" height="(\d+)"/);
  await pg.setViewportSize({ width: +m[1], height: +m[2] });
  await pg.setContent(`<body style="margin:0">${svg}</body>`);
  await pg.screenshot({ path: `public/samples/${n}.png` });
  console.log('wrote', n);
}
await br.close();

// --- two fans ---------------------------------------------------------------
const dotted = (cx, cy, r) => {
  const seg = [];
  const N = 44;
  for (let i = 0; i < N; i += 2) {
    const a0 = (i / N) * Math.PI * 2, a1 = ((i + 1) / N) * Math.PI * 2;
    seg.push(`M ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)}`);
  }
  return `<path d="${seg.join(' ')}" stroke="#e01b1b" stroke-width="3" fill="none"/>`;
};
const br2 = await chromium.launch();
const pg2 = await br2.newPage({ deviceScaleFactor: 1 });
const twofan = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560"><rect width="900" height="560" fill="#fff"/>
  <rect x="60" y="60" width="780" height="440" fill="none" stroke="#2b2b2b" stroke-width="9"/>
  <g stroke="#777" stroke-width="1.4" fill="none">
    <rect x="110" y="120" width="126" height="60" rx="6"/><rect x="640" y="120" width="126" height="60" rx="6"/>
    <rect x="110" y="380" width="180" height="90" rx="6"/><rect x="640" y="380" width="180" height="90" rx="6"/>
  </g>
  <path d="M 400 500 L 400 494 M 400 494 A 54 54 0 0 1 454 440" fill="none" stroke="#555" stroke-width="1.6"/>
  ${dotted(300, 280, 35.5)}
  ${dotted(600, 280, 35.5)}
  <polygon points="70,70 830,70 830,490 70,490" fill="none" stroke="#12b32a" stroke-width="4"/>
  <text x="14" y="540" font-family="Helvetica" font-size="13" fill="#444">TWO CEILING FANS</text></svg>`;
const threefan = twofan
  .replace('<text x="14"', dotted(450, 160, 35.5) + '<text x="14"')
  .replace('TWO CEILING FANS', 'THREE CEILING FANS');
for (const [n, svg] of Object.entries({ twofan, threefan })) {
  await pg2.setViewportSize({ width: 900, height: 560 });
  await pg2.setContent(`<body style="margin:0">${svg}</body>`);
  await pg2.screenshot({ path: `public/samples/${n}.png` });
  console.log('wrote', n);
}
await br2.close();
