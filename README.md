# Light Planner

Takes a marked-up floor plan image and produces an ambient lighting layout —
grid, large lights, small lights — that you can export to DXF, CSV, JSON, SVG or PNG.

## Running it

```bash
npm install
npm run dev          # http://localhost:5178
```

`npm run test` runs the algorithm test suite in Node (no browser needed).

## Marking up a plan

Two annotations on top of any plan image (screenshot, scan, PDF export):

| Mark | Meaning |
|---|---|
| **Solid green** closed box or polyline | the area to light |
| **Red dotted circle** | a ceiling fan — draw one per fan, any number |

The green outline must be a closed loop. Small breaks are sealed automatically
(the app escalates the seal radius until the enclosed area matches the marked
box); if it can't close the loop it says so rather than guessing.

Every round red mark is picked up as a separate fan, so a hall with three fans
just gets three circles. They are only merged by mistake if two markers are
drawn within about a foot of each other — drop **Join fan dots** if that
happens. Markers far smaller than the largest are treated as specks and ignored.

The red mark has to be genuinely circular — red text and dimension strings are
rejected by a roundness test, so they won't be mistaken for a fan.

## No-light zones

Some parts of a ceiling can't take a light — a beam, a skylight, a duct run, an
AC unit. Mark these in the app: **No-light zones → Draw zone**, then drag a
rectangle over the plan. Draw as many as you need; each appears in a list with
its size in feet and a delete button.

A zone is not a keep-out circle like the fan — it is **subtracted from the
space, as if the outline of the room had changed**:

- The room minus its zones is decomposed into **rectangular chunks** — and
  because there is usually more than one way to do that, the app asks
  (see [Choosing how the space is chunked](#choosing-how-the-space-is-chunked)).
  No chunk, grid line or cell ever overlaps a zone.
- **Each chunk gets its own near-square grid.** There is nothing sacred about
  6×6 ft — what a cell should cover is **36 sqft, ±25%**; the chunking comes
  first, and every chunk sizes its cells to suit its own width and height. See
  [The cell is an area, not a side](#the-cell-is-an-area-not-a-side).
- **Chunks 1 ft or thinner (either dimension) are omitted entirely** — a sliver
  behind a duct doesn't deserve a light. The threshold is the "Skip chunks
  under" slider; the sidebar reports how many slivers were skipped.
- **Zone edges count as walls** for the wall-distance rule, so a large light
  keeps its usual clearance from a zone edge just as it would from a wall.
  Lower **Min wall distance** if you want large lights to sit closer to zones.
- Large lights pair cells within a chunk only; the alignment pass then snaps
  rows/columns across chunks so the drawing still reads as one layout.

Chunks export on the `CHUNK` DXF layer, zones on `NO-LIGHT` (rectangle +
cross), and both appear in the JSON under `chunks` / `noLightZones`.

## Choosing how the space is chunked

There is rarely one right answer here, and pretending otherwise was the old
behaviour. An L-shaped room can be cut into two rectangles two different ways.
A room with a duct through the middle has half a dozen readings. Which is right
depends on how the space is actually used — something the geometry does not know
and the person standing in the room does.

So the app no longer decides. **Before a single light is placed** it enumerates
the readings, draws each one over the plan to the same scale, measures them the
same way, and asks:

```
plan  ->  scale  ->  CHOOSE A CHUNKING  ->  grid  ->  lights
```

The strategies are deliberately different in kind, not in tuning — two
decompositions that differ by a foot are noise, not a choice:

| Reading | What it does |
|---|---|
| **Largest first** | Claim the biggest rectangle that fits, then the next biggest. The main body of the room stays whole. |
| **Vertical slices** | One sweep top to bottom: full-height bays. Lights line up in columns. |
| **Horizontal slices** | One sweep left to right: full-width courses. Lights line up in rows. |
| **Squarest pieces** | Prefer pieces close to square, so no chunk has to stretch its cells. |
| **Best grid fit** | Prefer pieces whose sides divide cleanly into the target cell, so cells land *on* 6 ft rather than near it. |
| **Around the fans** | Prefer pieces that hold each fan well inside them, so no chunk edge cuts a blade circle in half. |

Strategies that land on the same answer **collapse into one card** — a plain
rectangle has one reading, and the picker is skipped entirely rather than
offering a choice that isn't one. Every card carries its own numbers: chunk
count, estimated cells, area lost to slivers, average squareness, and how many
fans it holds clear. The highest-scoring one is badged *recommended*; coverage
dominates that score, because area lost to a sliver is ceiling left dark and no
amount of tidiness buys it back.

Nothing is placed until you confirm. Afterwards the sidebar shows which reading
is in force and **Change chunking** takes you back. The choice is remembered as
an *intent* ("slice it horizontally"), not as a set of rectangles, so nudging
the target-cell slider keeps it — and changing the space enough that the reading
no longer exists asks again rather than quietly substituting a different one.

### Letting a model choose

The picker and a model choose from the same evidence, by construction. Every
selector is `({ options, ctx }) => { id, reason, confidence }`, registered by
name, and `selectChunking()` falls back to the heuristic when a selector is
missing, throws, or names an id that doesn't exist. Wiring the model up is one
line at start-up:

```js
import { registerChunkSelector, createClaudeChunkSelector } from './lib/chunking.js';
registerChunkSelector('claude', createClaudeChunkSelector({ apiKey }));
// ...then: await selectChunking(options, { mode: 'claude', ctx })
```

`createClaudeChunkSelector` is written and tested against that contract but
**not registered** — nothing calls a model until someone decides it should.
`chunkingPayload()` is what it reads: the same geometry and metrics the cards are
drawn from, serialisable, no cycles, so the two cannot drift apart.
`buildChunkingPrompt()` wraps it in `CHUNKING_PROMPT`, which spells out what
matters and in what order.

Callers below the UI can bypass the whole question: `planLights` takes
`chunkStrategy` (an id) or `chunkPlan` (explicit rectangles), and with neither it
uses the recommendation — so a test, a script or an export still produces a
layout headlessly.

## Scale

Three routes, in the order you'll actually want them:

1. **From fan** (default). You already drew the fan, and a fan is a standard
   object — 1200mm sweep unless you pick otherwise. Zero extra input. With
   several fans the **median** of the per-fan scales is used, so one sloppily
   drawn circle doesn't skew the result; the sidebar lists each detected sweep
   and warns if they disagree by more than 15%.
2. **Measure.** Click the two ends of something identifiable (door leaf, sofa,
   WC, bed, car bay) and pick what it is from the list.
3. **Manual.** Type pixels-per-foot directly.

There's also an optional "Let Claude find the scale" panel — it sends the image
to the Claude API and asks it to spot a door, fixture or dimension line. Needs
your own API key, which stays in this browser's local storage.

## How the layout is computed

```
rectify → carve zones → ENUMERATE CHUNKINGS → you choose → per-chunk grid
        → matching → align → fixtures
```

1. **Rectify.** The traced green outline is simplified, forced to 90°, and its
   coordinates are clustered so near-aligned walls become aligned.
2. **Carve + chunk.** No-light zones are subtracted from the room, and the
   remaining space is decomposed into rectangular chunks on the elementary grid
   formed by wall lines and zone edges. Every wall line and zone edge is
   crossed, so each elementary cell is wholly free or wholly blocked — never
   partial — which is what makes an exact rectangular cover possible at all.
   Several decompositions are produced and **you pick one**; chunks thinner than
   `minChunk` (1 ft) are omitted from whichever you pick.
3. **Partition.** Each chunk is divided in x and y **together**, because both
   "does a cell cover about 36 sqft" and "does the fan land on a cell centre"
   are two-dimensional questions that neither axis can answer alone. The
   candidates on each axis are the even divisions into `n-1`, `n` and `n+1`
   pieces — plus, for a chunk holding exactly one fan, divisions with a cut line
   placed **exactly on that fan**. This is where "squarish, but sizes vary to
   suit the walls" comes from.
4. **Cells.** Cross the two partitions inside each chunk. Cells are always
   fully inside the room and fully outside every zone, by construction.
5. **Classify.** Before matching, ask of every cell: can a small light sit
   within the **centre band** (default ±20% of the cell's size) and still clear
   the fans? A cell that cannot is *awkward* — a small light there would sit
   visibly off centre. Rather than patch it afterwards, the cell is offered to
   the matching.
6. **Lights — small first.** A small light at the centre of each cell is the
   default. A large light is only used where a small one is **impossible**: a
   fan's clearance circle covering the cell's centre band. That cell is then
   paired with a neighbour and both are served by one large light on their
   shared grid line.

   **What a light illuminates is geometry, not bookkeeping.** A small light
   lights its own box. A large light on the interior of a grid edge lights the
   **two** boxes either side of it. A large light sitting on a **vertex** lights
   all **four** boxes that meet there. Coverage is computed by asking which
   boxes contain the point, so chunk boundaries are crossed where they should be.

   **No box may be lit twice.** Every light claims the boxes it illuminates, and
   nothing else may claim them — which makes this a set-packing problem, not a
   plain matching. **Every** two-box piece is a valid matching edge, wherever it
   sits on its line, so all of them go into one maximum-weight solve (a matching
   over dominoes *is* a disjoint packing, and cell graphs are bipartite by
   checkerboard parity, so no Blossom algorithm is needed). Only four-box
   pieces, which no matching edge can express, are packed afterwards with an
   explicit overlap check.

   Splitting the two-box pieces into "midpoints first, slid ones later" was a
   real bug: the first solve would spend a box on a mediocre pairing and block a
   far better slid one that only the later pass could see. That is exactly what
   produced two large lights where one would do.

   The strategy is entirely in the pricing. Lighting a box that cannot take a
   small light is worth `rescueValue` (default 10); pulling a **healthy** box
   into a large light's coverage costs `pairCostNormal` (default 0.5), because
   that box gives up its own centred light. Pieces that rescue nobody are
   dropped outright. The gap between the two numbers is deliberate: if a large
   light can reach a blocked box we always want it, so only the choice *between*
   rescues is a trade-off — a two-box piece is preferred over a four-box one
   because it costs fewer healthy boxes. Raise `pairCostNormal` above
   `rescueValue` to prefer ceding a box instead.

   Because a light's coverage depends on where it sits, the alignment pass may
   only shift a large light to a position that lights **exactly the same boxes**
   — otherwise aligning it would silently change what is covered.

   The aesthetic score — depth into the room, the long axis, alignment with a
   fan, cell squareness — is scaled to a tenth, so it can only break ties.

   **With no fan on the plan there are no large lights at all** — every cell
   takes a centred small light, which is the whole point of the rule.

   Untick **"small lights first"** for the earlier behaviour, where every covered
   cell was worth +1 and large lights spread across the whole plan. There
   `awkwardPriority` (default 2) is what biases the matching towards awkward
   cells, and because the second pass depends on what the first leaves behind,
   the planner builds the layout both ways and keeps the better result.

7. **Align.** Light coordinates are clustered into rows and columns and
   snapped — across chunk boundaries too. Each row is offered several lines it
   could form up on and takes whichever puts the most lights on it; a light
   that cannot land exactly on that line does not move at all. See
   [Alignment: the line has to be worth
   having](#alignment-the-line-has-to-be-worth-having). A large light on a
   vertical grid line has its x fixed by the grid, so only its y can slide, and
   only along the shared edge.
8. **Fixtures.** Every fan is both an obstacle and a soft grid anchor, and all
   of them apply at once — a position must clear *every* fan. A large light
   stays on its grid intersection, so if a fan
   A small light, by contrast, is **moved within its cell** to
   the nearest point that clears the fan — never deleted, because a deleted
   light leaves the cell dark. If a cell has nowhere to go at all, the light
   stays and the app flags a clash rather than silently dropping it.

**Invariant: every cell in every kept chunk gets exactly one light.** The sidebar shows `Cells lit`
so a hole can't hide, and `tools/test-planner.mjs` asserts it on every case.

`src/lib/` is plain JS with no DOM dependency except `detect.js`, so the engine
is testable in Node and reusable elsewhere.

## The cell is an area, not a side

A cell should cover **36 sqft, give or take 25%** — 27 to 45 sqft. That is the
same brief as "6 by 6", said in the unit that actually matters, and saying it
that way changes what the grid is allowed to do.

Held to a 6 ft *side*, every deviation is a cost and the grid has nothing to
spend. Held to an *area band*, a 5 ft cell next to a 7 ft one is not a
compromise at all — 35 sqft and 42 sqft are both simply fine — and the width of
that band becomes a budget. What the grid buys with it is the fan.

So the rule has two tiers rather than one weight:

- **Inside the band, size is nearly free.** A slight pull towards a square cell
  at the target side is all that remains, and it only breaks ties.
- **Leaving the band is a step change**, not a slope. Every grid whose cells all
  sit inside the band beats every grid that leaves it, whatever else is on
  offer: no amount of fan alignment buys a 22 sqft cell when a 36 sqft one is
  available. Only when *nothing* fits — a chunk two feet wider than a whole
  number of cells, a corridor 4 ft across — does the soft penalty decide, and
  then it prefers the near miss.

`minCell` and `maxCell` still bound the sides, so 36 sqft cannot be delivered as
4 × 9. Set the band in the sidebar: **Cell area** and **Area tolerance**.

## A lone fan goes on a grid line

**A chunk holding exactly one fan puts a grid line on that fan.** Not near it —
on it.

One fan is one coordinate pair to hit, with no second fan whose claim could
contradict it, so the grid can be bent to meet it exactly. The bend is real: the
cut line goes at the fan's coordinate and *each side of it is then divided on
its own terms*, so a 30 ft chunk with a fan 7 ft in becomes one 7 ft cell and
four of 5.75 ft. Cell sizes differ within the chunk — that is the price — and
the area band above is what keeps the price bounded. A division that would put a
cell outside 27–45 sqft is not available to be bought.

Both axes are tried, and hitting **both** is worth more than hitting one:

| Where the fan ends up | What that means |
|---|---|
| **On a grid intersection** | A shared corner of four cells, each centre half a diagonal away — the best case, and what the algorithm reaches for first. |
| **On a single grid line** | On the edge between two cells. Good, unless the fan also sits level with those two centres, which the awkward-cell count then charges for. |
| **Inside a cell, near its centre** | The case worth all this trouble to avoid: that cell can hold no centred small light, and every grid intersection around it is inside the fan's clearance circle too, so no large light can rescue it either. |

A fan closer than one cell to the chunk's edge is left alone — there would be no
room for a cell on the near side, and such a fan already sits near a wall line.

Chunks with **two or more** fans are unchanged: they keep the older, softer
behaviour, where each fan pulls the grid towards itself (**Fan pull**) and the
partition settles where the pulls balance. Bending a grid to hit one fan exactly
would only move the problem to the others.

`tools/test-planner.mjs` sweeps 82 single-fan rooms and asserts both halves of
this: the fan lands on a line in every chunk that has room for one, and not one
cell in 1840 falls outside the area band.

## Alignment: the line has to be worth having

Two rules govern every light the alignment pass touches.

### A light only moves onto something

**A small light lands exactly on the line it was moved for, or it does not
move.** Its only other stopping place is the edge of its own centre band, and
that edge means nothing to anybody: a light parked there is off its cell centre
*and* still out of line — the worst of both. Chasing a fan the light cannot
quite reach and stopping short is not a partial success, it is a light that now
looks misplaced for no reason.

A large light is different in kind. Its stopping places are the discrete anchors
of the grid — the midpoint of its edge, the chunk's centre axis, the grid
intersections at either end — and each of those is a position that means
something on its own. So it may take the nearest such anchor within tolerance
even when that is not exactly the line.

`tools/test-planner.mjs` checks the consequence directly: of every light
coordinate that has left its cell centre, none sits anywhere but on a fan, on a
line it shares with another light, or where a fan pushed it.

### The line that holds the most lights wins

A row or column is offered several lines it could form up on:

| | Line | What it means |
|---|---|---|
| 1 | **A constrained light's coordinate** | A small light a fan has pushed off its cell centre has no say in where it sits, so the row forms up on *it* rather than leaving it visibly out of line on its own. Moving four lights two inches each is invisible; leaving one light four inches out of a row of five is the first thing anyone notices. |
| 2 | **A fan's coordinate** | Lights running through the fan read as deliberate. |
| 3 | **A coordinate the row already uses** | Including, when nothing has moved, the cell-centre line they all share. Choosing this is choosing to leave the row alone. |

**The line that puts the most lights on it wins**, and that ranking only breaks
ties. This is what stops a row chasing a fan it cannot reach as a group: a fan
three of four lights can get to scores 3, while the cell-centre line all four
are on already scores 4 — so nobody moves, and the row stays a row. A whole
row aligned on the fan is worth having. Half a row aligned on the fan is worse
than none.

A light counts towards a line only if it can actually land on it: inside its own
centre band, in the room, clear of every fan and zone, and without crowding a
neighbour.

### Consequences

- **A constrained light never follows.** It is already at the only position left
  to it, so it sets a line rather than moving to one. Where two fans pin two
  lights in the same row to different offsets, one line wins on count and the
  other pinned light stays put — no arrangement satisfies both.
- **A light may end up off both its centre lines** — but only when each offset
  puts it on a real line, once for its row and once for its column. The re-seat
  pass, which exists to pull drifting lights back onto a cell centre line,
  leaves those alone: they sit exactly where the layout's own grid of positions
  puts them. Reported as `alignedDiagonal`; drift is still reported as
  `offAxis` and is still zero.
- **The minimum spacing gives a little, and only for a constrained light's
  line.** A light that forms up on a pushed light reproduces the spacing that
  light already has with its own neighbour, so the floor for that move is
  whatever the anchor itself lives with — never tighter. Anything involving a
  large light keeps the full **Min light spacing**, since a large light can
  slide along its line or be given up.

The sidebar reports how many lights lined up this way.

## The wall-distance rule

A large light must have **at least 5 ft to the nearest wall, in every
direction** — true nearest-wall distance, so corners and inward (reflex)
corners count too. Any candidate position closer than that becomes a small
light at its cell centre instead.

The design intent is 6 ft. 5 ft is that rule carrying its working tolerance,
and it turns out to be the robust choice rather than a fudge. With ~6 ft cells,
candidate positions only ever sit at ~3 ft from a wall (cell centres, outer
band) or at 6 ft and beyond (interior grid lines) — nothing lands in between.
So the threshold sits in an empty gap:

```
threshold      3.5   4.0   4.5   5.0   5.5   6.0   6.5     (large lights)
36 x 24 ft      8     8     8     8     8     8     4
35.6 x 22.4     8     8     8     8     8     4     4
L 30 x 30       5     5     5     5     5     5     0
```

Everything from 3.5 to 5.5 gives the identical layout. At exactly 6.0 it turns
brittle: a room measuring 35.6 ft instead of 36 puts its grid line at 5.93 ft,
misses by ¾ of an inch, and flips half the large lights to small. 5 ft sits in
the middle of the stable plateau, which is why the layout doesn't wobble when
your drawn box is a few inches off.

The consequence, by design: **small lights ring the perimeter, large lights
fill the core.** A 12×12 ft room gets no large lights at all, and 18×18 is
about the smallest that admits one.

The slider ranges 2–9 ft if you want to see the rule bite differently.

## Known limits (v1)

- The chunking strategies are a fixed list of six, not a search over every
  possible rectangular partition. A room can in principle be cut a way none of
  them proposes; `chunkPlan` is the way in for such a decomposition, but there is
  no UI for drawing one by hand.
- **Minimum-piece partitions are not guaranteed.** The slab sweeps plus a merge
  pass get there for most shapes, but a room with several interlocking notches
  can admit a partition with fewer rectangles than any strategy finds.
- One region per image — the largest enclosed green area wins.
- Walls are assumed rectilinear. Diagonals become staircases.
- Beams, diffusers and sprinklers aren't read from the plan automatically; only
  the fan is. Mark them by hand as no-light zones.
- A fan sitting near a cell centre is handled in three stages: the grid tries
  to avoid creating such a cell at all, then the matching tries to cover it with
  a large light, then — failing both — the cell is ceded. With **one** fan in
  the chunk the first stage now succeeds outright, since the grid can put a line
  on the fan (see [A lone fan goes on a grid
  line](#a-lone-fan-goes-on-a-grid-line)). With several fans it can still fail,
  and when the fan sits *inside* the cell the second stage usually fails too:
  every candidate grid intersection for that cell is inside the fan's clearance
  circle. Lower **Fan clearance** if you'd rather have a light there.
- Because the second pass depends on what the first pass leaves behind, the
  awkward-cell priority is no longer separable from it — a priority that rescues
  one cell can strand another. The planner therefore builds the layout **both**
  ways (priority on and off) and keeps whichever ends with fewer compromised
  cells, then more large lights, then fewer distinct light positions.
- **Cell area** / **Area tolerance** (36 sqft ±25%) are what keep cells sane;
  **Keep it square** (0.8) is the mild preference for a square cell inside the
  band. **Fan on a line** (1.5) and **...on a corner** (1.5) are what a single
  fan's exact anchoring is worth, and **Fan pull** (0.6) is the older soft
  attraction that still governs chunks with several fans. Raising Fan pull much
  above 1 lets it distort cell sizes noticeably.
- Many fans in a small room can leave a cell with nowhere clear to go. The
  light stays put and is reported as a clash rather than being dropped.
- A fan sitting near its own cell's centre is the common clash: no point on
  either centre line can be `fan radius + clearance` away when that distance
  exceeds half the cell. The light goes to the least-bad point on an axis and
  is flagged. Lower **Fan clearance** to resolve it.
- Fans pull the grid towards themselves, so several fans can change the cell
  count as the partition bends to line up with all of them. Turn **Fan pull**
  down to 0 to size the grid purely on the room — and **Fan on a line** to 0 to
  stop a lone fan being anchored exactly.
- A chunk whose cells differ in size can leave two small lights closer together
  than **Min light spacing** when a fan pushes one of them off its centre — and
  the rest of that row, following it, inherits the same gap. The spacing rule is
  enforceable for anything involving a large light, which can slide along its
  line or be given up; a small light owns a cell that has to stay lit, so it
  stays put and the pair is reported rather than repaired.
- Two fans can pin two lights in the same row to different offsets. Only one of
  those lines can win, so the other pushed light stays visibly out of the row.
  Nothing can be done about it without leaving a cell dark.
- A row will decline to align on a fan that only some of its lights can reach,
  and stay on its cell-centre line instead. That is deliberate — half a row on
  the fan looks worse than none of it — but it does mean a fan can be sitting
  right beside a row of lights that ignores it. Widen **Centre band** if you
  would rather the rest of the row could get there.
- Scale from the fan carries the stroke width of your drawn circle (~2–4% high).
  Use Measure if you need it tighter.

## Test scripts

`tools/` needs `npm i -D playwright` to run the image-generating and
end-to-end scripts:

```bash
node tools/test-planner.mjs           # layout invariants on synthetic rooms
node tools/test-chunking.mjs          # every chunking is an exact cover, 16 shapes
node tools/test-match-bruteforce.mjs  # matching vs brute force, 400 cases
node tools/make-plans.mjs             # regenerate public/samples/
node tools/e2e.mjs hall lshape        # drive the built app headless
```

`public/samples/` has five test plans, including one with a deliberately broken
green stroke and one with no fan, to check the failure paths.
