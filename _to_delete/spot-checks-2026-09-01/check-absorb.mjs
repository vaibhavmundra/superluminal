// The reported case, measured off the screenshot: 95 px/ft.
// Closed loop; the ambient head on the top run ends at the top-right corner,
// centred half a body in. The spot sits 1.58 ft above the run, at the head's x.
import { absorbPoints, SPOT_LEN_FT, HEAD_LEN_FT, DODGE_FT,
         moduleGap } from '../../src/lib/track.js';

const F = (px) => px / 95;                       // the drawing's own scale
const x0 = F(570), x1 = F(1750), y0 = F(570), y1 = F(1065);
const runs = [
  { a:{x:x0,y:y0}, b:{x:x1,y:y0}, side:'top',    axis:'h', lengthFt:x1-x0 },
  { a:{x:x1,y:y0}, b:{x:x1,y:y1}, side:'right',  axis:'v', lengthFt:y1-y0 },
  { a:{x:x0,y:y1}, b:{x:x1,y:y1}, side:'bottom', axis:'h', lengthFt:x1-x0 },
  { a:{x:x0,y:y0}, b:{x:x0,y:y1}, side:'left',   axis:'v', lengthFt:y1-y0 },
];
// The corner head: absorbed onto the top run, clamped half a body in from the
// corner — exactly what nearestOn does to a fitting sitting on a corner.
const occupied = [{ run:0, along:(x1-x0) - HEAD_LEN_FT/2, len:HEAD_LEN_FT }];
const spot = { x: F(1700), y: F(420) };          // the end-table spot

console.log(`scale 95 px/ft · spot is ${(F(570)-F(420)).toFixed(2)} ft off the top run`);
console.log(`a ${SPOT_LEN_FT*12}in spot beside a ${HEAD_LEN_FT*12}in head needs`
  + ` ${(moduleGap(SPOT_LEN_FT, HEAD_LEN_FT)*12).toFixed(1)} in centre to centre`);
console.log(`dodge allowance: ${DODGE_FT.toFixed(2)} ft\n`);

for (const dodge of [0, DODGE_FT]) {
  const got = absorbPoints(runs, [spot], { absorb:3, len:SPOT_LEN_FT, dodge,
                                           keepOff:[], occupied })[0];
  console.log(`dodge=${dodge.toFixed(2)}:`, got
    ? `carried onto the ${runs[got.run].side} run at`
      + ` (${got.x.toFixed(2)}, ${got.y.toFixed(2)}) ft`
      + ` · perp ${got.perp.toFixed(2)} ft, slid ${got.slide.toFixed(2)} ft`
      + ` of which ${got.dodge.toFixed(2)} ft was the dodge`
      + ` · total move ${Math.hypot(got.x-spot.x, got.y-spot.y).toFixed(2)} ft`
    : 'LEFT RECESSED');
}

// The bound bites: a head parked so that no free position is within a module
// length of the landing.
console.log('\n-- the allowance is a bound, not a licence --');
const crowded = [
  { run:0, along:(x1-x0) - HEAD_LEN_FT/2, len:HEAD_LEN_FT },
  { run:0, along:(x1-x0) - HEAD_LEN_FT/2 - 1.2, len:HEAD_LEN_FT },
  { run:0, along:(x1-x0) - HEAD_LEN_FT/2 - 2.4, len:HEAD_LEN_FT },
];
const got = absorbPoints(runs, [spot], { absorb:3, len:SPOT_LEN_FT, dodge:DODGE_FT,
                                         keepOff:[], occupied:crowded })[0];
console.log('three heads packed round the landing:', got
  ? `carried, dodge ${got.dodge.toFixed(2)} ft` : 'LEFT RECESSED (correct)');

// And keepOff is re-asked at the new position.
console.log('\n-- keepOff is re-checked after the slide --');
const zone = { x0: F(1560), y0: F(500), x1: F(1690), y1: F(640) };  // over the free profile
const got2 = absorbPoints(runs, [spot], { absorb:3, len:SPOT_LEN_FT, dodge:DODGE_FT,
                                          keepOff:[zone], occupied })[0];
console.log('a zone over the position it would dodge into:', got2
  ? `carried at (${got2.x.toFixed(2)}, ${got2.y.toFixed(2)})` : 'LEFT RECESSED (correct)');
