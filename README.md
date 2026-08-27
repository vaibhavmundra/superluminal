# Light Planner

Takes a floor plan and produces an ambient lighting layout — grid, large
lights, small lights — that you can export to DXF, CSV, JSON, SVG or PNG.

Two ways in:

| Input | What you do | What it costs you |
|---|---|---|
| **DXF** | drop the file, nudge the rooms it found, light the lot | a few drags — the scale comes out of the file |
| **Image** | drop it, set the scale, nudge the rooms it found, light the lot | a few drags and one measurement |

**The rooms are found for you on upload.** A segmentation model reads the plan
and proposes one outline per room; you drag the corners that are wrong and light
the whole plan in one go. See [Finding the rooms for
you](#finding-the-rooms-for-you).

**Tracing by hand is still there and still exact**, on the same screen, and it
is what you fall back to when the model comes back empty or misses a room. The
only thing a DXF still does for you that an image does not is state its own
scale; an image has to be measured once before anything can be traced or
measured against it.

The DXF route is the better one and the rest of this section explains why — the
cursor has real line work to hold on to. On an image it holds on to the geometry
*you* are drawing instead, which turns out to be most of the value: see
[Tracing over an image](#tracing-over-an-image).

> **Gone in this version:** the green marker. You used to open the plan in an
> image editor, draw a closed green loop round the area to light, and let the app
> seal the gaps and flood-fill it. That is removed — see
> [Why the green marker went](#why-the-green-marker-went). Red fan circles are
> still read.

## Running it

```bash
npm install
npm run dev          # http://localhost:5178
```

`npm run test` runs the algorithm test suite in Node (no browser needed) —
the planner, the chunker, room extraction, the DXF parser, and the whole vector
route end to end.

`node tools/make-sample-dxf.mjs` regenerates `public/samples/sample-2bhk.dxf`,
a synthetic 2BHK with door swings, dimension lines and a sofa on their own
layers. Drop it in to see the vector route work without hunting for a drawing.

## The dials live in code

`src/lib/settings.js` is the file to edit. The right-hand panel used to carry
about forty sliders and checkboxes — cell area, area tolerance, ideal/min/max
cell side, prefer-bigger, keep-it-square, fan weights, wall distance, centre
band, neighbour cost, roam penalty, vertex band, align tolerance, min spacing,
line weights for the detector's render, red-marker sensitivity. Every one of
them wanted setting **once, correctly**, and none of them wanted nudging per
room; together they made the six controls that matter impossible to find.

So they are constants now:

| Where | What |
|---|---|
| `settings.js` → `OVERRIDES` | anything in the planner's `DEFAULTS` you want changed |
| `settings.js` → `FITTING_LUMENS` | what one small / large fitting puts out, in lumens |
| `settings.js` → `WALL_WEIGHT_IN` | how heavy walls are drawn in the render sent to the bed detector — **2 inches**, fixed |
| `settings.js` → `FAN_DETECT` | red-marker sensitivity on an image |
| `planner.js` → `DEFAULTS` | every planner dial, documented line by line |

The panel that remains is **Plan, Room, Ceiling fans, No-light zones, Chunking,
View, Result, Export** — inputs and outputs, no parameters.

## Dropping in a DXF

Nothing to measure: the file says what one drawing unit means, so the scale is
exact. You trace the room over the walls, and the drawing holds the cursor.

```
dxf -> layers -> TRACE THE OUTLINE (snapped) -> chunking -> grid -> lights
```

### Why it is traced and not found

There is a full geometric room reader in `src/lib/rooms.js`: it arranges the
wall lines into a planar graph, bridges the doorways and returns the faces. On
a drawing whose layers mean what they say it is very good — six rooms out of
six on the sample plan, measured to the inner face.

It is not what the app uses, because plenty of real drawings look like this:

```
0                1656     <- walls, sofa, dining table, WC, appliances
KMBD Walls         48
KMBD Elevation      6
```

With the furniture sharing a layer with the walls there is no set of
checkboxes that separates them, and the reader does what it is built to do:
returns twelve confident "rooms", one of which is the dining table and another
is a 34-corner blob. A wrong answer that looks like an answer is worse than no
answer, and no better regex fixes it — the information genuinely is not in the
file.

So the outline is traced by hand, and the engineering went into making the hand
accurate instead. The reader is still there, registered as an outline source
(`src/lib/outlineSources.js`) rather than wired into the screen:

```js
import { registerOutlineSource, proposeOutlines } from './lib/outlineSources.js';
registerOutlineSource('model', async ({ source }) => /* ...outlines... */);
await proposeOutlines('model', { source, layers });
```

An outline is a list of points; where they came from is nobody's business
downstream. That is the slot a model goes in, and everything after it is
unchanged. Same shape as `registerChunkSelector`.

## Finding the rooms for you

On upload, before there is anything to light, the plan goes to a trained
segmentation workflow and comes back with one polygon per room. Those become
outlines with a **grip on every corner**, drawn dashed until someone has looked
at them. You drag what is wrong and press **Light all N rooms**.

```
upload ──► snapshot ──► /api/detect (task: rooms) ──► roomsFromPayload
                                                          │
                                              proposals with grips
                                                          │
                                            drag ──► Light the whole plan
```

The workflow is set in one place and overridable without a code change:

```bash
# .env.local — server-side only, never VITE_ prefixed
ROBOFLOW_INFERENCE_KEY=...
ROBOFLOW_ROOMS_WORKFLOW_URL=https://serverless.roboflow.com/<workspace>/workflows/<id>
```

**It is one endpoint and two questions.** `/api/detect` already held the key for
the bed detector, so the room detector goes through the same function with
`task: 'rooms'` in the body rather than a second function with a second copy of
the key handling, the error scrubbing and the two-URL-shape retry. The two run in
separate requests, and one of them failing does not take the other down.

**The inputs are discovered, not assumed.** A workflow's inputs are whatever its
author declared. A stock detect-and-count workflow takes an image and rejects a
class list it never asked for; a customised one may want one. Both refusals come
back as a plain 4xx with a message nothing can act on programmatically, so the
server tries `{image}` first and `{image, classes}` second, and logs which one
was accepted.

### What comes back is not trusted

A mask boundary is a jagged thing that wanders across doorways and sits a few
inches off the wall face, and a segmenter on a line drawing will hand you the
sheet itself as a room if you let it. So every proposal is filtered before anyone
sees it — `ROOM_DEFAULTS` in `src/lib/roomsDetect.js`:

| Thrown away | Why |
|---|---|
| **encloses two or more other rooms** | that is the drawing's border, or every room merged through the doorways |
| under 20% confidence | below this the polygon is rarely worth correcting |
| under 0.4% of the sheet | a light fitting, a label, noise |
| under 12 sq ft, once the scale is known | smaller than a WC |
| overlapping another by more than 55% (IoU) | two masks over one room |

**The enclosure test is the one that matters**, and it is worth saying why it is
not an area threshold. The whole sheet, on the sample plan, is 88% of the image —
and a tightly cropped single-room drawing can legitimately be 70%. No area
threshold separates those. "This outline has three rooms inside it" is not a
guess. Two is the cut: one room inside another's bounding box is a real
arrangement (an ensuite, an L-shaped living room whose box swallows the kitchen),
three is a floor plan.

When two masks cover one room the **larger** wins, not the more confident one.
They usually differ by one of them stopping at a doorway, and confidence does not
say which did.

### Grips, and why they use the same snap engine

A corner nudged by eye is off by the same two inches that made hand-tracing
necessary in the first place. So dragging a grip runs the full snap engine from
[Tracing the outline](#tracing-the-outline) — wall ends, wall crossings,
alignment with every other corner on the plan, the right-angle lock off the
previous corner. The whole value of a proposal is that correcting it lands you
somewhere *more* accurate than you would have got by hand, and that only holds if
the correction snaps.

| Do this | To get |
|---|---|
| **drag** a corner | move it — free angle, snapping to walls and to the other corners |
| **Shift** while dragging | hold it square to its neighbour |
| **click** a hollow diamond on an edge | insert a corner there |
| **right-click** (or alt-click) a corner | delete it |
| **Show corner grips** off | get them out of the way |

**A corner drag is a free move, and the right-angle lock is off.** That is the
opposite of tracing, where the lock is on by default, and the reason is that a
corner is not the end of a wall being drawn: moving one corner of a rectangle is
*meant* to leave two edges angled. With the lock on you drag 190 px and the point
travels 115 px sideways along its neighbour's axis, and there is no way to say
what you meant. What replaces the lock is the **alignment snap** — the corner
still lines up with its neighbours when it is near to being in line, and lets go
when it is not. A preference rather than a rule. Shift, which releases the lock
everywhere else on this screen, is what turns one on here.

Two things about the implementation that are load-bearing:

* **the dragged outline comes out of the snap index.** Its own two edges pass
  through the corner being moved, so `edge` and `end` candidates sit at zero
  distance and win every comparison — the corner cannot be moved off its own
  lines. The whole outline is removed rather than just the two adjacent edges,
  or a corner dragged across the room catches on the far wall of its own polygon.
* **the grips sit on the raw points, not the squared-up polygon.** Rectifying is
  derived (see [Tracing the outline](#tracing-the-outline)), so a grip on a
  rectified point would move something that is not stored.

A drag is local state until it ends. Committing per mouse move would rebuild the
snap index under the cursor sixty times a second, and the index is the thing the
cursor is snapping against.

### The rooms are simplified and squared before you see them

A mask comes in with dozens of vertices and goes out with a handful: Douglas-
Peucker at four inches, which is small enough to keep a real nook and large
enough to throw away the staircase along a straight wall. Then it is **squared**,
and the stored points are the squared ones.

That last part is a reversal worth explaining, because a hand-traced outline
works the other way round: there, the points you clicked are the record and the
squared version is derived from them, so the `square` switch can be turned off
per room without losing anything. That is the right design for a record of what
someone clicked. It is the wrong design for a proposal that is about to be
dragged — the grips sit on the *stored* points, so with squaring derived you drag
a corner and watch the correction get squared away underneath you. The point
moves, the polygon does not, and nothing on screen explains why.

So for a proposal it is baked in: what you see is what you drag. The per-room
`square` switch is still there to re-apply it after a session of free dragging.

An **L-shaped room stays L-shaped**. That is the reason not to simplify to a
bounding box, and `tools/test-rooms-detect.mjs` asserts it.

### No two rooms may overlap

A segmenter does not know that rooms are disjoint. It returns one mask per thing
that looks like a room, and two of those routinely cover the same floor: an
ensuite inside a bedroom, or two masks that merged through a doorway and now
share a strip. Left alone that floor is lit twice, counted twice in the lumens
per square foot, and exported as two polygons on top of each other.

So the smaller room is subtracted from the larger — `src/lib/roomBooleans.js`.
**Largest first is the whole policy:** a small room inside a big one is a real
room and the big one is the one whose boundary is wrong, so the big one gives
way. Subtract the other way round and the ensuite disappears into the bedroom.
It also means a room is only ever eroded by rooms smaller than itself, so the
pass terminates and the result does not depend on which mask was more confident.

| Case | What happens |
|---|---|
| ensuite in a corner, sharing two walls | the bedroom becomes an L |
| ensuite along one wall | the bedroom becomes a U |
| ensuite that stops short of the wall | walls within **1.5 ft** count as shared, so it subtracts anyway |
| two masks overlapping through a doorway | the larger loses the strip; the smaller is untouched |
| a mask other rooms almost entirely cover | dropped — it was a duplicate, not a room |
| a room *wholly* inside another | cannot be subtracted; see below |

**Why a cell grid rather than a polygon clipper.** Everything downstream is
rectilinear, so a clipper's exact answer would be squared up two stages later
regardless. More to the point, a clipper's failure mode is a crash or a silently
malformed ring on touching and coincident edges — which is *exactly* this input,
because rooms share walls. A grid built from the polygons' own coordinates has no
degenerate case: every cell centre is strictly inside or strictly outside. It is
fifty lines that can be read. The cost is that a diagonal edge becomes a
staircase as coarse as the coordinate spacing, which is why subtraction runs only
on the pair that actually overlaps, and only after squaring.

**The 1.5 ft shared-wall tolerance** sounds generous until you count what is in
the gap: a 9-inch wall, plus the inner mask falling short of its face, plus the
outer mask falling short of the other face. Anything tighter and an ensuite
plainly in the corner of a bedroom reads as floating in the middle of it. The
snap applies *only inside the subtraction* — the inner room's own outline is
never rewritten — so the outer room is carved a little generously and the strip
between them stays unlit. Which is correct: that strip is the wall.

**A room wholly inside another** has a difference that is an annulus, and an
annulus is not a polygon the planner can lay a grid inside. Rather than invent a
wall that is not on the drawing, the enclosing room keeps its outline and the
inner room is held out of its ceiling as a **no-light zone** — so no light is
ever placed over a room that is not the room being lit, even where the geometry
could not say so. The row says as much, and dragging a corner of the inner room
out to a wall converts it into a proper subtraction.

### Names

In order of who is most likely to be right: a specific class from the model
(`kitchen`, not `room`), then a **text label on the drawing whose insertion point
falls inside the polygon** — the draughtsman's own word beats anything we can
compute — then `Room 1`, `Room 2` in reading order. Reading order is banded: rows
within a tenth of the plan's height are one row, ordered left to right, so
`Room 2` means the same room twice running.

### There is no GPT alternative to this one

The bed detector has two providers because a bed's box only has to be roughly
right to be a useful obstacle. A room outline that is roughly right puts every
light in the wrong place. Asking a general vision model for a boundary is asking
it to measure, which is the one thing it cannot do — so this is the trained
segmenter or nothing, and *nothing* is survivable: you trace by hand, which is
what you did before this existed.

### Seeing what it actually said

```bash
node tools/probe-rooms.mjs                     # the FLOOR_PLAN_03 sample
node tools/probe-rooms.mjs path/to/plan.png
```

Prints a type sketch of the response, what the parser made of it, and what it
threw away and why. Writes three files to `.detect-debug/`: the raw payload, the
same with base64 blobs collapsed, and **`rooms-overlay.svg`** — the polygons
drawn over the plan. That last one is the point: "the arithmetic is wrong" and
"the model is wrong" look identical in a list of numbers and completely different
in a picture.

`polygonFromPrediction` accepts a list of `{x,y}`, a list of `[x,y]`, a flat run
of numbers, an RLE mask and a bare box, because a workflow's output shape is not
knowable from here. **An RLE mask is reduced to its bounding rectangle, not
traced.** For a rectangular room that is the right answer; for an L-shaped one it
means one corner to drag in. If a real response turns out to be RLE-only and the
plans are full of L-shaped rooms, tracing the contour properly is the upgrade and
it belongs in `rectFromRle`'s place.

## Tracing the outline

One screen for both kinds of plan. Click the corners; the cursor snaps, so the
accuracy is the drawing's rather than your mouse's.

On a **DXF** the snaps below come off the drawing's own line work. On an
**image** there is no line work, so the last three come off the geometry you are
drawing — see [Tracing over an image](#tracing-over-an-image).

| Snap | What it catches |
|---|---|
| **endpoint** | a line's end |
| **intersection** | two lines crossing — *the inner corner of a wall junction* |
| **midpoint** | the middle of a line |
| **on the wall** | anywhere along a line |
| **axis** | level with the last corner placed |
| **wall on the axis** | where that axis line meets a wall — "carry on until something stops me" |
| **close** | the first corner, to shut the loop |

Three more come from what **you** have drawn rather than from the drawing, which
is the whole of what an image has to offer — and they are useful on a DXF too,
wherever a wall is missing, drawn short, or buried under furniture on layer 0:

| Snap | What it catches |
|---|---|
| **lined up with a corner** | level with any corner already placed, in this outline or an earlier one |
| **square with two corners** | where two of those alignments cross — *the corner of a rectangle, at a spot nothing has ever been drawn on* |
| **on the grid** | a round increment — 3″, 6″ or 1′ — measured from the first corner you placed |

Each has its own glyph, because *that* it snapped is not the useful
information — **what** it snapped to is. A square is an endpoint, a cross is an
intersection or an alignment crossing, a triangle is a midpoint, a plus is the
grid. When the cursor lines up with corners, dashed guides run back to the
corners it agreed with, so the point never lands somewhere the screen cannot
explain.

**Right angles are locked by default** — hold <kbd>Shift</kbd> to release, or
untick it. With the lock on, only points on the constraint line are eligible,
so the lock is a lock and not a suggestion. Closing the loop is always allowed,
because it is an explicit act.

<kbd>Backspace</kbd> undoes a corner, <kbd>Esc</kbd> starts over,
<kbd>Enter</kbd> closes, <kbd>Space</kbd>+drag pans, <kbd>F</kbd> fits,
<kbd>O</kbd> toggles the lock. Scroll to zoom; the snap radius is in screen
pixels, so it stays the same size on screen however far in you are.

Hiding a layer stops the cursor snapping to it. Turn the furniture off and you
cannot catch a sofa corner by mistake — which is the same problem the automatic
reader could not solve, handed to the person who can see the drawing.

### The snap that had to be got right

Ranking snaps by kind alone is wrong, and wrong in exactly the case that
matters. CAD draws a wall as two lines running corner to corner along its
**centreline**, so at every junction both faces overrun the wall they meet and
stop inside the cavity. That leaves a stray endpoint **half a wall thickness**
from the corner you are aiming for — and nearer to your cursor than the corner
is, because the corner is an *intersection* of two faces and an endpoint of
neither.

Ranked on kind, that debris won every time, and every traced room came out one
wall thickness too big in each direction. Measured on the sample plan: a room
clicked dead on its corners came back 21′3″ × 15′7″ instead of 21′3″ × 15′3″.

Two things fix it, and both are in `src/lib/snap.js`:

- **Handicaps, not ranks.** Each kind adds a small penalty to the true distance
  rather than overriding it. At equal distance an endpoint still beats an
  intersection; an intersection under the cursor beats an endpoint half a foot
  away.
- **Loose ends are demoted.** A line that stops in mid-air with nothing else
  touching it is junction debris, not a corner. Computed once per drawing.
  Demoted rather than disqualified — a wall end at a doorway jamb is also a
  loose end and is occasionally what you want.

Together they take the room from exact-only-on-a-perfect-click to exact within
8 screen pixels of cursor error. Both are pinned by tests, because this is the
regression that would quietly make every room wrong.

The drawn-geometry snaps join the same scheme, and their handicaps say exactly
how much they are trusted:

- An **alignment crossing** sits just behind a real wall crossing and ahead of a
  midpoint. Two corners already placed agree on it, which is nearly as good as
  two lines agreeing on it.
- A **single alignment** is much weaker — one corner is a guess about intent, not
  a fact about the plan — so a real endpoint in range always takes it.
- The **grid** is not weighed at all: it is a *constraint*, standing in for the
  free cursor rather than competing at a radius. Turn on a 6″ grid and every
  corner lands on it **unless something real is nearer**, which is the only
  thing "snap to a grid" can sensibly mean.

### Tracing over an image

An image has no line work, and **none is invented from it**. Edge detection on a
JPEG finds lines that are nearly where the walls are, which is the worst outcome
available: the outline is confidently wrong and nothing on screen says so.

What the cursor holds on to instead is the geometry being drawn:

- the **right-angle lock**, on by default, with the guide line;
- **alignment** with any corner already placed — including corners of outlines
  traced earlier;
- the **crossing of two alignments**, which is what makes a hand-traced rectangle
  come out rectangular rather than nearly rectangular. Click three corners of a
  room and the fourth one snaps to a point nothing has ever been drawn on;
- **outlines already traced** go into the snap index as real segments, so their
  corners and edges take the cursor like walls would. The party wall between two
  rooms ends up one line, not two lines a few inches apart;
- an optional **3″ / 6″ / 1′ grid**, anchored on the first corner placed. Anchored
  to the image it would round coordinates, which means nothing; anchored to the
  first corner it rounds **dimensions**, so a room comes out 13′6″ rather than
  13′5.8″.

Everything else on the screen is identical to the DXF route — same glyphs, same
keys, same right-angle rectification, same several-outlines-one-lit model.

### Scale comes first, on an image

An outline with no pixels-per-foot has a shape but no size, and there is nothing
to lay a grid of lights against — so on an image the scale panel is on the
tracer screen and the plan does not take corners until it is set. Three ways, in
the order you will want them: off a **red fan marker** (a fan is a standard
object, so the mark you drew for the layout doubles as the ruler), by
**measuring** something you can name, or by typing **pixels per foot** outright.

Measuring happens on the tracer canvas, with snapping still live — a door leaf
measured jamb to jamb off a real point beats one measured by eye, and the scale
of everything downstream rests on it. The panel then reports the overall size of
the plan, which is the cheapest check there is: if a two-bedroom flat reads as
90 ft across, the reference was wrong.

### Right angles

Rectifying is on per outline and reversible: only the points you clicked are
stored, and the polygon the planner sees is derived. So the correction can be
turned off and back on without re-drawing, and when it moves a corner by more
than an inch the outline says how far and draws what you actually clicked as a
dashed line beside it.

The planner needs a rectilinear polygon and a diagonal becomes a staircase
either way — better to square it here, visibly, than to have the grid do it
silently later.

### Several rooms — the whole plan at once

Every outline on the plan is lit, together, with one layout each. They are
listed, renameable, and any one of them can be dropped out of the layout or lit
on its own.

This used to be one room at a time, and that was an artefact of an outline having
been something you traced by hand: tracing four rooms in order to light one of
them is work nobody would do, so the app only ever held one. Now that the rooms
arrive together from the detector, they are lit together.

Three things follow from it:

* **each room is still planned in its own local feet**, measured from its own
  bounding box. Nothing about room 3's layout can perturb room 4's, and the
  numbers the planner sees are the numbers it saw when there was only ever one
  room.
* **the exporters take pixels and a scale**, not the planner's feet, because
  pixels are the one space several rooms on a sheet share. Eight rooms each
  measured from their own corner would stack eight layouts at the origin. See
  `roomInFeet` in `exporters.js` — the only place that conversion happens.
* **an ambiguous chunking no longer stops the world.** With one room it was worth
  asking; with eight, asking eight times is an interrogation. A room nobody has
  answered for takes the recommendation and says so in its row, and the picker is
  somewhere to go rather than a gate to get through.

One file per export, whole plan: the DXF puts each room's outline, chunks and
grid on its own layer and prefixes the light tags with the room; the CSV names
the room in the first column; the JSON is a list of rooms with totals.

They are stored in the **plan's own units**, not in the pixel space they were
clicked in. On a DXF that indirection is load-bearing: the pixel space is derived
from the unit interpretation, so an outline held in pixels would slide off its
walls the moment the units were corrected. On an image the conversion is the
identity — its pixels *are* its units, and there is no unit interpretation to
correct — so the same code path serves both and `rasterSource` carries a
`toDu`/`fromDu` pair that does nothing on purpose.

### Two automatic sources, failing in opposite directions

`outlineSources.js` holds both, and they are registered the same way:

| Source | Reads | Fails by |
|---|---|---|
| `roboflow-rooms` | a picture of the plan — so a photo or a DXF, and it does not care what layer anything is on | being approximate everywhere: a boundary a few inches off the wall, sometimes through a doorway |
| `faces` | the wall lines, as a planar graph with the doorways bridged | being exact when it works and nonsense when it does not — on a drawing whose furniture shares layer 0 with the walls it will confidently return the dining table as a room |

`roboflow-rooms` is the one wired to upload, because approximately right
everywhere beats exactly right sometimes — *provided the correction is a drag and
not a re-trace*. Which is why the grips are part of that feature and not a nicety
attached to it.

`faces` is still the better answer for a well-layered drawing. Register it and
call `proposeOutlines('faces', ...)`. What it does, and why doorways are the hard
part, is below.

### Rooms are faces, and doorways are the hard part

A room is a **face** of the planar graph the wall lines form. Getting there is
four steps, and only one of them is interesting:

1. **Arrange.** Weld coincident endpoints, split every segment at every
   crossing, build the graph. Endpoint-on-segment counts as a crossing too,
   which is what catches a wall butting into another (a T-junction) and the
   same wall drawn twice.
2. **Close the doorways.** *This is the whole ballgame.* A doorway is a **gap**
   in the wall line, so until it is bridged the free space of two rooms is one
   region and face extraction returns one enormous blob instead of a flat. Two
   kinds of gap get bridged, and keeping them apart matters:
   - **Drafting slop** — a wall stopping a few inches short of the one it
     meets. Welded, but only up to 3 inches and only *along the wall's own
     direction*. Without the direction test the two parallel faces of a single
     wall are within reach of each other, so every wall welds itself shut
     across its cavity and every doorway in the drawing stops being a gap.
   - **Doorways** — a pair of dangling ends facing each other across a
     door-width gap with the wall carrying on more or less straight through
     (35° of slack). Scored on length and straightness, matched best-first, and
     rejected outright if the bridge would cross existing line work — that last
     check is what stops a "gap" being closed straight across a room. A door
     swing arc near the middle of the gap whose radius matches its width
     confirms it, and those are reported separately as doors rather than bare
     openings.
3. **Faces.** Walk the half-edges, always leaving each node along the first
   edge clockwise from the one you came in on. Turning the same way every time
   traces minimal faces; interior faces come out counterclockwise and the outer
   face of each component comes out clockwise, so the outer face is discarded
   on the sign of its area alone.
4. **Sift.** A wall cavity is a face. So is a column, and the inside of a door
   jamb. Rooms are what survives an area floor and a **minimum-side** test —
   1.8 ft, thicker than any wall and thinner than any corridor, which is what
   separates a room from the gap between two lines of the same wall.

Everything thrown away is counted on the room screen, because the honest answer
to "why didn't it find my kitchen" is a diagnostic, not a shrug.

### The outline is the inner face of the wall

Not the centreline. Reading rooms as faces of the free space gives the inner
face for free, and that is the right answer: the ceiling perimeter is what
lights get laid out against, and at the precision this app argues about — 6 ft
clearances, cells sized to ±25% — half a wall thickness is not a rounding error.

### Which layers are walls

Only the geometric reader needs to know. Guessed from the layer names, which is
a house convention rather than a standard. The guess used to be load-bearing,
and its fallback — "no layer says wall, so use everything that is not obviously
annotation" — is what turned a dining table into a room on a drawing where the
furniture sat on layer `0`.

It also had a one-character bug worth remembering: the pattern required a
non-letter after `wall`, so **`KMBD Walls` did not match**. Nothing was
recognised, the fallback ticked all 1,656 entities on layer `0`, and every sofa
became a wall. Plurals matter.

In the tracer, layer ticks control **visibility and snapping** instead — a
question the person looking at the drawing can actually answer.

Geometry on layer `0` inside a block takes the layer of the INSERT that placed
it, which is the DXF rule. Ignore it and a wall drawn inside a block lands on
layer `0` instead of `A-WALL`, and the layer picker stops working on exactly
the drawings that need it most.

### Units

`$INSUNITS` proposes and the bounding box vetoes. A file saved as "unitless" is
extremely common, and a header claiming inches on a plan whose diagonal would
then be four inches is not evidence, it is a typo — so a header is only
believed when the plan comes out a plausible size, and otherwise the units that
make it read sensibly are used and the override is flagged. Millimetres are
tried first, being what almost every practice in India draws in.

The same plan drawn in mm, cm, m, inches or feet and tagged correctly comes
back as the same rooms at the same size, to within a hundredth of a foot. That
invariant is a test.

Getting the units *wrong* fails loudly rather than quietly: read a millimetre
drawing as centimetres and every doorway becomes a 30 ft opening, nothing
bridges, the walls become dangling stubs and get pruned, and only the squares
where wall lines cross at the corners survive. That is the correct answer to a
wrong question, and it looks obviously wrong on screen instead of producing a
plausible layout of the wrong building.

### Fans on a DXF

There is no red circle to find, so fans are placed by clicking — **Ceiling fans
→ Place fans**, then click the plan. The sweep comes from the same standard-size
list the image route uses as a ruler. With a whole-floor drawing loaded, only
the fans over *this* ceiling are obstacles in *this* layout; the rest are drawn
but reported as belonging to another room.

### Room names

Traced outlines are named `Room 1`, `Room 2`… and renameable in place
(double-click the name). The name follows the room into the export filename and
the JSON.

The geometric reader instead takes names from the drawing's own text. Dimension
strings sit inside rooms too, so anything that is mostly digits,
feet-and-inches marks or a bare area figure is rejected, and of what is left the
biggest text wins — the convention every draughtsman uses. It is also how
`SIGN OF ENGINEER` out of a title block ended up naming a room, which is what
happens when the geometry underneath is already wrong.

### What the parser handles

`dxf-parser` does the tokenising; `src/lib/dxf.js` is the only file that
imports it and converts its output into a flat bag of primitives. Swapping the
parser means rewriting that one file.

LINE, LWPOLYLINE, POLYLINE, ARC, CIRCLE, ELLIPSE, SPLINE, SOLID, 3DFACE, TEXT,
MTEXT and INSERT — including nested blocks, rotation, non-uniform scale and
row/column arrays. Polyline **bulges** are converted properly: a curved wall in
a polyline is not stored as an arc but as `tan(θ/4)` hung on the preceding
vertex, negative if the arc runs clockwise, and getting the sign wrong turns a
curved wall silently straight. Binary DXF is not supported — re-save as ASCII.

## Marking up a plan

One annotation is still read off a plan image (screenshot, scan, PDF export),
and it is optional:

| Mark | Meaning |
|---|---|
| **Red dotted circle** | a ceiling fan — draw one per fan, any number |

Nothing else needs marking. The area to light is traced in the app.

### Why the green marker went

A green closed loop round the area to light used to be the way in for an image.
It worked — *most* of the time, which was the problem. A loop with a gap that the
sealing bridged in the wrong place produced a region that looked entirely
plausible and was wrong, and the only signal was a warning about how much of the
marked box got filled. A boundary that is nearly right is worse than no boundary,
because everything downstream inherits it silently.

It also demanded a round trip through an image editor before a plan could be
uploaded at all. Tracing four corners in the app is less work than drawing a
closed loop in Preview was, and it is exact. `detectRegion` and the sealing and
flood-fill machinery are deleted rather than left dangling.

The red circle stays, because it answers two questions with one mark: where the
fans are, and how many pixels there are to a foot.

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
  6×6 ft — what a cell should cover is **50 sqft, ±25%**; the chunking comes
  first, and every chunk sizes its cells to suit its own width and height. See
  [The cell is an area, not a side](#the-cell-is-an-area-not-a-side).
- **Slivers are omitted entirely**, on two independent tests: a chunk narrower
  than **1.5 ft** in either direction, or smaller than **9 sqft** overall. Two
  rules rather than one because they catch different things — the 1.4 × 20 ft
  strip left behind a duct fails on its short side, and the 2 × 2 ft notch
  beside a chimney breast passes that and fails on area. Neither deserves a
  light. Both thresholds are `minChunk` / `minChunkArea` in `planner.js`.
- **Zone edges count as walls** for the wall-distance rule, so a large light
  keeps its usual clearance from a zone edge just as it would from a wall.
  Lower **Min wall distance** if you want large lights to sit closer to zones.
- Large lights pair cells within a chunk only; the alignment pass then snaps
  rows/columns across chunks so the drawing still reads as one layout.

Chunks export on the `CHUNK` DXF layer, zones on `NO-LIGHT` (rectangle +
cross), and both appear in the JSON under `chunks` / `noLightZones`.

### Finding the bed for you

The bed is the one piece of furniture whose position changes the ceiling. You
do not put a downlight over a bed, because whoever is lying on it looks
straight up into the fitting. Every other rule in this app is about covering a
space evenly; this one is about *not* covering part of it.

Which means a detected bed does not need a new concept — it needs a rectangle
in image pixels, which is exactly what a hand-drawn zone already is. So one is
added, and everything downstream behaves as if you had dragged it yourself.

**It runs on upload, not on a button.** Detection needs only the image, so the
call fires the moment a plan is loaded — while you are still drawing the
boundary. By the time there is a region to light, the answer is already in.

That is why a detection and a zone are **two different things** here:

- a **detection** is a property of the IMAGE. Found once, for the whole
  drawing, with no boundary needed.
- a **zone** is a property of the ROOM. A detection becomes one when its centre
  falls inside the region being lit.

A whole-floor plan has three bedrooms on it and only one of them is this
ceiling, so the other two beds are held and not applied. Draw a different
boundary and the zones change with it, without asking the model again. Getting
this the wrong way round is what made the first cut of this feature do nothing
at all: it needed a boundary before it would look, and a click before that.

**Both routes in come through here.** A photo is downscaled and sent. A DXF is
first rendered to a plain black-on-white raster and then sent — same detector,
same rectangles, same zones. Nothing downstream of the detection knows which it
was looking at.

It is fair to ask why a DXF needs a model at all, since a drawing that places
its furniture as blocks has an `INSERT` named `BED` at an exact point with an
exact rotation, and reading that would be free, offline and certain. The answer
is only that across drawings from different offices it usually does not: block
names are a per-office convention, furniture arrives exploded into raw lines,
and names come through as `F-01`. One path that always works beats two that
each work sometimes. If your own drawings turn out to name their blocks
reliably, reading `drawing.inserts` directly would be strictly better than this
and worth doing — see `dxf.js:333`, which already keeps the names.

Three things about rendering a DXF for the detector are easy to get wrong, and
`detectionSvg()` is tested against all three:

- **Render the drawing, not the canvas.** The live SVG on screen carries our own
  output — grid, lights, cells, zone rectangles, region outline. Rasterizing
  that feeds the model its own answers back. So a fresh SVG is built from
  `source.render` and nothing else. Do not reuse the canvas ref.
- **Keep the furniture layers.** The instinct is to render walls only, the way
  room extraction does. That deletes the thing being looked for. Dimension and
  hatch layers are dropped as noise; anything that might be a bed is kept — and
  a drawing whose *only* layer looks like annotation still renders, rather than
  going blank.
- **The stroke thickens as the drawing shrinks.** A 6400px drawing capped to
  1600 would otherwise render as invisible hairlines.
- **Walls are drawn heavy and everything else light.** A published plan — the
  kind the detector was trained on — draws its walls as solid poché bands and
  its furniture as fine line work. A raw CAD export gives every entity the same
  hairline, so the drawing reads as a wireframe and nothing tells the model
  which lines bound the space. `classifyLayers` already works out which layers
  are walls for room extraction, and the same answer decides which lines get
  weight. On `APT_01_dxf.dxf` it picks `KMBD Walls` out of a drawing whose other
  1656 entities all sit on layer `0`.

  The weight is set in **inches, not pixels**, because px/ft varies by an order
  of magnitude between an apartment and a site plan and a pixel value tuned on
  one is wrong on the next. Around the real wall thickness — 0.55ft, say — the
  two faces of a wall close into a band.

  Two things this gets right that are easy to get wrong: walls are painted
  **under** the furniture, so a heavy band cannot eat the headboard of a bed
  pushed against a wall; and the downscale compensation is applied to **both**
  weights, not just the light one.

  It is exposed as a slider with an explicit re-run rather than fixed in code,
  because only a real call to the detector can say what weight works and that
  experiment belongs to whoever can run it. Nudging the slider deliberately
  does *not* fire a call — detection is not in that effect's dependencies.

**How it is wired.** The image is sent to a Roboflow workflow — an
open-vocabulary detector, asked only for `bed`. Three things about the path it
takes:

- **No bucket, no public URL.** The API takes `{"type": "base64", ...}`
  directly, and `App.jsx` already keeps the base64 on the `img` object because
  the Claude scale estimate needs it too. Nothing is uploaded anywhere and no
  copy of a client's drawing is left in cloud storage.
- **The key is never in the browser.** `api/detect.js` holds it and forwards.
  It runs as a Vercel function in production, and `vite.config.js` mounts *the
  same module* as dev middleware so there is only one implementation. Anything
  Roboflow says in an error is scrubbed before it is relayed, because an API
  that echoes your request back on a validation error would otherwise hand your
  key to devtools.
- **Every call is logged, server-side.** One line per phase, tagged with a
  request id that is also returned to the browser, so a failed run can be
  followed from the console to the terminal:

  ```
  [detect a3f1] -> 184KB image/jpeg, classes="bed"
  [detect a3f1] <- 200 in 940ms via https://serverless.roboflow.com/...
  [detect a3f1] == 1 prediction: bed 0.87 @512x318 340x410
  ```

  A 200 carrying no predictions is the genuinely confusing case — it usually
  means the workflow's output field is named something we did not expect — so
  that case also logs the top-level keys of the response.
- **Downscaled first**, to 1600px on the long side. Cheaper (this endpoint
  bills by processing time), faster, and under the function's 4MB body cap.
  The response echoes the size the model saw, and `rescaleRect` maps the boxes
  back to full-size pixels. If you remove the downscale, do not also remove
  that — a box left in the small space puts the bed in the top-left corner.

**The response shape.** The workflow returns Roboflow's own inference format,
nested three deep under a key also called `predictions`, with the image size
declared one level above the prediction it applies to, and an `rle_mask`
sibling:

```
predictions.predictions.predictions[] -> { x, y, width, height, confidence,
                                           class, class_id, rle_mask }
```

`x,y` is the **centre** of the box, not a corner. Reading it as a corner puts
the zone half a bed off, which looks like a bad model rather than bad
arithmetic, so there is a test for exactly that.

The parser walks for *geometry* rather than for a known path, because the
output field name belongs to whoever built the workflow. It accepts the named
centre form, `bbox`/`box`/`xywh`/`xyxy` arrays, polygon points, and 0..1
fractions — that last one mattering because fractions left unconverted look
like a 1x1 pixel speck and die on the area floor, reported as "found nothing"
rather than "wrong units". The `rle_mask` is deliberately ignored: it is a
better outline than the box for a bed drawn at an angle, but zones are
axis-aligned rectangles, so there is nothing to spend it on. It must not be
walked into, and it must not be mistaken for a detection on its own.

**Seeing what actually went over the wire.** Under **No-light zones → What the
detector saw**, the sidebar shows the image that was sent and, when the
workflow returns one, the annotated image that came back — side by side, open
by default on a DXF, because the vector render is the part most likely to be
wrong. The comparison is the point: if the mask on the right sits on the bed,
the render was fine and any error is in the mapping back; if the left image is
not readable as a floor plan, the render is the fault and no model would have
done better. **Save both images** writes them to Downloads (a page cannot write
into `public/samples/` itself).

Finding that returned image is less obvious than it sounds. The field could be
called anything the workflow author typed, so the walk ignores key names and
decodes the first few bytes instead — `iVBORw0KGgo` for PNG, `/9j/` for JPEG.
That matters because a response is full of long base64-shaped strings that are
not images, `rle_mask.counts` chief among them, and a walk that trusts "looks
like base64" renders one of those as a broken thumbnail.

**What is thrown away, and why.** A detection is refused if it is below 35%
confidence, covers more than 60% of the plan, is under 0.4% of it, or sits
outside the region being lit. The middle two matter most: a box over the whole
drawing would subtract the room to nothing and return **zero lights**, which
reads as a planner bug rather than a detection one. The last matters on a
whole-floor plan, where there are three bedrooms and only one of them is this
ceiling. Rejections are listed in the sidebar with the reason, so a miss is
diagnosable instead of just empty.

**A limit worth knowing about.** The drawing's `HATCH` entities never reach the
render: `dxf.js` has no `HATCH` case, so filled regions are missing. That is why
walls need faking with a heavy stroke instead of arriving already solid, and it
is also why some furniture comes through as an outline with no body. If
detection stays unreliable after tuning the wall weight, hatch boundaries are
the next thing to parse.

**Known limits.** The model is reading a line drawing, which is not what it was
trained on — it works better than you would expect and worse than you would
like, and it should be checked against the drawing every time. A bed drawn at
an angle becomes its bounding box, so it over-covers at the corners. Zones are
axis-aligned rectangles; the segmentation polygon is discarded. And a king bed
is roughly a third of a small bedroom's ceiling, so expect the
[chunk picker](#choosing-how-the-space-is-chunked) to appear on a room that
looked like a plain rectangle — that is the zone doing its job, not a fault.

**Setup.** `ROBOFLOW_INFERENCE_KEY` and `OPENAI_API_KEY` in `.env.local` for dev,
and in the Vercel project settings for production. Optionally `ROBOFLOW_WORKFLOW_URL` to point at
a different workflow; it defaults to the one in `api/detect.js`. Never prefix
either with `VITE_` — that is precisely how a key ends up in the bundle. See
`.env.example`.

### The other detector: asking GPT for the bounds

Roboflow and a general vision model fail in opposite directions, which is the
whole argument for having both. Roboflow knows a box when it commits to one and
the box is tight — but it is a trained detector looking at a **line drawing**,
which is not what it was trained on, so it often commits to nothing. GPT
recognises a bed on a plan immediately, can **read the room name printed next to
it**, and will tell you there are three of them. What it cannot do is measure.

That distinction is the entire design. Its encoder turns the plan into a coarse
grid of patch tokens and there is no spatial regression head on the end, so
asked for pixel coordinates it returns plausible numbers with an error of a few
percent of the image. A few percent sounds tolerable until you put it in feet: on
a 20ft bedroom at 1600px, 5% is a foot, which is the difference between a zone
that covers the bed and a zone that covers the bedside table and half the pillow.

So it is asked for nothing but **the four edges of the box, as fractions of the
image**. No pixel counting, no real-world size, no scale reasoning. The width in
feet, the 0.25ft padding, the rectangle, the room test and the zone are all
worked out here, from fractions and the px/ft you already have — arithmetic we
are better at than it is. `src/lib/openaiDetect.js` is that translation, and it
is pure: no fetch, no browser, unit-tested against every reply shape a model has
actually produced.

**Same shape out.** `replyToPayload()` emits Roboflow's own prediction format —
centre-plus-size, with the image size declared alongside — so `furniture.js`
parses both providers with **no changes at all**. Every guard that already exists
applies to this route for free and cannot drift, because it is not duplicated:
the confidence floor, the >60% and <0.4% area rejects, the in-room filter, the
IoU de-dup, the padding, the rejection list in the sidebar. `tools/test-openai-detect.mjs`
ends by running a GPT reply all the way to `planLights` and asserting no light
lands on the bed — the same claim `test-detect-flow.mjs` makes for Roboflow.

**Wiring.** `provider` in the body of `/api/detect` picks `roboflow`, `openai` or
`both`; the picker is under **No-light zones → What the detector saw**, and
switching it re-runs on the image already sent. `both` fires the two calls
concurrently — they are independent, and the point of detecting on upload is that
the answer is in before there is a boundary to apply it to — and returns both
payloads under one root. Nothing merges them by hand: `collectPredictions()`
walks for geometry rather than for a key, so it finds every prediction in there,
and `dedupe()` collapses two providers' boxes over one bed into one zone.
Either provider failing is reported alongside the other's result rather than
replacing it. `OPENAI_API_KEY` lives in `.env.local` and never leaves the server;
the OpenAI leg is scrubbed on the way out exactly as the Roboflow one is, and
`test-detect-api.mjs` asserts the key is absent from a response body even when
the upstream echoes the request back.

**What it gives you that a box detector cannot.** It reads the plan. The room
name comes back with every box, so `MASTER BEDROOM` arrives attached to the
biggest bed, and when it finds nothing it says why in words — which is the only
useful thing on the wire in that case, so its reply is relayed and shown.

### Measuring it instead of arguing about it

Adding a provider is half a day and produces a feature that looks like it works.
Whether it works is a number: how far, in **feet**, is the zone from the bed. You
cannot see a foot in a screenshot. So:

```
node tools/eval-detect.mjs public/samples/FLOOR_PLAN_03.png --arms bounds,roboflow
node tools/eval-detect.mjs plan.png --repeat 3        # is it stable run to run
node tools/eval-detect.mjs *.png --arms bounds        # a sheet of your own plans
node tools/eval-detect.mjs --list-models              # what this key can see
```

It runs each provider over each image, feeds every response through **the real
`detectionsToZones()`** — so a number it prints is a number the app would produce
— and writes, per arm: the exact image that went over the wire, the raw reply,
and an overlay with the predicted box, the ground truth dashed, and the IoU
printed on it. Then a table of mean IoU, worst case, centre error in feet,
latency and tokens.

Ground truth is a sidecar next to the image, in original pixels, corners not
centres:

```json
{ "pxPerFt": 40, "beds": [ { "x0": 175, "y0": 980, "x1": 411, "y1": 1245 } ] }
```

`FLOOR_PLAN_03.truth.json` is one, hand-measured. Ten minutes of that on five of
your own plans is what turns "seems decent" into a decision. Without it the tool
still runs and still writes the overlays, which is enough for a plan you have
never tried before.

`public/samples/bedroom-2bed.png` is generated by `tools/make-bedroom-fixture.mjs`
together with its own exact truth file — a synthetic two-bedroom flat with three
beds and, deliberately, a sofa, a dining table and two wardrobes to be confused
by. A detector that fails there is broken; one that passes is merely not
obviously broken. It is the floor, and it is free.

**Two arms exist only inside the eval**, and are worth knowing about mostly so
that you know they lost. `gridPixels` burns a labelled measuring grid onto the
image so the model can *read* a coordinate printed next to the bed instead of
estimating one; `gridCells` does the same but takes the answer as cell
references (`C4`–`F6`) and converts, making the error quantised and bounded
rather than open-ended. Both are a drawing step that can be wrong, a busier
image, and a second coordinate space to map out of — and a grid fine enough to
be precise is dense enough to bury the furniture underneath it. Which is why the
eval reports an **arm ceiling**: `gridCells` rounds outward to whole cells, so
even a perfect answer scores about 0.44 IoU at a 4ft grid. Printing that next to
the score is what stops the table lying — "0.44" reads as a bad model; "0.44,
ceiling 0.44" says the model was perfect and the *method* is the limit, which
points at a completely different fix.

**And the idea that everyone has first**, worth writing down because it is nearly
right: *ask it to draw the box in a distinctive colour and find the colour
ourselves.* It cannot. The vision API is read-only — an image goes in, text comes
out — and the only way to get an image back is the image *generation* model,
which re-synthesises the whole picture. You would get a convincing floor plan
that is not your floor plan, with the walls moved.

The instinct is salvageable by turning it round: **we** draw the candidates and
the model picks. `detect.js` already has colour masks, morphology, connected
components and boundary tracing; those can propose the closed rectangles of line
work inside a room, we outline each in its own colour, and ask which one is the
bed. Picking from a short list is recognition, which is its strong suit, and the
box is then exactly as tight as our own pixel code — no regression anywhere. That
is the arm to build if `bounds` measures badly on real drawings, and it is
deliberately not built until the eval says so.

**No JPEG in the harness.** `tools/pnglite.mjs` is a dependency-free PNG codec
and a tiny raster, so the eval works on a fresh clone with nothing installed;
the price is that images go up as PNG while the app sends JPEG at 0.92. PNG is
the easier image to read, so treat the numbers as the optimistic end, and pass
`--jpeg` to close the gap exactly when `sips` or ImageMagick is around. A DXF is
not an input either — the vector route rasterises in the browser — so evaluate
one by loading it in the app, clicking **Save both images**, and running the
harness on the PNG that lands in Downloads. That is the real render, which is
the point.

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
| **Best grid fit** | Prefer pieces whose sides divide cleanly into the ideal cell side, so cells land *on* the target area rather than near it. |
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

On a DXF there is nothing to do: the file states its units, so the scale is
exact and the controls are not offered. Everything below is the image route.

On an image the scale is asked for **before anything can be traced**, on the
tracer screen itself — see [Scale comes first, on an
image](#scale-comes-first-on-an-image). The same three controls stay in the
sidebar afterwards, so a scale can be corrected without re-tracing: outlines are
stored in image pixels, so correcting the scale corrects every room's size and
leaves every room where it was drawn.

Three routes, in the order you'll actually want them:

1. **From fan** (default). If you drew a red fan circle, a fan is a standard
   object — 1200mm sweep unless you pick otherwise. Zero extra input. With
   several fans the **median** of the per-fan scales is used, so one sloppily
   drawn circle doesn't skew the result; the panel lists each detected sweep
   and warns if they disagree by more than 15%.
2. **Measure.** Click the two ends of something identifiable (door leaf, sofa,
   WC, bed, car bay) and pick what it is from the list. On the tracer screen the
   cursor still snaps while you do it, which is worth having: the accuracy of
   every dimension in the drawing comes off these two clicks.
3. **Manual.** Type pixels-per-foot directly.

There's also an optional "Let Claude find the scale" panel — it sends the image
to the Claude API and asks it to spot a door, fixture or dimension line. Needs
your own API key, which stays in this browser's local storage.

## How the layout is computed

```
rectify → carve zones → ENUMERATE CHUNKINGS → you choose → per-chunk grid
        → matching → align → fixtures
```

1. **Rectify.** The traced outline is simplified, forced to 90°, and its
   coordinates are clustered so near-aligned walls become aligned.
2. **Carve + chunk.** No-light zones are subtracted from the room, and the
   remaining space is decomposed into rectangular chunks on the elementary grid
   formed by wall lines and zone edges. Every wall line and zone edge is
   crossed, so each elementary cell is wholly free or wholly blocked — never
   partial — which is what makes an exact rectangular cover possible at all.
   Several decompositions are produced and **you pick one**; chunks thinner than
   `minChunk` (1 ft) are omitted from whichever you pick.
3. **Partition.** Each chunk is divided in x and y **together**, because both
   "does a cell cover about 50 sqft" and "does the fan land on a cell centre"
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
   all **four** boxes that meet there — and at a **T-junction**, where it sits on
   a vertex of one chunk's grid and on the interior of a neighbouring chunk's
   cell edge, it lights **three**. Coverage is computed by asking which boxes
   contain the point, so chunk boundaries are crossed where they should be.

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

A cell should cover **50 sqft, give or take 25%** — 37.5 to 62.5. That is the
brief said in the unit that actually matters, and saying it that way changes
what the grid is allowed to do.

Held to a fixed *side*, every deviation is a cost and the grid has nothing to
spend. Held to an *area band*, a 6 ft cell next to an 8 ft one is not a
compromise at all — both are simply fine — and the width of that band becomes a
budget the grid can spend on the things that matter.

### The sides follow from the area

`targetCell`, `minCell` and `maxCell` are **derived**: the ideal side is
`sqrt(targetArea)`, and the bounds are 2/3 and 4/3 of it. Those are the same
proportions the old absolute 4 ft and 8 ft bore to a 6 ft ideal, which means the
worst oblong the bounds admit is the *same shape* at 50 sqft as at 36 — the
aspect envelope does not drift when you move the area. Pass any of the three
explicitly and your value is used instead.

This matters more than it sounds. `targetCell` is not only the ideal side, it is
the centre of the search: the divisions ever considered are
`round(W / targetCell)` minus one, that, and plus one. Leave it at 6 while the
area asks for 50 and the coarse division is never enumerated at all.

### Bigger boxes first

Inside the band, **bigger wins**. The cost of a cell falls linearly to zero at
the top of the band, so between two divisions that both qualify the grid takes
the coarser one: fewer, larger boxes, fewer lights. It cannot push past the band,
because outside it the charge is a step change rather than a slope.

The order of precedence, when these pull against each other:

1. **The cell has to be a cell.** Area inside the band *and* both sides inside
   `minCell`..`maxCell`. Every grid that qualifies beats every grid that does
   not, whatever else is on offer — a 12 × 4 ft box covers 48 sqft and is
   nobody's idea of a lighting grid. Only when *nothing* qualifies does the soft
   penalty decide, and then it prefers the near miss.
2. **The fan.** A chunk's lone fan goes on a grid line, and `fanLineWeight` sits
   above the entire spread of the size and aspect terms combined, so a fan on a
   line is never traded away for a bigger cell. See below.
3. **Bigger.** The coarsest division that still qualifies.
4. **Squarer.** `shapeWeight` prices the aspect *ratio*, not the distance from
   the ideal side, so it stays orthogonal to (3): a big square cell and a small
   square cell are equally square, and the two terms never fight.

So the fallback chain reads: try to be big, and if the band will not have it get
smaller; if no near-square division fits, take a more rectangular one. That last
step is the hard tier doing its work — an oblong inside the band beats a square
outside it.

Set it in the sidebar: **Cell area**, **Area tolerance**, and **Prefer bigger
cells** for the strength of (3).

## A lone fan goes on a grid line

**A chunk holding exactly one fan puts a grid line on that fan.** Not near it —
on it.

One fan is one coordinate pair to hit, with no second fan whose claim could
contradict it, so the grid can be bent to meet it exactly. The bend is real: the
cut line goes at the fan's coordinate and *each side of it is then divided on
its own terms*, so a 30 ft chunk with a fan 7 ft in becomes one 7 ft cell and
four of 5.75 ft. Cell sizes differ within the chunk — that is the price — and
the area band above is what keeps the price bounded. A division that would put a
cell outside the area band is not available to be bought.

Both axes are tried, and hitting **both** is worth more than hitting one:

| Where the fan ends up | What that means |
|---|---|
| **On a grid intersection** | A shared corner of four cells, each centre half a diagonal away — the best case, and what the algorithm reaches for first. |
| **On a single grid line** | On the edge between two cells. Good, unless the fan also sits level with those two centres, which the awkward-cell count then charges for. |
| **Inside a cell, near its centre** | The case worth all this trouble to avoid: that cell can hold no centred small light, and every grid intersection around it is inside the fan's clearance circle too, so no large light can rescue it either. |

A fan closer than one cell to the chunk's edge is left alone — there would be no
room for a cell on the near side, and such a fan already sits near a wall line.

**The band comes first and the fan second.** Where no division that puts a line
on the fan can keep every cell inside the band, the fan does not get its line —
the grid is not allowed to buy it with a 28 sqft cell. That is rare (2 of 82
single-fan rooms in the sweep) and the test reports it separately rather than
counting it as a miss. **Bigger comes third**: where a coarser grid and an
anchored one both qualify, the anchored one wins.

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
and it turns out to be the robust choice rather than a fudge. The table below
was measured at ~6 ft cells; at the 50 sqft default the cells are nearer 7.5 ft,
which pushes the two clusters further apart and makes the plateau wider still.
With ~6 ft cells,
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

## Reading the result

Two numbers, because two numbers are what a lighting layout is judged on:

- **lights** — how many fittings, full stop.
- **lm / sq ft** — what they add up to over the room's actual area. A count on
  its own says nothing: twelve fittings in a 400 sqft hall and twelve in a 90
  sqft bedroom are different jobs. Roughly 15–20 lm/sqft reads as comfortable
  ambient light for a living space and 25+ as bright, but that depends entirely
  on `FITTING_LUMENS` matching the product actually being specified.

Everything else the panel used to report — cells lit, average cell side, rows
and columns, lights covering four boxes, large lights off the midpoint — was
instrumentation for tuning the planner, and the planner is no longer tuned from
the screen. It is all still in the JSON export and in `plan.stats`.

## Task surfaces: the third layer

Ambient light covers a ceiling evenly. Accent light picks out a surface for the
look of it. A **task surface** is neither: it is a horizontal plane somebody
actually does something at — eats, meets, writes, sets a cup down — and it wants
its own light at its own level.

**Task surfaces** in the right-hand panel finds them, one room at a time. Four
things, and each is defined as much by its context as by its shape:

| | only if |
|---|---|
| **Coffee table** | the low table **out in front** of a sofa — not an end table |
| **Dining table** | in a dining area, ringed by four to eight chairs |
| **Conference table** | in an office — eight or more chairs, usually a room of its own |
| **Executive desk** | in a private office or cabin, one person at it |

**The qualifier is half the definition**, and stating it is what stops the pass
finding console tables in corridors. A rectangle is only a coffee table because
of where it sits relative to a sofa; the same rectangle alone is a console. The
prompt asks for the *relationship*, not just the object, and says why.

> **End tables are refused by name**, and they were the noisiest false positive
> the pass had — a pair of small circles flanking a sofa's two arms came back as
> two coffee tables. They are small tables next to seating, which sounds exactly
> like the coffee-table rule, so the prompt has to distinguish them explicitly:
> a coffee table sits out in FRONT of the sofa's long side and is several times
> the area, and a matching pair flanking the arms is a giveaway that neither is
> one. Size is given as the tell rather than position alone, because position is
> what the two have in common.

The box is **the surface, not the arrangement** — the table top is what will
eventually be lit, and the chairs are only how you recognised it. A box round
the whole group is a box round the wrong thing.

### It only finds them

Nothing is placed, nothing is recommended, and the drawing says so: a task
surface is a plain box with corner ticks and no fitting symbol of any kind,
under every other layer. What a surface should get — a pendant, a downlight over
it, a level of its own — is the next decision, and the drawing should not imply
one that has not been taken.

That is deliberately the same order the accent pass was built in: see whether it
can *see* the thing before deciding what to do about it. Building it the other
way round is what made the accent pass's one real failure look like a mystery
instead of a missing wardrobe.

### One route, two questions

`/api/accents` takes a `task` — `furniture` or `surfaces`. Both send an
**identical** masked crop of one room and both get back a list of things with
boxes on it; only the vocabulary differs. A third endpoint would have been a
third copy of the key handling, the scrubbing, the size guard and the logging.

The parser is shared for a sharper reason. `itemList`, `rectFromEntry`,
`toPixels` and `describe` are the machinery for reading "here is a list of
things with boxes on the image I sent", which is not specific to furniture — and
[the units question](#the-strip-problem-and-why-the-model-boxes-the-furniture)
(fractions? percent? pixels? a box hanging a hair off the left edge?) is the one
that costs a day when two parsers quietly disagree about it. There is now
exactly one place it is answered.

## The secondary grid, and the spot on it

A task surface is found; something has to light it. That something is a
**directional spot**, and where it goes is decided by a second grid laid over
the first.

### What the secondary grid is

The ambient layer already put a light at the centre of every cell, and those
lights fall into rows and columns. Draw a line through every one of them,
horizontally and vertically, run each line out until it meets the **chunk's**
own outline, and that is the secondary grid.

It is not really a new grid — it is the ambient grid's skeleton made explicit —
and that is exactly why a spot belongs on it. A spot dropped at whatever point
happens to be nearest the coffee table sits at some arbitrary offset from
everything else on the ceiling and reads as a mistake. A spot on the line
between two downlights reads as part of the layout, because it *is* on the
layout's own geometry.

It is **invisible**. There is a *Secondary grid* switch under View, off by
default: the lines are not a thing on the drawing, they are the reasoning behind
where a spot went — worth switching on when a spot lands somewhere surprising
and worth being absent the rest of the time. With it on, the segment the spot
actually chose is highlighted.

### Where on it the spot goes

Two classes of segment, tried strictly in this order:

1. between two **adjacent lights** on the same line — the midpoint of whichever
   one's centre is nearest the task surface
2. between the **outermost light** on a line and the chunk's outline, same rule

The order is the rule and not a tie-break: **a poor pair beats a good edge every
time.** The edge class exists for a surface out at the margin of a room, where
there is no pair of lights on the near side of it, and `tools/test-spots.mjs`
asserts that a surface hard against a wall still takes the light-to-light
segment when one is legal.

Only *adjacent* lights on a line make a pair — a segment that skips over a light
in between is not a segment.

### One spot lights one surface

A segment is spent once. Placed independently, two surfaces either side of the
same pair of downlights would both take that pair's midpoint, and the drawing
would show one fitting apparently aimed at two things. So the whole room's
surfaces are planned together — the rule is about the *set*, and cannot be
decided by a function looking at one surface.

**First pick goes to the largest surface**, which is a real choice rather than an
accident of the order the model happened to list them in. A dining table and a
coffee table competing for one segment resolve in favour of the dining table: it
is the bigger commitment, it is harder to light from somewhere else, and a
compromise on the coffee table costs less. Equal areas fall back to list order,
so the same input always produces the same drawing.

### A chandelier already lighting it

A chandelier within **3 ft of the surface's outline** means no spot is added. A
chandelier over a dining table *is* the task light for it, and specifying a spot
beside one is specifying a fitting nobody will install.

Measured from the chandelier's own **body**, not its centre — a five-foot
fitting reaches further than its centre suggests, which is the whole reason it
counts as lighting the table underneath it.

The surface is **skipped, not refused**, and the panel says so differently: a
refusal is a problem to solve, a skip is a decision the chandelier already made.
A skipped surface also does not consume its segment, so another surface may
still use it.

`SPOT_DEFAULTS.chandelierNear` is the dial.

### The ambient rules apply to it

A spot is a fitting in the same ceiling, and the reasons those rules exist do
not care what the fitting is for. A candidate midpoint has to be inside the
room, clear of every ceiling object's clearance, out of the no-light zones, and
far enough from a wall.

**The wall figure is 2 ft, not the ambient layer's 5**, and this is why it was
made a separate dial in the first place. 5 ft is what a *large light* keeps,
because its cone lands on the wall and scallops it. A spot is a narrow beam
aimed at a table and pointed away from the wall; the wall behind it is not in
the picture.

Inheriting 5 ft was actively wrong rather than merely conservative. In a 13 × 10
living room it refused **every** segment — both coffee tables came back "closer
than 5 ft to a wall" and got no spot at all — and in a larger room it did the
quieter version of the same thing, pushing the spot off the near segment onto one
further away. Both are asserted in `tools/test-spots.mjs`. Inheriting a number
without inheriting its reasoning is how a constant ends up load-bearing
somewhere nobody meant it to be.

One rule is the spot's own: **it may not stand on its own surface.** A spot over
the centre of the table has no direction to point in, and the arrow is half the
drawing.

Every refusal is a sentence on the surface's row in the panel — *"every segment
near this surface is inside a ceiling object's clearance"* — because "no spot
appeared" is not something anyone can act on.

### The symbol

**The same blue as the ambient downlights**, because it is the same kind of
thing: a fitting in this ceiling. What makes it a task light is that it is
*aimed*, and the arrow is the whole of that — it starts at the rim rather than
the centre, so the body stays a clean circle and the tail cannot be read as a
conduit run, and it points at the centre of the surface the spot was placed for.
The drawing says not just where the fitting goes but what it is for.

### Derived, never stored

A spot is a function of the surface, the ambient layout and the obstacles, and
all three of those move — nudge a fan and the segment a spot was standing on can
become illegal. Holding it in state would mean a spot that was right when it was
computed and quietly wrong ever after. It is recomputed, so it is always the
answer to the layout as it actually is.

## Ceiling objects: a chandelier is a fan with a different drawing

The right-hand panel places four things on the ceiling for the grid to work
around:

| | | |
|---|---|---|
| **Fan** | 900 or 1200 sweep | |
| **Chandelier** | freely resizeable | corner handles |
| **AC unit** | dimensions in mm | resize and rotate |
| **Trap door** | dimensions in mm | resize and rotate |

An AC cassette and a trap door differ in what they are called, what they are
drawn as and what size they default to — and in nothing else; `isRect` is the
only distinction any of the maths makes. They are drawn with two different marks
rather than one mark at two sizes, because on a printed sheet "small square" and
"slightly smaller square" is not a distinction anyone can make.

**They are not a new kind of obstacle.** The planner is built round the fan — a
centre, a radius, `fanClearance` on top, and a soft anchor the grid tries to
line up with — and it tests for one in seven separate places. A second kind of
obstacle would mean a second path through all seven. So everything here resolves
to `{ x, y, r }` and goes in as `type: 'fan'`. The planner is never told the
difference; only the canvas draws them apart. `tools/test-ceiling.mjs` asserts
that a cassette and a fan of the same radius produce a byte-identical layout,
which is the whole claim.

**Clearance is measured to the object's FACE**, not to a circle round it.
`surfaceDistance` in planner.js is the signed distance from a point to the
obstacle's surface: for a circle that is `hypot − r`, and for a rectangle it is
the point rotated into the object's own frame and the offset that falls outside
it on each axis. Six sites in the planner used to test `hypot(q − f) < f.r +
fanClearance`; they now all test `surfaceDistance(f, q) < fanClearance`, and
`fanClearance` finally means what it says.

> **It was circumscribed, and that was wrong enough to matter.** A rectangular
> object used to be handed the circle that contained it — half its diagonal —
> which is right at the corners and badly wrong along the flats. A 900 × 900
> cassette reserved 636mm in every direction where its own face is 450mm out; a
> 1200 × 600 trap door reserved 670mm along an edge that is 300mm away. On a
> tight ceiling that is a whole row of downlights refused for nothing. The exact
> answer is four lines of arithmetic and no slower.

The set of points exactly `fanClearance` from a rectangle is that rectangle
grown by the clearance with its corners rounded to that same radius — which is
what the canvas draws. **What you see reserved is what is reserved**, and
drawing a big circle round a small cassette is how it came to be reserving one.

A fixture with no `shape` is a circle, so every fan the red-circle detector ever
found behaves exactly as it did.

Rotation is now real geometry rather than documentation: turning a 1200 × 600
trap door genuinely moves which side of it a light can sit on, and the offset
outline turns with it.

### The hit-test rule

SVG paints in document order and hit-tests the **topmost painted thing** under
the pointer — and "painted" includes a fill at 9% opacity. So any annotation
layer drawn after a control silently eats its clicks. This bit twice:

- the accent symbols' white ground covered their own handles, so clicking a
  sconce *deselected* it
- the task-surface box swallowed the grab area of a fan sitting inside it, so
  the fan stopped showing a move cursor and could not be picked up

Two bugs, one cause, and marking each offender as it turns up is a losing game
because the next layer added does it again. So the rule lives in one place, in
`styles.css`:

```css
.plan{pointer-events:auto}
.plan g,.plan rect,.plan circle,.plan line,.plan path,
.plan polygon,.plan text,.plan image{pointer-events:none}
.plan .hit{pointer-events:all}
```

**Everything inside the plan is inert; the handful of elements that are genuinely
controls re-enable themselves with `.hit`.** `pointer-events` inherits, so a
`.hit` nested inside an inert group works, and a click on anything else falls
through to the canvas — which is what the empty-ceiling and outside-the-room
behaviour wants anyway.

> Verified with real clicks in a headless browser rather than by reading the
> code: a control under a 9% fill, a handle under an opaque symbol, and — as a
> control on the experiment — the same structure *without* the rule, which does
> steal the click. `elementFromPoint` agreeing also means the CURSOR resolves to
> the control, which was the visible symptom. The harness needs Playwright so it
> is not in `npm test`, which stays dependency-free.

### Outside a room, nothing is active

The canvas is bigger than the rooms on it — margin, rooms nobody is lighting,
the rest of the sheet — and a tool that stays armed out there is a tool that
drops a fan in the garden because you clicked to dismiss something. So the
surrounding canvas is **dead space that cancels rather than acts**: a click out
there disarms the palette and clears the selection, and does nothing else. The
cursor reverts from a crosshair to a pointer as you cross the boundary, which is
the cursor's job — saying what a click will do before it is spent.

### The palette, and momentary alignment

Four symbols in a row, not a dropdown. A dropdown asks you to read four words
and commit before you can see what you picked; these are drawn objects, the
symbol *is* the name, and the mark on the button is the mark that lands on the
plan. Clicking one arms it — there is no separate "place" button, because
picking the thing is already asking to place it.

A fan's **sweep** (900 or 1200) appears only when a fan is in play, armed or
selected. It is the one property of the four that is a standard size rather than
something to drag to.

**Guides appear while you place and while you drag**, not after. As the object's
centre comes within a few pixels of lining up with something meaningful, it
clicks onto that line and the line briefly draws itself, so you can see what you
aligned to and why it moved. Today two sources are wired up — the centre of a
room, and the centre of another ceiling object — but `snapGuides.js` is shaped
for more of them: a source returns TARGETS, a target is
`{ axis, value, span, kind, label }`, and everything after that is the same code
however many sources there are. Edges, thirds, equal spacing and the lights
themselves are each a new entry in `collectTargets` and nothing else.

Four decisions in there that are not obvious:

- **The two axes snap independently.** A point can be dead on a room's vertical
  centreline while being nowhere near anything horizontally, and that is a real,
  useful alignment. Requiring both would make the snap almost never fire.
- **The object's centre snaps, not the pointer.** Snap the pointer and the same
  drag lands differently depending on where inside the object you picked it up.
- **The tolerance is in screen pixels**, converted by the caller. Snapping that
  gets stickier as you zoom in fights you: it should engage when two things
  *look* aligned, and how aligned they look is a property of the screen.
- **A guide stops at the thing it came from.** A line that ends at the room it is
  about is a line that says which room it is about.

### Direct manipulation, and the copy bug

Drag to move. Four corner handles resize — **Shift** keeps the ratio, **Alt**
resizes from the centre. The stem above an AC unit rotates it, freely, with
**Shift** snapping to 15°. **Del** removes, **Esc** deselects. *Add to plan* arms
a single placement and disarms itself once you have dropped one, the way a shape
tool returns to the pointer.

Three things make the difference between this feeling like an editor and feeling
like a drawing you are poking at, and all three are worth writing down because
none is obvious:

**The opposite corner does not move.** Grab the bottom-right and the top-left
stays nailed down, so the object grows under your hand. Resizing about the
*centre* is the easier thing to write — and is what this did first — and it makes
the object appear to run away from the pointer at half speed in the wrong
direction. Alt is how you ask for centre-anchored behaviour deliberately.

**Grips are blue, and the drawing is not.** Selection frames, handles and
guides are UI that happens to be rendered in the drawing's coordinate space, so
they take the colour every editor uses for exactly that — never the colour of
the object they are attached to, which would read as part of it.

**Handles are a constant size on screen.** Everything else on this canvas is
drawing and scales with the zoom; a control is not drawing. Without the `/ zoom`
a handle is unusably small at 40% and a dinner plate at 300%.

**Resize and rotate happen in the object's own frame**, so the selection box
turns with a rotated cassette instead of staying square to the page. The box is
telling you what a resize will change; on a rotated object an axis-aligned box
would be lying about that.

> **The copy bug**, because it is a trap anyone would fall into twice. Placement
> used to live on the canvas's `onClick`, and the handles called
> `e.stopPropagation()` on **pointerdown**. Those are two different events:
> stopping the pointerdown does nothing whatsoever to the click the browser
> synthesises afterwards. So every drag ended with a click bubbling up to the
> canvas, and the canvas dutifully placed a second object on top of the one you
> had just moved.
>
> The fix is not another `stopPropagation`. It is that the whole gesture now
> lives in the pointer events, with **nothing on click at all**. Pointerdown
> bubbles child-first, so a handle stopping it means the canvas genuinely never
> hears about it, and there is no second event left to leak.
>
> The same conflation was in the state: one flag was both "editing" and
> "placing", so the tool that let you move something also placed a new one on
> any click, and a click that missed by a pixel added an object instead of
> selecting one. Those are now `objMode` and `armed`.

The gesture maths lives in `ceilingObjects.js` and is pure — which point stays
still and what the modifier does is arithmetic, not something React should be
deciding inline, and `tools/test-ceiling.mjs` checks it with no pointer
involved.

**Held in feet, not pixels**, and kept in a list of their own rather than in
`fans`. A fan the red-circle detector found *has* to be pixels — that is all it
knows — and it doubles as the ruler the whole raster drawing is scaled from, so
dropping a hand-placed chandelier into that list would change the plan's scale
when you added a light fitting. An object someone placed is a real thing of a
real size; feet is what keeps it that size when the scale is corrected
underneath it. The two lists meet in `obstaclesPx` and nowhere earlier.

## Accent lighting: the model marks the region, the code places the fitting

Everything above this is the AMBIENT layer — a grid, and a light at the centre
of every cell. This is the layer on top of it, and it places exactly **two
things**: a **wall sconce** and an **LED strip**. Pick a room, press the button,
and a vision model reads the plan and applies the house rules.

It is asked **room by room**, because the image that goes over the wire is one
room with the rest of the sheet dimmed away behind it.

### Why this can be asked of a model when "where exactly is the bed" could not

[The other detector](#the-other-detector-asking-gpt-for-the-bounds) spends its
header explaining that a vision model cannot measure — no spatial regression
head, several percent of error, which on a 20 ft room is a foot. All still true.
What changed is the question.

An ambient downlight is placed at a POINT. An accent fixture never is: it is
placed ON something. So what comes back is a **region containing the right wall
or the right object**, and the position is derived from that region afterwards
by code that can measure. **A region absorbs the error a point propagates** — a
box 20% too big still contains the right wall. That is the whole architecture.

It also means the model never has to name anything. No wall labels are burned
onto the image and there is no legend to read: it circles a region, which is
recognition, and the geometry code does the naming. A model cannot hallucinate
`W9` in a six-wall room if it is never asked for a wall's name.

### The strip problem, and why the model boxes the furniture

A sconce is a point, and a box round a point is nearly the answer already. **A
strip is a line, and a box round a line does not say where the line starts or
stops.** Circle the wall behind a TV and you have six feet of wall and no run.

The instinct is to ask the model to *draw* the strip in red and read the colour
back out. **It cannot.** The vision API is read-only — an image goes in, text
comes out — and the only thing that returns an image is the *generation* model,
which re-synthesises the whole picture: a convincing floor plan that is not your
floor plan, with the walls moved. Same wall this README hits in [Measuring it
instead of arguing about it](#measuring-it-instead-of-arguing-about-it).

So the question is turned round. A strip never runs along an arbitrary line — it
runs along an **object**: the TV unit, the wardrobe, the vanity. That object has
an extent, and **that extent is where the strip starts and stops**. So the model
is asked to box the object, which is recognition, and `accentPlace.js` projects
the object onto the wall it stands against. The projection *is* the run. The two
numbers nobody could estimate fall out of the drawing for free.

| type | role | the box means | what the code derives |
|---|---|---|---|
| `sconce` | `fixture` | where the fitting goes — must straddle a wall | the point on that wall, and the mirror of its pair |
| `strip` | `target` | **the object it runs along**, all four sides | the run: start, end, length, offset |

**The role is not taken from the reply.** It is derived from the type through
`ROLE_BY_TYPE` — a model that mislabelled it would turn the wardrobe into a
place to hang a sconce, and nothing on screen would say so.

### The rules are applied in code, and that is a repair

The five house rules were in the prompt, stated to the model, and trusted:

1. **a bed** — a sconce on both sides, as a symmetric pair
2. **a sofa** — nothing. Never a sconce beside a sofa
3. **a bathroom basin** — a sconce on both sides, as a symmetric pair
4. **a TV unit** — an LED strip, and only a strip. Never a sconce
5. **a wardrobe in a bedroom** — an LED strip

To stop the model inventing work around them, the prompt also said *"where none
of the rules applies, recommend NOTHING"* and *"an empty list is a valid and
often correct answer"*. **Those two sentences broke it.** Rooms that had been
producing a scheme started coming back empty.

The suppression was the escape hatch, not the cause. The cause is that the
prompt asked for three jobs in one call — identify the furniture, apply five
rules to it, and lay the fixtures out as boxes — and *identifying a wardrobe on
a line drawing is genuinely hard*. A model unsure whether that rectangle is a
wardrobe cannot half-apply rule 5. It has one bit to give, it was handed a
polite way to give zero, and it took it.

**So the jobs are separated: the model recognises, the code decides.** The
prompt now asks one question — what furniture is in this room and where — which
is the question [the bed detector](#finding-the-bed-for-you) next door already
answers well, phrased the same way and with the same kind of "here is what one
looks like in plan" guidance for each piece. `accentPlace.js` then applies the
five rules to that list, deterministically. A wardrobe found is a strip, always.

Three things fall out of the split beyond it working:

- **The rules are testable with no network.** `tools/test-accents.mjs` asserts
  all five, and asserts the prompt does not contain the sentences that broke it.
- **An empty answer is now diagnosable.** There are exactly two ways to get one
  — it found no furniture, or it found furniture no rule fires on — and the
  panel lists what it found, so the two are one glance apart. Every piece is
  reported whether it produced a fitting or not, so a sofa reads as *"seen, rule
  2 says nothing"* rather than as silence.
- **A bedside sconce is placed from the bed's own geometry** — a fixed step past
  either end of the bed along the wall its head is against. Symmetric by
  construction, where before it was two independent boxes drawn by eye that then
  had to be mirrored back into line.

A model that is unsure is now told to *answer anyway, with a low confidence* —
the number is carried through and shown, and a person can throw it out in one
click. What it must still never do is promote a dining table into a TV unit to
avoid returning nothing. That distinction — *wrong is worse than unsure; unsure
is much better than nothing* — is the one the bed prompt already draws, and
getting it backwards is what this section is about.

### What goes over the wire: one room, the rest of the sheet dimmed

The whole plan is the wrong thing to send: on a four-bedroom sheet the room being
asked about is an eighth of the frame, so a box given as fractions of the whole
image resolves at eight times the error it needs to, and the model's attention is
spread over seven rooms nobody asked about. So `accentMask.js` crops to the room
plus a tenth, pads the short axis toward the long one (a 20 × 4 ft corridor
cropped to its own bounds is a letterbox, and a letterbox starves one axis of
patch tokens), and washes everything outside the room polygon back to 12%.

Cropping for **attention** buys **accuracy** for nothing: a fraction of a cropped
image is worth far fewer feet than a fraction of the sheet.

**Washed, not erased, and that is a measured result rather than a preference.**
Flat white was tried — the argument being that a faint neighbouring wardrobe is
purely a thing to be mistaken for this room's — and it came back *worse*. The
likely why: a room cut out of a white void gives the model nothing to read the
drawing's own conventions from. Wall poché, door swings, the weight of a
furniture line are all calibrated against the rest of the sheet, and a room in
isolation is a handful of rectangles that could be anything at any scale. The
ghost is not context for its own sake — it is what says *this is a floor plan,
drawn like this*.

Two things are drawn on, and each earns its place:

- **the room boundary**, a thin green line, so "the room" is not left to be
  inferred from where the wash happens to stop
- **the ambient lights already laid out**, as small grey circles. Without them
  the model puts a fitting where a downlight already hangs, and there is nothing
  in the picture to tell it not to.

Nothing else. `gridPixels` lost because an overlay dense enough to be precise
buries the line work under it; dimming what was not asked about adds no ink at
all.

The panel shows the sent image, and that is not decoration: a crop that landed on
the wrong room, or a mask that dimmed the wrong side, produces a confident answer
about somewhere else, and there is nothing in a list of zones that could tell you
so.

> **Renders are gone.** The first version took a couple of photographic renders
> of the room alongside the plan and asked the model which wall each one faced.
> It read *worse* than the plan alone — the correspondence was the weak link, and
> a recommendation pinned to the wrong wall is worse than one never made. The
> plan-only arm was built as the honest baseline to compare against, and it won.

### Symmetry is enforced after placement

Two sconces either side of a bed are two independent boxes drawn by eye, so they
snap to two slightly different points along the wall. **Four inches out of line
is the most visible failure this feature can produce** — nobody checks whether a
strip is the right length; everybody sees a crooked pair. So a `group` of two on
the **same wall** is mirrored about its own midpoint afterwards.

Only on the same wall. Two sconces the model grouped across different walls are
not a mirror pair whatever it called them, and averaging them would put both
somewhere neither belongs.

### Everything the model proposes is editable

A fitting is a starting point, not a verdict. The furniture reading and the
rules are both going to be wrong sometimes in ways only the person looking at
the drawing can see — the wardrobe runs behind a beam, the bedside table is not
where the plan says — so every fitting can be moved by hand.

- a **sconce** slides along its wall
- a **strip's two ends** slide along its run, independently

**Both gestures are one-dimensional, and that is the design.** A sconce mounts
on a wall and a strip runs along one; neither can leave its wall without
becoming a different thing. So a drag projects onto the wall's own line: the
fitting cannot be pulled into the middle of the room, cannot go crooked, and
cannot come off the surface it is fixed to. You get exactly the freedom the real
fitting has and no more. A strip's ends cannot cross either — dragging one
through the other pins it a hair short, because a run of negative length is not
a thing and one that silently flips direction is worse.

> **Two bugs worth writing down**, because both are the same mistake in
> different clothes and SVG invites it. The grab area for a sconce was placed at
> `a.point` — on the wall — while the symbol it was meant to catch is drawn
> STANDING OFF the wall into the room, so you had to click a wall line to select
> a fitting you could see three feet away. And it was drawn BEFORE the symbol:
> SVG paints in document order and hit-tests the topmost thing under the
> pointer, so the symbol's own white ground covered it, the click landed on a
> shape with no handler, bubbled up to the canvas, and *deselected* instead of
> selecting.
>
> So the symbol's geometry is worked out once, above both, and the grab areas
> are drawn LAST with the symbols marked `pointer-events: none`. A control has
> to be the topmost thing where it looks like it is, and neither of those is
> automatic.

A hand-moved sconce is marked `edited` and drops out of its mirrored pair: it is
where somebody put it, and the mirroring pass should not claim credit for a
position it did not choose.

A **refused** fitting stays uneditable. It has a wall — that is how it worked
out it was too far from one — but no position, and letting a drag give it one
would resurrect a fitting the placement pass declined to make, with none of the
checks that would have applied.

> The gesture maths is easiest to get wrong in one specific way, so
> `tools/test-accent-edit.mjs` checks invariants rather than coordinates: a
> wall's own frame runs whichever way the polygon happened to wind, so "further
> along the wall" can be a *smaller* y. Stayed on the wall, never inverted,
> other end untouched — those hold regardless of winding.

### No text on the drawing

The fittings carry no labels. A red line is a strip and a crosshair on a wall is
a sconce, and a drawing that has to caption its own symbols has the wrong
symbols. What a fitting is, why it is there, how long it runs and whether it was
moved by hand are all in the panel, where there is room to say it properly.

### Rejections are sentences

A box that cannot be placed comes back with a reason and is drawn faint on the
canvas rather than dropped: *"That box is out in the middle of the floor — a
sconce has to be on a wall."* Snapping it to whichever wall happened to be
nearest would produce a confident fitting nobody asked for.

The box stays visible behind the fitting, faint and dashed. When the two disagree
— a run half the length of the wardrobe, a sconce on the wrong wall — **that
disagreement is the bug**, and it is invisible if only one of the two is drawn.

### The eval this hands you, and it isn't IoU

A box only has to get **one** thing right — which wall, or which object — so:

- **rejection rate** — fully automatic, no ground truth at all
- **run length vs the real furniture** — one measurement per strip, and it is the
  number that says whether boxing the object worked
- **rule agreement** — did it fire the rule you would have, on the furniture you
  would have called it? Categorical, seconds to label

Choosing a representation with slack in it is what made the measurement cheap.

### Reading the run

`OPENAI_API_KEY`, and optionally `OPENAI_VISION_MODEL`. No new keys.

```
[accents 4b1c] -> 41KB — room 840x840, room="Master Bedroom", gpt-5.5
[accents 4b1c] <- openai 200 in 9840ms
[accents 4b1c] == 3 zone(s): sconce, sconce, strip
```

The browser console carries the crop as a `data:` URL you can open in a tab, the
placed runs and points in plan pixels, and — when a run comes back empty — the
model's own words, which is invisible in the parsed payload.

## Known limits (v1)

- The chunking strategies are a fixed list of six, not a search over every
  possible rectangular partition. A room can in principle be cut a way none of
  them proposes; `chunkPlan` is the way in for such a decomposition, but there is
  no UI for drawing one by hand.
- **Minimum-piece partitions are not guaranteed.** The slab sweeps plus a merge
  pass get there for most shapes, but a room with several interlocking notches
  can admit a partition with fewer rectangles than any strategy finds.
- The whole plan is lit at once and exports as one drawing in true positions,
  but **there is no accumulating project**: one plan at a time, and reloading
  starts over.
- Walls are assumed rectilinear. Diagonals become staircases. A curved wall
  comes in from a DXF correctly and then gets stepped, so a bay window becomes
  a staircase of small treads — right for the grid, ugly on the drawing.
- Beams, diffusers and sprinklers aren't read from the plan automatically; only
  the fan is. Place them by hand as ceiling objects, or mark them as no-light
  zones.
- **Clearance is uniform on every face.** `fanClearance` is one number, so the
  ends of a long object keep the same distance as its sides. That is usually
  right and occasionally not — a linear diffuser wants more at the ends than
  along its length — and there is nowhere to say so.
- **Snapping has two sources**, room centres and other objects' centres. Edges,
  thirds and equal spacing are each one entry in `collectTargets` and are not
  built.
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
- **Cell area** / **Area tolerance** (50 sqft ±25%) are what keep cells sane;
  **Prefer bigger cells** (1.0) is how hard the grid reaches for the top of the
  band, and **Keep it square** (0.8) prices the aspect ratio. **Fan on a line**
  (2.5) and **...on a corner** (2.5) are what a single fan's exact anchoring is
  worth — deliberately above the whole spread of the first two, so the fan is
  settled before the size. **Fan pull** (0.6) is the older soft attraction that
  still governs chunks with several fans; raising it much above 1 lets it
  distort cell sizes noticeably.
- Raising the cell area lowers the light count roughly in proportion — 36 to 50
  sqft drops it about 28%. That is the point, but it is a visible change to a
  drawing, not just a grid setting.
- A room can be too small for its own target area. A 12 × 12 room at 50 sqft has
  no near-square division inside the band (2 × 2 gives 36, a foot and a half
  short), so it falls back to 6 × 6 cells on the soft penalty. That is the right
  answer, but it means small rooms quietly ignore the area setting.
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
  Use Measure if you need it tighter. A DXF has no such error.

### Known limits of the accent zones

- **Two fixtures only** — a sconce and a strip. Coves, picture lights, ceiling
  spots, wall washers and uplights are refused by the parser and reported as
  dropped. They were in the vocabulary and came out: a fixture is only worth
  offering once there is a placement rule behind it.
- **The model cannot draw.** Everything it knows about the strip's position has
  to arrive as a box round an object, because the vision API returns text. A
  strip along a plain wall with no furniture on it is therefore not askable —
  there is nothing to take the extent from.
- **A strip runs along one wall**, chosen to be parallel to the object's long
  side rather than simply the nearest — see `wallForRun`, and the corner case it
  exists for. An L-shaped run round a corner unit still comes back as the longer
  leg only.
- **A near-square object has no long side**, so the wall for its run is decided
  by distance, and in a corner that is a coin toss.
- **The strip sits on the object's face nearest the wall** — concealed behind the
  TV unit, under the wardrobe. Whether that is the right face for a given detail
  is neither asked nor offered.
- **The furniture identification is the whole ballgame now**, and nothing
  corroborates it. The bed detector's answer is sitting right there, on the same
  plan, and is not cross-referenced — that is the obvious next check and it is
  not built.
- **"a wardrobe in a bedroom" is applied as "a wardrobe".** The room type is not
  tested, so a wardrobe read in a dressing room or a hallway still takes a strip.
- **A rule fires once per piece.** Two beds in one room give four sconces with
  no check on whether that is one bedroom or two.
- **`washAlpha` is a dial nobody has swept.** 0.88 beat 1.0 on the plans it was
  tried on and that is the entire evidence base. The failure it guards against —
  a fixture recommended onto the neighbouring room's furniture, which shows up as
  a box outside the green boundary — is the one to watch for.
- **Ceiling height is one figure for the whole plan**, and nothing consumes it
  today except the prompt.
- The zones are **not exported** — not in the DXF, CSV or JSON, which still carry
  the ambient layout only. A fitting you have moved by hand is therefore lost on
  reload along with the rest.
- **A hand-edited fitting is overwritten by the next run.** Asking again for a
  room replaces its whole list; there is no merge that keeps what you moved.
- Capped at 8 zones in the parser. The model is told to be restrained and is
  otherwise ungoverned.
- **A task surface gets exactly one spot.** A long conference table wants two or
  three along its length; nothing says so.
- **Every surface in a room is placed against ONE chunk's grid** — the chunk
  holding the first surface's centre. Right for the common case, wrong for a room
  cut into several chunks with surfaces in more than one of them.
- **Only a chandelier vetoes a spot.** A pendant is not a ceiling-object type, so
  a dining table under one still gets a spot beside it.
- **The spot is not editable and not exported.** It is derived on every render,
  so there is nowhere to put a hand-moved position yet, and the DXF, CSV and
  JSON still carry the ambient layout only.
- **The secondary grid has no intersection nodes.** A segment runs light to
  light or light to chunk edge; where a perpendicular grid line crosses it in
  between is not treated as a stop, so a spot can land on a crossing rather than
  in a clear span.
- **Task surfaces are otherwise found and nothing more.** No edit handles, and a
  re-run replaces the room's list. The qualifier ("only if there
  is a sofa") is asked of the model and not checked against anything — the
  furniture pass is sitting right there and knows where the sofas are, and the
  two do not talk to each other.

### Known limits of the room detector

- **The polygons are approximate and nobody has checked them but you.** The
  dashed stroke says which outlines are still machine-guessed and the grips are
  there because the answer needs correcting, not because correcting it is
  optional. A plan lit off four proposals nobody looked at is the same failure the
  green marker used to produce — plausible and wrong, with nothing on screen
  saying so.
- **An RLE-only response arrives as bounding rectangles.** `rectFromRle` reduces
  a run-length mask to its bounds rather than tracing its contour, so an L-shaped
  room comes in as the rectangle round it and needs a corner dragged. Tracing the
  contour is the upgrade; it needs a real RLE response to test against.
- **A base64 RLE `counts` string is refused rather than misread.** Only an array
  of run lengths is decoded.
- **A room wholly inside another is not subtracted**, because the result would be
  an annulus. It is held out of the outer room's ceiling as a no-light zone
  instead, which means the outer room's *area* still counts the inner room's
  floor — so the lumens-per-square-foot figure for that room reads low. Drag a
  corner of the inner room out to a wall and it subtracts properly.
- **A diagonal edge on a room that gets carved becomes a staircase**, as coarse
  as the coordinate spacing of the pair being subtracted. Rooms that do not
  overlap keep their exact geometry.
- **The enclosure test needs two enclosed rooms to fire.** A plan the model
  reduces to the sheet plus one room keeps the sheet, and it arrives as one
  enormous outline. Delete it.
- **Confidence is not filtered hard**, on purpose: a room the model was unsure
  about is still a better starting point than a blank plan. The consequence is
  the occasional confident-looking outline over something that is not a room.
- **A photographed plan inherits its own distortions.** The detector reads what
  the camera saw; a keystoned or creased plan produces a keystoned room, and the
  grips are how it gets straightened.
- **No cache.** Reloading, or `Look again`, is another inference and another
  charge. The workflow bills by processing time.

### Known limits of tracing

- **The outline is only as good as the trace.** Snapping makes the accuracy the
  drawing's rather than your mouse's, but a corner clicked a dozen screen pixels
  out at low zoom can still catch the wrong thing. The glyph and the HUD say
  what was caught; zoom in and the snap radius shrinks in real terms.
- **On an image there is nothing to catch but your own corners.** Right angles,
  alignments and the grid make a trace self-consistent — they cannot make it
  agree with the walls underneath. Zoom in on the first corner of each wall; the
  rest of that wall follows from the lock.
- **The scale on an image is one measurement, and everything inherits it.** A
  reference misidentified by 20% makes every room 20% wrong while looking
  perfectly fine on screen. The overall plan dimension in the scale panel is
  there to be read.
- **A room the detector missed is still a manual trace.** The proposals cover
  what the model saw; anything it did not see is as much work as it ever was.
- Konva adds about 288 KB to the bundle (284 → 572 KB raw). Worth it for the
  tracer, and it is why `PlanCanvas` was **not** ported: that canvas is the SVG
  and PNG export path, and Konva exports raster only.
- Double-click deliberately does **not** close an outline. Konva decides a
  double-click purely on the time between two clicks and ignores where they
  landed, so clicking two corners in quick succession — which is how anyone
  traces — registered as one and finished the outline two corners in.
- The snap radius is 11 screen pixels. At 60% zoom on a 30 ft plan that is
  around 8 inches of real space, which is why the handicaps and loose-end
  demotion matter more than the radius does.

The following apply to the geometric reader (`findRooms`), which the outline
registry still exposes:

- **Doorway bridging is a heuristic, and it is the load-bearing one.** It pairs
  dangling wall ends across a gap; it cannot know that a 7 ft break is a wide
  door rather than an open plan. The **Widest opening** slider is the control,
  and the bridged gaps can be drawn on the plan to check them. An arch, a bay
  or a splayed reveal wider than 35° off straight will not bridge.
- **A room open to another on two sides is one room.** Bridging closes gaps in
  a wall line; it does not invent a wall where the drawing has none. A
  living/dining with no divider at all is correctly a single space, which may
  not be how you want it lit.
- **Only wall geometry is read.** Doors and windows are used as hints at most;
  their frames, sills and reveals are not modelled, so a window recess does not
  change the room outline.
- Binary DXF is refused rather than guessed at. DWG is not read at all — export
  DXF from AutoCAD, or Revit/ArchiCAD via DXF.
- Xrefs are not resolved: geometry that lives in a referenced drawing rather
  than this one is simply absent. Bind the xrefs before exporting.
- Paper space is ignored, model space only. A drawing whose plan lives in a
  layout viewport comes in empty.
- Hatching on a wall layer will be read as walls and will fill the drawing with
  slivers. Untick it — the diagnostics count is the tell.
- Everything is flattened to 2D. A DXF of more than one floor stacked in Z comes
  in as both floors on top of each other; there is no floor picker.
- The arrangement is O(n²) over segments sharing a grid cell, capped at 40,000
  segments. A site plan or a fully furnished drawing will hit that and say so;
  narrowing the wall layers is the fix.

## Test scripts

`tools/` needs `npm i -D playwright` to run the image-generating and
end-to-end scripts:

```bash
node tools/test-planner.mjs           # layout invariants on synthetic rooms
node tools/test-chunking.mjs          # every chunking is an exact cover, 16 shapes
node tools/test-rooms.mjs             # room extraction from wall segments
node tools/test-dxf.mjs               # DXF text -> rooms, units, blocks, bulges
node tools/test-snap.mjs              # the snap engine, incl. the wall-overrun case
node tools/test-outline.mjs           # traced outlines: rectifying, validation
node tools/test-vector-flow.mjs       # the whole vector route as App.jsx runs it
node tools/test-furniture.mjs         # detection -> zones: centres, rescaling, refusals
node tools/test-detect-api.mjs        # the proxy, network stubbed: refusals, key never leaks
node tools/test-detect-flow.mjs       # response -> zone -> NO LIGHT OVER THE BED, as App.jsx wires it
node tools/test-openai-detect.mjs     # the GPT route: every reply shape, and the same bed claim
node tools/test-room-booleans.mjs     # no two rooms overlap: nesting, carving, and 27 lattice arrangements
node tools/test-rooms-detect.mjs      # room masks -> outlines -> a lit plan, and the sheet thrown away
                                      # test-furniture also covers the DXF render for detection
node tools/test-match-bruteforce.mjs  # matching vs brute force, 400 cases
node tools/make-plans.mjs             # regenerate the image samples
node tools/make-sample-dxf.mjs        # regenerate the DXF sample
node tools/make-bedroom-fixture.mjs   # regenerate the synthetic bedroom plan AND its truth file
node tools/eval-detect.mjs plan.png   # which detector actually finds the bed, and how far off
node tools/probe-rooms.mjs plan.png   # call the ROOM workflow for real; writes the overlay SVG
node tools/e2e.mjs hall lshape        # drive the built app headless
```

The first thirteen are in `npm run test`. `tools/probe-rooms.mjs` needs the
network and a key, so it is a script you run rather than a test that runs
itself. `tools/test-match-bruteforce.mjs`,
`make-plans.mjs` and `e2e.mjs` need `npm i -D playwright`;
`make-bedroom-fixture.mjs` and `eval-detect.mjs` need nothing at all, which is
the point of `tools/pnglite.mjs`.

`tools/fixtures.mjs` builds plans the way CAD actually does — a wall is a
**pair** of parallel lines running its full length, crossing at junctions, with
a gap punched through both lines at every doorway — so the tests meet the same
mess the parser will. `tools/dxfwrite.mjs` writes real ASCII DXF, so the tests
feed the real parser a real file rather than a hand-made object.

`test-vector-flow.mjs` is the one that matters most: it runs App.jsx's exact
sequence with React taken out, because the unit tests prove each stage and the
handoffs are where a Y-flip, a scale factor or a winding order goes wrong in a
way that still looks plausible three stages later. It asserts, among other
things, that the same plan in five different units gives identical rooms, that
a room survives the round trip into pixel space and back to within a quarter
inch, and that an exported DXF reads back through our own parser as the same
room it went out as.

`public/samples/` has five image test plans — they still carry the old green
loops, which are now simply ignored, and one of them (`nofan.png`) has no fan
marker, so it is the one to check the "set the scale first" gate with. Plus
`sample-2bhk.dxf` — a synthetic flat with door swings, dimension lines and
furniture on their own layers.
