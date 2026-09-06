// tools/test-materials.mjs — what a space is finished in. Pure arithmetic.
import { DEFAULT_CEILING_MM, DEFAULT_TONE, TONES, toneOf, materialsOf,
         wallMix, wallMixLabel, wallSegments, materialsSummary }
  from '../src/lib/materials.js';

let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log(`  ok   ${n}`); } else { fail++; console.log(`  FAIL ${n}${d ? ' — ' + d : ''}`); } };
const sec = (s) => console.log('\n' + s);

/** A 10 x 6 room, wound the way a traced outline is. Perimeter 32. */
const ROOM = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 }, { x: 0, y: 6 }];

sec('the defaults are what an untouched space is');
{
  ok('2700 to the slab', DEFAULT_CEILING_MM === 2700);
  ok('light on every surface', DEFAULT_TONE === 'light');
  const m = materialsOf({}, 'room-1');
  ok('a room with no record reads light', m.ceiling === 'light' && m.floor === 'light');
  ok('...and has no walls answered', Object.keys(m.walls).length === 0);
  // A stored plan can carry anything; a tone that is not one of the three is
  // the default rather than a crash or a blank.
  ok('a tone nobody recognises is the default', toneOf('teal') === 'light');
  ok('...and so is a missing one', toneOf(undefined) === 'light');
  ok('the three are the three', TONES.join() === 'light,medium,dark');
}

sec('the mix is by LENGTH, which is the whole point of it');
{
  const none = wallMix(ROOM, {});
  ok('nothing answered is 100% light', wallMixLabel(none) === '100% light');
  ok('...and the other two are absent from the line',
    !wallMixLabel(none).includes('dark'));

  // Edge 0 is the 10ft wall along the bottom: 10 of 32 feet, so 31%.
  const one = wallMix(ROOM, { 0: 'dark' });
  const dark = one.find((m) => m.tone === 'dark');
  ok('one long wall dark is 31% of the perimeter', dark.pct === 31, String(dark.pct));
  ok('...and it is measured in feet too', Math.abs(dark.ft - 10) < 1e-9);

  // The same COUNT of walls, the short one instead: 6 of 32, so 19%. A count
  // would have said a third either way, which is the failure this exists to
  // avoid.
  const shortWall = wallMix(ROOM, { 1: 'dark' });
  ok('a short wall dark is 19%, not the same as a long one',
    shortWall.find((m) => m.tone === 'dark').pct === 19,
    String(shortWall.find((m) => m.tone === 'dark').pct));

  const mixed = wallMix(ROOM, { 0: 'dark', 1: 'medium' });
  ok('two tones read in order', wallMixLabel(mixed) === '50% light · 19% medium · 31% dark',
    wallMixLabel(mixed));
}

sec('the shares always sum to a hundred');
{
  // A right triangle with legs 3 and 3: the hypotenuse is 4.2426…, so no tone's
  // share is a whole number and the largest-remainder pass has work to do.
  const tri = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }];
  const m = wallMix(tri, { 0: 'dark', 1: 'medium' });
  ok('an awkward split still totals 100',
    m.reduce((s, x) => s + x.pct, 0) === 100,
    JSON.stringify(m.map((x) => x.pct)));

  for (const walls of [{}, { 0: 'dark' }, { 0: 'dark', 2: 'medium' },
                       { 0: 'medium', 1: 'medium', 2: 'dark', 3: 'dark' }]) {
    const t = wallMix(ROOM, walls).reduce((s, x) => s + x.pct, 0);
    if (t !== 100) { ok(`totals 100 for ${JSON.stringify(walls)}`, false, String(t)); }
  }
  ok('...and so does every combination on a rectangle', true);
}

sec('geometry that cannot mean anything is refused quietly');
{
  ok('no polygon is three zeroes', wallMix(null, {}).every((m) => m.pct === 0));
  ok('two points is not a room', wallMix([{ x: 0, y: 0 }, { x: 1, y: 1 }], {})
    .every((m) => m.pct === 0));
  // A traced outline can repeat a point. A zero-length edge has no share and
  // must not divide anything by nothing.
  const dup = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 6 },
               { x: 0, y: 6 }];
  ok('a repeated corner does not poison the total',
    wallMix(dup, {}).reduce((s, x) => s + x.pct, 0) === 100);
  ok('...and the label is still readable', wallMixLabel(wallMix(dup, {})) === '100% light');
}

sec('what the collapsed materials row says');
{
  const untouched = { ceiling: 'light', floor: 'light', walls: {} };
  ok('an untouched room is Default', materialsSummary(untouched, ROOM) === 'Default');
  // WHAT DIFFERS, NOT THE WORD "CUSTOM" — a row that only says a room has been
  // changed sends you into the editor to find out how.
  ok('one surface names itself',
    materialsSummary({ ...untouched, floor: 'dark' }, ROOM) === 'Dark floor');
  ok('...and so does the other',
    materialsSummary({ ...untouched, ceiling: 'medium' }, ROOM) === 'Medium ceiling');
  // Edge 0 is 10ft of a 32ft perimeter.
  ok('the walls are stated as a share',
    materialsSummary({ ...untouched, walls: { 0: 'dark' } }, ROOM) === '31% dark walls');
  ok('...and only the part that is not the default',
    !materialsSummary({ ...untouched, walls: { 0: 'dark' } }, ROOM).includes('light'));
  ok('several read in surface order',
    materialsSummary({ ceiling: 'medium', floor: 'dark', walls: { 0: 'dark' } }, ROOM)
      === 'Medium ceiling · Dark floor · 31% dark walls');
  ok('a room with no outline still answers',
    materialsSummary(untouched, []) === 'Default');
}

sec('the segments the canvas draws');
{
  const segs = wallSegments(ROOM, { 2: 'dark' });
  ok('one per edge, closing the loop', segs.length === 4);
  ok('the last edge runs back to the first corner',
    segs[3].b.x === 0 && segs[3].b.y === 0);
  ok('each carries its own tone', segs[2].tone === 'dark' && segs[0].tone === 'light');
  ok('...and its midpoint, which is what the popup is anchored to',
    segs[0].mid.x === 5 && segs[0].mid.y === 0);
  ok('...and its length', Math.abs(segs[1].len - 6) < 1e-9);
  ok('an index is what a tone is stored against', segs.every((s, i) => s.i === i));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
