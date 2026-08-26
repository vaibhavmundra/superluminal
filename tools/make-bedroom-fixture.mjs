// ---------------------------------------------------------------------------
// make-bedroom-fixture.mjs — a floor plan whose bed positions are known
// exactly, because we drew them.
//
// Every other sample in public/samples is about the OUTLINE (a hall, a
// corridor, an L). None of them has a bed on it, so there has been nothing to
// check a bed detector against except a real client drawing, by eye. That is
// how you end up believing a detector that is a foot out.
//
// This writes the plan and the answer together:
//
//   public/samples/bedroom-2bed.png         a two-bedroom flat
//   public/samples/bedroom-2bed.truth.json  the mattress rectangles, exactly
//
// so `node tools/eval-detect.mjs public/samples/bedroom-2bed.png` reports a
// real IoU with no hand-labelling. It is a synthetic plan and no substitute for
// your own drawings — a detector that fails HERE is broken, one that passes
// here is merely not obviously broken — but it is the floor, and it is free.
//
// The distractors are the point of the exercise. A sofa is a rectangle with
// cushion lines, a dining table is a rectangle with chairs, a wardrobe is a
// rectangle with a diagonal. If a detector calls any of those a bed, the plan
// has done its job. And unlike make-plans.mjs this needs no browser: a plan is
// axis-aligned rectangles and short lines, which is exactly what the little
// raster in pnglite.mjs draws.
// ---------------------------------------------------------------------------

import fs from 'node:fs';
import path from 'node:path';
import { Raster } from './pnglite.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

const PPF = 20;                       // px per foot
const W = 1240, H = 820;
const INK = [40, 40, 40, 255];
const THIN = [110, 110, 110, 255];
const WALL = [30, 30, 30, 255];
const TEXT = [70, 70, 70, 255];

const ft = (v) => Math.round(v * PPF);
const r = Raster.blank(W, H);

/** A wall as a solid band, the way a published plan draws it — 9in thick. */
const T = Math.round(0.75 * PPF);
function wallH(x0, x1, y) { r.fillRect(x0, y, x1 - x0, T, WALL); }
function wallV(x, y0, y1) { r.fillRect(x, y0, T, y1 - y0, WALL); }

/** A doorway: knock the wall out and draw a leaf and a swing. */
function doorH(x, y, w, up = true) {
  r.fillRect(x, y - 1, w, T + 2, [255, 255, 255, 255]);
  r.vline(x + 2, up ? y - w : y, up ? y : y + w, THIN, 2);
  for (let i = 0; i <= w; i++) {                       // quarter-circle swing
    const a = (i / w) * (Math.PI / 2);
    r.px(x + 2 + Math.round(w * Math.sin(a)), y + (up ? -1 : 1) * Math.round(w * Math.cos(a)) + (up ? 0 : T), THIN);
  }
}
function doorV(x, y, w, left = true) {
  r.fillRect(x - 1, y, T + 2, w, [255, 255, 255, 255]);
  r.hline(y + 2, left ? x - w : x, left ? x : x + w, THIN, 2);
  for (let i = 0; i <= w; i++) {
    const a = (i / w) * (Math.PI / 2);
    r.px(x + (left ? -1 : 1) * Math.round(w * Math.cos(a)) + (left ? 0 : T), y + 2 + Math.round(w * Math.sin(a)), THIN);
  }
}

/**
 * A bed, drawn the way a plan draws one: the mattress, one or two pillows
 * along the head edge, and a turned-down blanket line across the foot. The
 * rectangle returned is the MATTRESS, which is what the truth file records and
 * what a detector should be reporting.
 */
function bed(x, y, wFt, hFt, { head = 'top' } = {}) {
  const w = ft(wFt), h = ft(hFt);
  r.strokeRect(x, y, x + w, y + h, INK, 2);
  const pillowD = Math.round(0.9 * PPF);
  const n = wFt > 4.5 ? 2 : 1;                        // a double gets two pillows
  for (let i = 0; i < n; i++) {
    const pw = Math.round((w - (n + 1) * 6) / n);
    const px = x + 6 + i * (pw + 6);
    if (head === 'top') r.strokeRect(px, y + 5, px + pw, y + 5 + pillowD, THIN, 1);
    else r.strokeRect(px, y + h - 5 - pillowD, px + pw, y + h - 5, THIN, 1);
  }
  const blanket = head === 'top' ? y + h - Math.round(1.6 * PPF) : y + Math.round(1.6 * PPF);
  r.hline(blanket, x + 2, x + w - 2, THIN, 1);
  return { x0: x, y0: y, x1: x + w, y1: y + h };
}

/** Distractors, each shaped enough like itself to be worth confusing. */
function wardrobe(x, y, wFt, hFt) {
  const w = ft(wFt), h = ft(hFt);
  r.strokeRect(x, y, x + w, y + h, INK, 2);
  for (let i = 0; i <= Math.min(w, h); i++) r.px(x + i, y + i, THIN);   // the door diagonal
  r.vline(x + Math.round(w / 2), y, y + h, THIN, 1);
}
function sofa(x, y, wFt, hFt) {
  const w = ft(wFt), h = ft(hFt);
  r.strokeRect(x, y, x + w, y + h, INK, 2);
  r.hline(y + Math.round(h * 0.32), x + 4, x + w - 4, THIN, 1);          // the back
  for (let i = 1; i < 3; i++) r.vline(x + Math.round((w * i) / 3), y + Math.round(h * 0.32), y + h - 3, THIN, 1);
}
function table(x, y, wFt, hFt) {
  const w = ft(wFt), h = ft(hFt);
  r.strokeRect(x, y, x + w, y + h, INK, 2);
  const c = Math.round(1.4 * PPF);
  for (const cx of [x + Math.round(w * 0.25), x + Math.round(w * 0.75)]) {
    r.strokeRect(cx - c / 2, y - c - 4, cx + c / 2, y - 4, THIN, 1);
    r.strokeRect(cx - c / 2, y + h + 4, cx + c / 2, y + h + 4 + c, THIN, 1);
  }
}
function nightstand(x, y) {
  const s = ft(1.6);
  r.strokeRect(x, y, x + s, y + s, THIN, 1);
}
function wc(x, y) {
  const w = ft(1.4), h = ft(2.3);
  r.strokeRect(x, y, x + w, y + h, THIN, 1);
  r.strokeRect(x + 2, y + h - ft(1.2), x + w - 2, y + h - 2, THIN, 1);
}

// --- the flat ---------------------------------------------------------------
//
// Two bedrooms down the left, living and dining to the right, a bath in the
// corner. Nothing clever — the point is three beds' worth of geometry in known
// places, with the furniture that gets mistaken for them in the same picture.

const X0 = 40, Y0 = 40, X1 = W - 40, Y1 = H - 40;
wallH(X0, X1, Y0); wallH(X0, X1, Y1 - T); wallV(X0, Y0, Y1); wallV(X1 - T, Y0, Y1);

const MID = X0 + ft(21);                       // corridor wall between beds and living
const SPLIT = Y0 + ft(19);                     // between the two bedrooms
wallV(MID, Y0, Y1);
wallH(X0, MID + T, SPLIT);

const BATH_X = X1 - ft(9);
wallV(BATH_X, SPLIT, Y1);
wallH(BATH_X, X1, SPLIT);

doorV(MID, Y0 + ft(14), ft(3));
doorV(MID, SPLIT + ft(13), ft(3));
doorH(BATH_X + ft(3), SPLIT, ft(2.5), false);

const beds = [
  bed(X0 + ft(3), Y0 + ft(3), 6, 6.5),                       // master, king
  bed(X0 + ft(3.5), SPLIT + ft(3), 3.5, 6.5),                // bedroom 2, single
  bed(X0 + ft(11), SPLIT + ft(3), 3.5, 6.5),                 // bedroom 2, second single
];

nightstand(X0 + ft(9.4), Y0 + ft(3));
nightstand(X0 + ft(1.2), Y0 + ft(3));
wardrobe(X0 + ft(3), Y0 + ft(15.5), 8, 2);
wardrobe(MID - ft(2.4), SPLIT + ft(3), 2, 7);
sofa(MID + ft(3), Y0 + ft(4), 7, 3);
sofa(MID + ft(12), Y0 + ft(4.5), 5, 2.6);
table(MID + ft(5), SPLIT + ft(6), 6, 3);
wc(BATH_X + ft(1.4), SPLIT + ft(5));

r.text('MASTER BEDROOM', X0 + ft(3), Y0 + ft(11.5), TEXT, 2);
r.text('BEDROOM 2', X0 + ft(3.5), SPLIT + ft(11.5), TEXT, 2);
r.text('LIVING', MID + ft(3), Y0 + ft(9.5), TEXT, 2);
r.text('DINING', MID + ft(5), SPLIT + ft(11), TEXT, 2);
r.text('BATH', BATH_X + ft(1.4), SPLIT + ft(9), TEXT, 2);
r.text(`SYNTHETIC FIXTURE - ${PPF} PX PER FOOT`, X0 + ft(1), Y1 - ft(2.4), [130, 130, 130, 255], 2);

const png = path.join(ROOT, 'public/samples/bedroom-2bed.png');
const truth = path.join(ROOT, 'public/samples/bedroom-2bed.truth.json');
fs.writeFileSync(png, r.toPng());
fs.writeFileSync(truth, `${JSON.stringify({ pxPerFt: PPF, beds }, null, 2)}\n`);

console.log(`wrote ${path.relative(ROOT, png)} (${W}x${H}, ${PPF} px/ft)`);
console.log(`wrote ${path.relative(ROOT, truth)} — ${beds.length} beds`);
for (const b of beds) {
  console.log(`  ${((b.x1 - b.x0) / PPF).toFixed(1)} x ${((b.y1 - b.y0) / PPF).toFixed(1)} ft`
    + ` at ${b.x0},${b.y0}`);
}
