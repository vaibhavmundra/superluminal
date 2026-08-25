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

- The room minus its zones is decomposed into **rectangular chunks** (largest
  rectangle first). No chunk, grid line or cell ever overlaps a zone.
- **Each chunk gets its own near-square grid.** There is nothing sacred about
  6×6 ft — the target cell is a preference; the chunking comes first, and every
  chunk sizes its cells to suit its own width and height.
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
rectify → carve zones → chunk → per-chunk grid → matching → align → fixtures
```

1. **Rectify.** The traced green outline is simplified, forced to 90°, and its
   coordinates are clustered so near-aligned walls become aligned.
2. **Carve + chunk.** No-light zones are subtracted from the room, and the
   remaining space is decomposed into rectangular chunks — repeatedly claiming
   the largest all-free rectangle on the elementary grid formed by wall lines
   and zone edges. Chunks thinner than `minChunk` (1 ft) are omitted.
3. **Partition.** Each chunk's axis of length `W` is split into `round(W/6)`
   pieces, choosing between `n-1`, `n` and `n+1` by a score that rewards a cut
   line or cell centre landing on the fan. This is where "squarish, but sizes
   vary to suit the walls" comes from.
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
   snapped — across chunk boundaries too — preferring the fan's coordinate.
   A large light on a vertical grid line has its x fixed by the grid, so only
   its y can slide, and only along the shared edge.
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

- One region per image — the largest enclosed green area wins.
- Walls are assumed rectilinear. Diagonals become staircases.
- Beams, diffusers and sprinklers aren't read from the plan automatically; only
  the fan is. Mark them by hand as no-light zones.
- A fan sitting near a cell centre is handled in three stages: the grid tries
  to avoid creating such a cell at all, then the matching tries to cover it with
  a large light, then — failing both — the cell is ceded. When the fan sits
  *inside* the cell, the first two usually fail: every candidate grid
  intersection for that cell is inside the fan's clearance circle too. Lower
  **Fan clearance** if you'd rather have a light there.
- Because the second pass depends on what the first pass leaves behind, the
  awkward-cell priority is no longer separable from it — a priority that rescues
  one cell can strand another. The planner therefore builds the layout **both**
  ways (priority on and off) and keeps whichever ends with fewer compromised
  cells, then more large lights, then fewer distinct light positions.
- **Hold to target** (default 4) is what keeps cells near 6 ft; **Fan pull**
  (default 0.6) is what bends the grid to line up with fixtures. Raising Fan
  pull much above 1 lets it distort cell sizes noticeably.
- Many fans in a small room can leave a cell with nowhere clear to go. The
  light stays put and is reported as a clash rather than being dropped.
- A fan sitting near its own cell's centre is the common clash: no point on
  either centre line can be `fan radius + clearance` away when that distance
  exceeds half the cell. The light goes to the least-bad point on an axis and
  is flagged. Lower **Fan clearance** to resolve it.
- Fans pull the grid towards themselves, so several fans can change the cell
  count as the partition bends to line up with all of them. Turn **Fan pull**
  down to 0 to size the grid purely on the room.
- Scale from the fan carries the stroke width of your drawn circle (~2–4% high).
  Use Measure if you need it tighter.

## Test scripts

`tools/` needs `npm i -D playwright` to run the image-generating and
end-to-end scripts:

```bash
node tools/test-planner.mjs           # layout invariants on synthetic rooms
node tools/test-match-bruteforce.mjs  # matching vs brute force, 400 cases
node tools/make-plans.mjs             # regenerate public/samples/
node tools/e2e.mjs hall lshape        # drive the built app headless
```

`public/samples/` has five test plans, including one with a deliberately broken
green stroke and one with no fan, to check the failure paths.
