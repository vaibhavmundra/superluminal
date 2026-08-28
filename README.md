# Super Luminal

Takes a floor plan and produces a lighting layout — the ambient grid, the
accents, the task spots and the schedule that comes with them — which you can
export to DXF, XLSX, CSV, PDF, JSON, SVG or PNG.

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

## The design language

**Black, white, and one blue.** #0070F3 for the accent, an ink scale for
everything else, and one red that appears nowhere except a failure.

The interesting part is what that did to the drawing. There were seven hues on
the canvas — indigo grid, green outline, red fans, amber zones, teal AC units, a
magenta guide — and every one of them was saying a second time what the symbol
already said. A downlight is a circle; a large light is a bigger circle with a
ring; a sconce is a crosshair standing off a wall; a spot has an arrow; a strip
is a run with end caps; a fan is a blade circle. None of that needs a colour to
be read, and spending the palette on it left nothing to say the one thing shape
cannot: **which of these am I touching.**

So the drawing is ink — the plan underneath in grey, our own line work in black,
scaffolding and annotation in between — and the accent belongs to selection,
hover, focus, grips and guides. A blue element on this canvas is always a
statement about state, never about type.

**The layout screen is the second exception, and it is a bigger one.** Every
fitting on a finished plan — downlights, sconces, strips, spots — is now drawn
in #0070F3, and the ceiling objects with it at reduced opacity. The rule this
breaks was written for a screen where the accent had one job. It still holds for
the *plan*: walls, outlines and dimensions are ink. But a lighting layout has a
SUBJECT, and it is the lights. Drawing them in the same black as somebody else's
line work meant forty downlights disappearing into the furniture — the one thing
on the sheet the reader came for, rendered as if it were part of the ground. So
on this canvas blue means "ours, and it emits light", and the drawing underneath
is grey. Selection and guides are still blue too; they are told apart by
behaviour, because a grip is something you grab and a fitting is something you
read.

**And they are lit rather than merely drawn.** Under every fitting is a radial
gradient in the accent, wider than the symbol, breathing on a 2.8-second cycle
with a per-fitting phase offset. Strips are dotted runs whose glow swells and
fades on the same cycle — one idiom for "this is on" across every fitting. Both are the symbol saying what kind
of thing it is rather than decoration on top of it: a downlight throws a pool of
light and the pool is what the room actually gets; a strip is a line of emitters
on a tape, and a solid line drew it as a wire. The offset is load-bearing — forty
discs pulsing on the same beat read as one flashing element, and forty on their
own beats read as forty lamps.

*The strip took four attempts, and the three failures are the instructive half.*
All three tried to make something TRAVEL along the run, on the reasoning that a
strip is a line of emitters with current passing through it — which is true, and
turned out not to be the point.

**One:** walk the dots themselves, one dash cycle per iteration. Seven pixels
over two seconds. It moved and could not be seen — and it was wrong anyway,
because the dots ARE the emitters and emitters do not slide along their own tape.

**Two:** hold the dots still and slide a band of lighter blue underneath. The
first cut was wrong by a hair's breadth exactly: a band at 3.8× the sheet's line
weight under dots at 2.4× leaves 0.7× showing on each side, well under a pixel.
Measured across two frames the run moved by a mean of one greyscale level and no
column of pixels changed by more than twelve — the same failure as attempt one
in a different disguise. Widening it to 7× made it visible and made it wrong in
a new way: seven line weights of pale blue under a two-weight run reads as the
tape SWELLING, not as anything travelling through it.

**Three:** one dot's worth of white at the run's own stroke weight, shooting end
to end in 900ms. Legible, honest about the physics, and *still* wrong on the
drawing — because a white mark racing down a line is an ANIMATION, and
everything else on this sheet is a fitting quietly breathing. It made the strips
the loudest thing in the room and they are not the most important thing in it.

**Four, which is the one that stayed:** a strip pulsates the way a spot does.
The glow under it swells and fades on the same cycle, with the same staggered
per-fitting phase, and the dots hold still. The lesson is not about strips. It
is that a drawing wants ONE way of saying "this is on", and a cleverer idiom for
one fitting type costs more than it buys. **A strip breathes by getting FATTER, and opacity alone was not enough.** The
first version of this animated the glow's opacity between 38% and 62% and did
not read as pulsating at all: a blurred band at 38% and the same band at 62%
look like the same band, because the blur has already spent most of the
contrast. What reads is WIDTH. `stroke-width` grows a line perpendicular to its
own axis, so the band swells and stays exactly as long — which is the strip's
equivalent of a halo scaling, and the reason the run's own caps are `butt` and
not `round`: a round cap adds half the stroke width at each end, so a breathing
run would creep past its end markers twice a cycle. `STRIP_STYLE.glowSwell`
sets how far it swells.

> **The moving white notch, which was not our animation.** With the width
> animating, a small white gap appeared in the dotted run and TRAVELLED along
> it — indistinguishable from the spark that had just been deleted, and only
> visible while the glow was breathing, which made it look like the new
> animation misbehaving. It was the filter. A filter region given in percentages
> is relative to the filtered element's own bounding box, and a horizontal or
> vertical line has a bounding box with zero height or zero width: `height="900%"`
> of zero is zero, the region collapses, and the renderer improvises a tile seam
> that shifts as the stroke width changes. `filterUnits="userSpaceOnUse"` with
> the plan's own extent cannot collapse. Worth remembering for any filter ever
> applied to a straight line.

**And every dimension of a strip is now a dial.** `STRIP_STYLE` in
`settings.js` holds the run's stroke weight, the dash and gap, the spark's
length and speed, the glow's width, blur and opacity, and the end-cap size.
Every one is a MULTIPLE OF THE SHEET'S LINE WEIGHT rather than a pixel count,
which is what makes them safe to hand over: the line weight is
`max(width, height) / 1500`, so `stroke: 2.4` looks the same on a 900px sketch
and a 6000px survey, where a tuned pixel value would be right on one and wrong
on the next. The glow's breathing keyframes read `glowOpacity` through a custom
property rather than hard-coding a value, so the dial stays in charge of its own
setting.

**The end caps became small squares, and the grips come out on hover.** The caps
were perpendicular ticks at grip size, which is exactly what a grip looks like,
so people tried to drag them. A small filled square says "the run stops here"
and nothing about being draggable. The real handles — bigger, white-filled,
accent-stroked — now appear when the pointer is on the run rather than only
after a click, because a run you can drag whose handles are invisible until you
have already clicked it is a run that looks fixed.

**The accent detector's own regions came off the drawing too.** They were the
box the model marked — the wardrobe, the TV unit — drawn dashed behind the
fitting so that what the model said and what the geometry did with it were both
visible. Debugging, and the right view while the placer was being written: a run
half the length of the wardrobe is a bug you can only catch by looking at both.
On a sheet somebody is handed it is a dashed rectangle round a piece of
furniture, in the lights' own colour, beside the strip it produced — three marks
where the drawing needs one. Only the lights show.

*A blur was the literal reading and the wrong tool three times over*: the radius
is in user units so a small and a large downlight need different filters, filters
re-rasterise on every animation frame and there are forty of these, and a blurred
disc still has a solid core with a soft rim — a smudge, not light. A gradient
falls off the whole way out, costs one compositor pass, and survives being
exported because it is geometry. The animations are CSS on `transform`, `opacity`
and `stroke-dashoffset` only, so the SVG and PNG exports are stills: the class
names ride along and mean nothing without the stylesheet.

**The working came off the sheet at the same time.** The ambient grid, the
task-surface boxes and the secondary grid were all reasoning — how a layout was
arrived at, drawn over the layout. That is exactly right while the chunker and
the surface detector are being built and exactly wrong on a drawing somebody
hands to a client: a dashed box round a dining table saying "we noticed the
dining table", three feet from the spot that already points at it. The spot IS
the visible consequence of the surface. The bed's no-light zones went the same
way and for a sharper reason — they are the visible half of a pipeline that runs
two detectors and a judge before anyone sees the plan, and drawing them asks
somebody to audit a decision they did not know was being made. `drawnZones` is
now deliberately a different set from the zones the planner obeys: the beds still
move the fittings, they just stop arguing about it.

**What a fitting is, under the cursor.** Hovering any fitting thickens its stroke
and raises a frosted card — `backdrop-filter`, which is why it is an HTML element
positioned in viewport coordinates rather than anything inside the `<svg>` — with
the watts, beam angle and lumens on it. Those numbers come from `specsFor()` in
`boq.js`, the same catalogue the schedule bills from, because a tooltip that says
9 W over a fitting the BOQ prices at 7 is worse than no tooltip. Hovering a strip
also stops its flow, which is the small courtesy of holding still while being
read.

> **The bug that cost an afternoon, and the rule that caused it.** Everything
> inside `.plan` is `pointer-events: none` by deliberate rule — three separate
> bugs where one layer swallowed another's controls earned it, and the fix was
> to make the whole drawing inert and have genuine controls opt back in with
> `.hit`. So the hover handlers silently never fired. Worse: putting `.hit` on
> the fitting's *group* does not work either, because `.plan circle` sets
> `pointer-events` on each shape directly and a direct rule beats an inherited
> one. The class has to go on the shape the pointer is meant to find. The glow
> keeps its inline `none`, since it is 2.6× the fitting's radius and a live one
> would have each downlight eating its neighbours' clicks.

**The one exception is the space fills, and it was earned the hard way.** They
went to eight values of one grey with everything else, on the argument that a
value ramp separates adjacent spaces as well as a rainbow without competing with
the line work. It does not. Every other colour that went had a symbol standing
behind it — a downlight is still a circle in ink — and these have none: a space
is a translucent polygon, and its fill is the *only* thing that distinguishes it
from the polygon sharing its wall. At the 0.1 opacity these are drawn at, two
greys four steps apart are separated by almost nothing, and eight of them read as
eight shades of the drawing rather than eight things on top of it. So the eight
hues are back, and the swatch beside each name in the panel is its polygon's own
hue, which is the entire link between the list and the plan. The rule the rest of
the palette follows still holds: colour is spent where shape cannot speak.

**One red, and only for failure.** Vercel keeps a red for the same reason: "this
did not work" has to survive being glanced at. It was also the fix for a real
problem — twenty-odd `.note.warn`s were all rendering in red, most of them
guidance rather than alarms ("set the scale first", "no doors found, measure
instead"), which spent the loud colour on sentences that are not loud and made
the two genuine failures invisible among them. `.note.warn` is now quiet ink with
a rule down the left; `.note.err` is the red one.

> **One colour deliberately did not change.** `BOX_COLOUR` in `bedFit.js` is
> still red, because it is never shown to a person — it is the ink drawn on the
> two crops sent to the bed judge, and the only property that matters is that
> both images use the same one. Restyling it would be a change to a model input
> with none of the reasons a restyle usually has.

### Type

**Neue Montreal throughout: four static woff2 cuts — 400, 500, 600, 700 — in
`src/fonts`.** 260KB for all five faces including Lunar, converted from the
supplied TrueType (235KB each down to 59KB).

> **They started in `public/fonts`, referenced as `url('/fonts/...')`, and they
> did not load at all.** The cause is one line in `vite.config.js`: `base: './'`.
> With a relative base, Vite rewrites an absolute `/fonts/...` in a stylesheet
> into `../fonts/...`, which then resolves against wherever the stylesheet
> happens to be — and in dev the CSS is injected as a `<style>` element, so
> "wherever the stylesheet is" is the document rather than `/assets/`. The URL
> came out somewhere with no font on it, silently, and the app fell back to the
> next family in the stack and looked thin.
>
> **Files under `src/` are the bundler's problem, and that is the fix.** A
> relative `url('./fonts/...')` from a file inside `src/` gets resolved, hashed
> and emitted by Vite, which writes whatever URL is correct for the base, the dev
> server and the build. There is nothing left for a base setting to get wrong,
> and the `<link rel=preload>` went too — it named a hand-written path, which is
> the exact thing that broke, and the real URLs are hashed and not knowable in
> `index.html`.
>
> The old declaration had two further defects worth writing down. It said
> `format('woff2-variations')`, which is not a standard format token. And it
> declared `font-weight: 100 900` for a face whose `wght` axis actually runs
> **200 to 800** — with a **default instance of 200**. So any browser that loaded
> the file but did not apply the variation rendered the entire app in Thin: a
> failure with no visible cause, and not worth the 100KB the variable file saves.
> Four static cuts cannot do that, because each one is the weight it says it is.
>
> Verified in a real browser three ways: all four weights measure differently
> from each other and from the fallback; the dev server returns `200 font/woff2`
> for each face; and it behaves identically served from the root and from a deep
> subpath, which is the case the old URL could not survive.

**`public/fonts` still holds the original TTFs and the variable file, and nothing
references them any more** — so they are about 1.5MB of dead weight in every
build. Moving them out of `public/` (anywhere else in the repo is fine) slims the
deploy without losing the originals.

**Weight is stated once, in `:root`, and it used to be stated nowhere.** `body`
set the family, the size, the line-height and the tracking — and no weight — so
every unstyled string in the app was the browser's default 400. Neue Montreal's
Regular at 13px is a light-looking Regular, and the app read as thin because of
it. Four tokens now:

| | | |
|---|---|---|
| `--w-body` | 500 | the default. Medium, not Regular. |
| `--w-strong` | 600 | emphasis inside a sentence, and a value |
| `--w-head` | 550 | small caps and column heads: small, letterspaced, grey |
| `--w-display` | 500 | headings, where the size is doing the work |

The rule choosing between them is optical, and it runs **opposite to the type
size**: small text needs more weight, not less. A 10px letterspaced grey section
head is the thinnest thing on any screen here and needs 550 to hold up; a 20px
heading has all the presence it needs at 500 and looks clumsy heavier.

> **`-webkit-font-smoothing: antialiased` was doing real damage**, and it is
> gone. On macOS that switch turns off subpixel rendering and the result is
> visibly *lighter* strokes — call it a third of a weight step. Stacked on an
> unstated 400 it is most of why the app looked thin. The default renderer is
> heavier and sharper, which is what this face wants at UI sizes. The two
> secondary greys came up at the same time (#666 → #525252, #8F8F8F → #7A7A7A):
> small grey text reads as thin whatever its weight.

**And no monospace.** There was one for the numeric columns, and it was buying
alignment the app face already provides: Neue Montreal's `tnum` figures are
real, which was measured rather than assumed (`1111` and `0000` come out the same
width under `tabular-nums`). Its *proportional* figures are very uneven by
comparison — a `1` is half the width of a `0` — so tabular figures are not a
nicety anywhere a column of numbers is read downward, and the rule that turns
them on is stated once in `styles.css` rather than per component.

**Lunar, for the wordmark only.** It is a display face with one job.

### The mark

The favicon is a lit aperture — a bright disc in a dark field, with the glow in
the gap between them — and the mark in the top bar is that, **drawn in CSS**
rather than loaded. Two radial stops do the falloff, which is smaller than the
PNG, sharp at any pixel density, and inverts cleanly if this ever gets a dark
mode. `public/superluminal_logo.png` is still there for anywhere the app is not
what is doing the rendering.

**Neither typeface comes off a CDN.** The cuts the app loads are in `src/fonts`,
so the bundler owns their URLs and the app no longer waits on a third-party stylesheet before it can draw a word, and it works
with no network at all — which matters for a tool somebody runs against drawings
on a site-office laptop.

### Words

**A traced region is a SPACE, not a room.** The app is pointed at flats, offices,
hotels and restaurants, and in three of those four the thing being lit is
routinely not a room: a workspace, a lobby, a dining area, the open half of a
living-dining. Calling all of them rooms made the interface argue with the
drawing — "Light all 4 rooms" over a plan whose four regions include a corridor
and a balcony is a sentence that is wrong twice. So every string the user reads
says space: `Space 1`, **Spaces on the plan**, **Light all N spaces**, the BOQ's
space breakdown, the CSV's first column.

**The code still says `room`, and that is deliberate.** `roomTypes`,
`roomsDetect.js`, `task: 'rooms'`, the `room` key in every model request — the
identifiers, the API contract and the prompts are untouched, because the models
are being asked a question in the vocabulary they were trained on and a rename
there is a behaviour change dressed as a tidy-up. The split is one-way and easy
to hold: **`room` is what the code and the models call it, `space` is what the
person reads.** The one place they meet is the space-TYPE list, where the names
are proper nouns and stay as they are — Bedroom, Pooja room, Conference room,
Server room, Guest room.

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
at them. You drag what is wrong and press **Light all N spaces**.

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
ROBOFLOW_DOORS_WORKFLOW_URL=https://serverless.roboflow.com/<workspace>/workflows/<id>
```

**It is one endpoint and three questions.** `/api/detect` already held the key for
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

The bed detector takes a second opinion because a bed's box only has to be
roughly right to be a useful obstacle, so two readings can be compared and one
chosen. A room outline that is roughly right puts every light in the wrong
place. Asking a general vision model for a boundary is asking
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
to lay a grid of lights against — so on an image the scale panel is on the tracer
screen and the plan does not take corners until it is set. Two ways: click one of
the **detected doors** and say how wide it is, or **measure** something you can
name. See [the scale comes off a door](#the-scale-comes-off-a-door).

By the time the tracer opens the doors are already found and drawn on the plan,
filled in the primary colour — the search happened inside the project-type
dialog, in a moment that was going to be spent anyway. Clicking one asks 750 /
900 / 1200mm, and that is the whole interaction.

Measuring happens on the same canvas, with snapping still live — a door leaf
measured jamb to jamb off a real point beats one measured by eye. Either way the
panel then reports the overall size of the plan, which is the cheapest check
there is: if a two-bedroom flat reads as 90 ft across, the reference was wrong.

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

### The panel while the plan is being worked out

The loader over the drawing carries the phase, the space being worked on, and the
checklist that gives them context. The panel used to carry the phase, the space,
a done-of-total count and two buttons — three inches to the right of all of it.

**That is not twice the information.** It is the same information asking to be
reconciled: the eye goes back and forth checking the two agree, instead of
watching the plan light up. So the panel says the one thing the loader does not
— that this is a wait with an end — in a sentence you can read from across a
desk, vertically centred, with the way out under it.

**And one way out rather than two.** `Stop` on its own kept whatever had
finished, which is genuinely useful and genuinely hard to explain in a panel
with nothing else in it: it left you on a half-lit plan with no account of which
half. A wait either finishes or is abandoned. `tools/check-loading.mjs` slows the
model route to four seconds so the state is observable at all, and then mostly
checks ABSENCE — which is the kind of thing that creeps back one line at a time.

### Zooming the layout, and why it is done twice

Both drawing screens zoom on the wheel, anchored on the pointer, and they get
there by completely different routes — which is worth a paragraph, because the
obvious reaction is that one of them should be rewritten to match the other.

**The tracer is a Konva stage and owns its own transform**, so anchoring is
arithmetic: work out where the pointer is in stage space, change the scale, and
put the offset back. Nothing else is involved.

**The layout screen is an ordinary scroll container** — `overflow: auto`, with
the SVG sized by `zoom` — and that is deliberate. It is the screen you pan
around most, and a scroll container already solves clamping, scrollbars, the
keyboard and the "where am I" problem that a hand-rolled translate would have to
solve again. The cost is that zooming has to be done in two halves, because the
element's new size is not known until React has laid it out: on the wheel, record
WHICH PLAN POINT is under the cursor and where the cursor was; in a layout
effect, ask the SVG where that point ended up and scroll by the difference.

**Measuring rather than predicting is the whole trick.** The stage has padding,
the wrapper has padding, and `justify-content: safe center` moves the drawing
around inside the scroll box as it changes size. Any formula that tried to
account for those would be wrong the first time one of them changed. Reading the
element's live rect before and after is exact and knows about none of it — the
anchoring holds the point under the cursor to within a fifth of a pixel.

**One thing it cannot do, and it is the container's nature rather than a bug.**
While the drawing still fits inside the stage the browser centres it, and a
centred box has nowhere to scroll — so a point cannot be held still until there
is overflow to take up. The buttons anchor on the middle of the view rather than
the pointer, for the plain reason that a button has no pointer; stepping the
number alone kept the drawing's top-left corner still, which meant whatever you
were looking at slid off the bottom-right every time you pressed +.

`F` fits, `0` is actual size, `+`/`−` step, and middle-drag pans — the same keys
as the tracer, so the two screens do not have to be learned separately.

### A bed is a known size — and a bed PAIR is too

The size gate in `BED_FT` measures a detection in feet rather than as a fraction
of the sheet, which is the only measurement that means anything: the same bed is
0.2% of an A0 resort drawing and 4% of a one-room plan, so any percentage
threshold is simultaneously too tight for one and too loose for the other.

**Its first version rejected every bed on a hotel plan.** Eleven boxes came back
from the whole-sheet pass and all eleven were dropped, each reported as "that is
a room, not a bed", against a single `maxSide: 8.5`. They were not rooms. Ten of
those rooms have twin beds, and **asked about the whole drawing at once the
detector boxes the PAIR** — both beds and the gap between them, about 5 feet deep
and 10 to 11 feet across. The per-room pass, looking at one crop, separates them
and returns two; which is why the accent pass reported *"bed, bed"* about the
very rooms the zone pass reported nothing about. A gate calibrated on the second
pass's output was being applied to the first's.

**The repair is not a bigger number, it is the right measurement.** The long side
cannot separate a 5 × 10 pair from a 12 × 16 room without rejecting the pair —
but the SHORT side can, because a bed is shallow whether there is one of it or
two. So `maxShortSide` does the room-rejecting, `maxLongSide` allows a pair, and
the aspect ratio still catches planks and corridors. A room fails on its depth
and always will, whatever its width is doing.

### One box per bed, and where the tight boxes come from

The whole-sheet pass cannot give you an exact bed outline, and no prompt will fix
it. It looks at a ~1300px image of a resort floor — about **17 pixels to the
foot** — where a single bed is 45px across and two twins are one grey smudge. Its
box around a pair is not a misunderstanding, it is the honest answer to a
question the image cannot resolve.

**The accent pass asks the same question at four times the resolution.** It sends
ONE room at 700×700, which for a 13ft room is nearer **54 pixels to the foot**, and
on the same drawing and the same model it comes back `bed, bed` — two boxes,
separated, tight. Those boxes were already in plan pixels, and they were only
being used to hang sconces off.

So they are now the geometry too. A room that has been looked at closely **owns
its own beds**: the whole-sheet boxes for that room are dropped rather than merged,
because merging a tight pair with the loose box that swallowed both just puts the
loose one back on the ceiling — and dedupe cannot save you, since a box around
two beds genuinely does overlap each of them. The whole-sheet pass drops back to
what it is good at: saying WHICH rooms have beds.

The prompts changed to match, in the one place they were working against this.
The instruction was a blanket *"err generous rather than tight"*, which is right
for a wardrobe — its extent sets how long the strip runs — and exactly wrong for
a bed, whose extent becomes ceiling that gets no light. It is now split by piece:
generous for the run-defining furniture, **mattress-only for a bed** — no
nightstands, no blanket box, no rug — with *one box per bed, never one around
two* stated explicitly in both prompts.

**Three sources, one winner per space, in a stated order.** The same bed can
arrive from more than one place, and merging them is never right: a loose box
round a pair genuinely overlaps each tight box, so an IoU dedupe cannot separate
them. You get one big rectangle and two small ones stacked on the same mattress
— **39 zones over eight beds**, which is what this looked like before there was
an order. Best evidence first:

1. **`bed-filter`, whole plan** — one call to a segmenter trained on beds. The
   primary path for every bed on every plan.
2. **GPT, one bedroom crop** — the fallback, and the only thing GPT does with
   beds now. It runs on a space the classifier called a bedroom and the whole-plan
   pass left empty, and nowhere else.
**The accent pass is not a third source, and used to be.** Its bed boxes no
longer reach this list at all — not the chunking, not the no-light zones, not the
sconce rule. It is a question about furniture in general, where a bed arrives as
a side effect and its box only ever had to be roughly right, because all it was
used for was picking a wall to hang a sconce on. Letting a box drawn to that
standard compete with a measured one is how a single mattress ended up with a
big rectangle and two small ones stacked on it. The count is still shown in the
audit panel, as **accent pass (excluded)** — an exclusion you can see is a
decision, an exclusion you cannot is a bug.

Matched by `roomId`, which every per-room bed carries, so it is set membership
rather than a point-in-polygon guess. The first version of this did guess by
geometry, and it half-worked — the worst way for a filter to behave, because both
sources survived and nothing said so.

## Beds: one trained model, and a fallback

**`bed-filter` is the bed detector.** One Roboflow workflow, one call, the whole
sheet, no second opinion and no arbiter. On the FLOOR_PLAN_03 sample it returns a
single box whose every edge is **within 5px of the hand-measured mattress** —
6.0 × 6.6 ft at that plan's 40 px/ft — with the nightstands outside it. That is
`tools/test-beds.mjs`, against a verbatim fixture of the real response.

### What it replaced, and why there were three attempts

Every previous arrangement was a way of compensating for a detector that could
not resolve a bed on a whole sheet, and none of them fixed the resolution:

| | why it went |
|---|---|
| `general-segmentation-api-4` asked for `classes=bed` | at ~17 px/ft a mattress is 45px and two twins are one smudge, so its boxes enclosed whole PAIRS |
| Roboflow contested against GPT | Roboflow answered on **one of five** test plans — the one where the bed was 228×252px in frame. A contest with a silent side never reaches the judge |
| two SAMPLES of GPT, contested and judged | better, but it bought confidence in an outline nobody trusted, at 2–3 calls per bedroom |

A model that draws the mattress correctly on the first call makes all of that an
expensive way to agree with itself. **The contest machinery is commented out, not
deleted** — `contestFor`, `applyVerdict`, `computeBedFit`, `bedSets` and the
superseded whole-plan pass are all intact. The pass sets `bedSets` to `null`,
and every contested path is gated on it being non-null, so switching back on is
one edit.

### The one fallback, and its trigger

**A space classified as a bedroom with no bed in it** is a contradiction between
two answers already in hand, and it is the only thing that spends a GPT call.
That room's crop — the one the classifier already built, so no extra render —
goes to GPT at 700×700, which for a 13ft room is nearer **54 px/ft** against the
whole sheet's 17. One call. No contest, no judge.

A bedroom that has its bed does not come here. A space that is not a bedroom does
not come here whatever the pass found. There is no plan-size branch: a threshold
that skipped the whole-sheet pass on large plans made every bedroom empty, which
made every bedroom get the expensive treatment, on a sheet where the cheap pass
had not been allowed to try.

> ### The class is `bed2`
>
> Not `bed`. It is the training project's second class, and nothing about the
> workflow's name or purpose predicts it.
>
> `detectionsToZones` drops any prediction whose class is not in the wanted set.
> On a general workflow that filter is what stops a sofa becoming a no-light
> zone. On a workflow that answers exactly one question it is **a way to discard
> the entire answer and report a plan with no beds on it** — and "the model found
> nothing" and "we threw away everything the model found" look identical from
> outside the function.
>
> So `detectBeds` passes `classes: []`, which disables the filter, and relabels
> what comes back to `bed`. Everything that endpoint returns is a bed by
> construction. The real payload is pinned as a fixture and a test asserts that
> the old filter would have returned nothing from it, because this is exactly the
> kind of thing that comes back silently.

**The size gate did not go anywhere.** `plausibleBed` runs on the whole-plan
answer and again in `detectedZones`. A better detector is not a reason to stop
measuring what it returned — that gate is what caught the twin-pair boxes, it
re-runs when the scale is corrected, and it costs nothing when the boxes are
right.

### The server log is bed-only

`api/detect.js` and `api/accents.js` carry a `BED_LOG_ONLY` flag, on by default.
Everything still runs; only bed work speaks. `task === 'beds'` is bed work by
definition, so the new route is loud without needing a class check.

The gate is keyed on the **request id**, not a module-level boolean, and that is
not fussiness: door, room, type and furniture requests overlap and answer out of
order, so a flag flipped by whichever request is in the handler would attribute
one request's lines to another. Each request decides once on the way in and lands
in a Set bounded at 64, because a handler with a dozen return paths has no good
place to remember to forget an id.

Set `BED_LOG_ONLY = false` to get everything back.

> **And the first attempt at the per-room precedence crashed the app.** `bedsPerRoom` read `rooms`,
> which threw *"Cannot access 'rooms' before initialization"* on load. The
> temporal dead zone was only the symptom: `rooms` is the LAID-OUT plan and it
> is computed from `zoneList`, which is computed from these very zones. A bed
> moves the fittings around it, so the layout cannot be an input to the beds
> without the beds being an input to themselves — reordering the declarations
> would have swapped the crash for an infinite loop or a stale render. The
> answer is that the beds never needed the layout, only the polygons: `outlines`
> is plain state and `regionFromOutline` turns one into the same polygon the
> beds pipeline already uses. **If a memo here wants `rooms`, that is the signal
> to check whether it is upstream of the layout.**

> **The thing that made this expensive was the silence.** Eleven detections
> became zero with nothing on screen but `Bed zones 0` — indistinguishable from a
> detector that found nothing, and the two want opposite fixes. The panel now
> reports how many bed boxes were rejected and the commonest reason, so a gate
> that eats a whole plan says so. Any threshold that can reject everything should
> be able to account for itself.

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

### A third model decides which of the two got it right — SUPERSEDED

> **This whole section is dormant.** Beds now come from the `bed-filter`
> workflow in one call, with a single GPT crop as the fallback and no arbiter —
> see **Beds: one trained model, and a fallback** above. Everything below still
> exists in the code and is reachable only by switching the superseded
> whole-plan pass back on. It is kept because the reasoning is the reasoning
> that would apply again the day a second bed opinion is worth buying, and
> because `contestFor`, `applyVerdict` and `computeBedFit` are all still there.


`both` runs the two detectors and merges what they say. That is the right answer
when they agree and quietly the wrong one when they do not, which is the case
that matters.

De-dup collapses two boxes over one bed into one zone at 45% overlap. Two
readings of the same bed that are half a bed apart overlap by less than that, so
**both survive**, and the ceiling gets the union of a good answer and a bad one —
a zone bigger than either detector claimed, most of it floor, with real fittings
moved out of the way of nothing. Averaging them would be worse still: the mean of
a right answer and a wrong one is a third answer that neither detector would
defend.

So `judge` — the default — is the same two calls with the merge **replaced by a
choice**. `src/lib/bedFit.js`.

**Room by room, not sheet by sheet.** The two answers are drawn on two crops of
one room and compared there. A whole-sheet A/B would force one detector to win
every bedroom on the plan, and on a sheet where Roboflow nails one bed and GPT
nails another there is no answer to that question that is right. Per room, each
bed is judged against the other reading *of that bed*, in the same isolated crop
the accent and task passes are shown — same `roomSnapshot()`, same wash, same
boundary.

**The two pictures differ in the rectangles and in nothing else.** Same crop,
same scale, same ink, same line weight, and — deliberately — **the same colour
for both**. Drawing Roboflow in red and GPT in blue is the obvious thing and it
is wrong: the images would then differ in a way that has nothing to do with which
box is on the bed, and a preference for one colour over another is not a
preference worth collecting. The only thing telling them apart is a letter burned
into the top-left corner, and the letter says nothing about who drew what.
`tools/check-overlay.mjs` renders both in a real browser and reads the pixels
back to assert exactly this — that the boxes paint, that the same point on the
other image is untouched, and that everything else is identical.

**No lights on these crops.** Everywhere else the ambient layout is drawn onto
the picture so the model does not recommend a fitting where a downlight already
hangs. Here it would be misleading: this runs *before* the layout, precisely
because its answer moves the layout.

**The judge never emits a coordinate. It picks a letter.** This is the rule the
whole app is built on — the model recognises, the code decides — taken as far as
it goes. A region absorbs the error a point propagates; a *choice between two
regions* absorbs all of it. Whatever comes back, the rectangle that lands on the
plan is one a detector measured. The worst case is that the wrong detector wins.
There is no case where the zone is a rectangle nobody drew.

**Three of the four situations a room can be in are decided without a call:**

| | |
|---|---|
| neither found a bed | nothing to judge |
| only one found a bed | that answer stands — see below |
| both found the same bed | not a disagreement. Same count, every box pairing above `agreeIou` (**95%**) |
| they genuinely differ | **this is the one that costs a call** |

### Why `agreeIou` is 0.95 and not 0.80

It was 0.80, and the reasoning was about cost: two runs tracing the same mattress
land at 0.85–0.95, one that has taken in the bedside tables lands near 0.6, and
0.80 sits in the gap between those two populations. Sound as far as it goes — and
it buys the saving with the thing the box is FOR.

**A bed box becomes ceiling that gets no light.** So a 0.85 match is not a
rounding difference between two nearly-equal answers; at plan scale it is about a
foot of ceiling, at the head of a bed, that one run wants dark and the other
wants lit. That is a decision, and the judge exists to make exactly that decision
with both pictures in front of it. Deciding it by threshold instead — silently,
in favour of whichever run happens to be side A — was saving a call by guessing
at the answer.

At 0.95 only a genuinely identical reading settles itself. Everything else is
asked about. It costs roughly one extra judge call per bedroom, and the `agreed`
line in the log is now a much stronger claim when it appears.

**Anything that reads this threshold must not reuse the dedupe one.** They look
alike and mean opposite things: `agreeIou` asks "are these the same ANSWER, so
that no one need choose", the 0.45 in `absorbBedRows` asks "are these the same
MATTRESS, so that it is not listed twice". A room asked again legitimately
returns a box at 0.5 against one already held — same bed, worth deduping, and
nowhere near agreement.

**An uncontested answer is taken as it stands.** The alternative — send the one
overlay and ask "is this really a bed?" — is a different question with a
different failure mode, and one that a model shown a single confident rectangle
tends to answer yes to. The cost of not asking is that a lone false positive from
either detector becomes a zone; the cost of asking is a call per room plus a
second way to be wrong. The first is the cheaper mistake, and it is the one you
can see on the canvas and drag away.

**Every fallback is defined and deterministic.** A judge that cannot be reached,
that hedges below `minConfidence` (35%), or that answers "they look the same"
does not leave the room without a bed: `applyVerdict` takes `BEDFIT_DEFAULTS.fallback`
— Roboflow, because the case where both committed and neither is clearly better
is the case where Roboflow's is the tighter box, which is that detector's whole
description. Not a coin toss and not list order. The panel says which of these
happened, per room, with the judge's own sentence on hover.

**Beds in a room you have not traced** keep the behaviour they have always had:
both readings merged, overlaps de-duplicated. There was no room to isolate and no
ceiling for them to affect, so there was nothing to judge — and dropping them
would silently remove boxes that are on the canvas today.

**Wiring.** `task: 'bedfit'` on `/api/accents`, which now reads a *list* of
images rather than one — three of its four questions send a single crop, this one
sends two. The size guard counts the whole body, because that is the number
Vercel refuses on. `tools/test-bedfit.mjs` covers the decision table, every
fallback and every reply shape; `tools/test-api-accents.mjs` assembles the real
response for all four tasks with `fetch` stubbed.

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
image](#scale-comes-first-on-an-image). The controls stay in the sidebar
afterwards, so a scale can be corrected without re-tracing: outlines are stored
in image pixels, so correcting the scale corrects every room's size and leaves
every room where it was drawn.

**Two routes, and there used to be four.**

1. **Doors** (default). A door is detected for you; you click one and say how
   wide it is. See below.
2. **Measure.** Click the two ends of something identifiable (door leaf, sofa,
   WC, bed, car bay) and pick what it is from the list. On the tracer screen the
   cursor still snaps while you do it, which is worth having: the accuracy of
   every dimension in the drawing comes off these two clicks.

Gone: **a pixels-per-foot box**, which asked the user for a number nobody knows
about their own drawing — it was a debugging control that had been left in the
product. And **From fan**, which read the scale off red fan markers: it needed
something drawn on the plan before it could work at all, and a door needs
nothing. Fans are still detected and still become ceiling obstacles; they have
simply stopped being a ruler.

### The scale comes off a door

Everything downstream of this number is stated in feet — the 50 sqft cell, the
5 ft wall rule, the fan clearance, every fitting position, every export. It is
the most load-bearing number in the app, and a px/ft that is 30% out does not
produce a visibly broken drawing. It produces a plausible one, for the wrong
building.

**A door is the ruler that is already on the plan.** Its real width is one of
three or four values in the entire built world: 750mm to a bathroom, 900mm to a
room, 1200mm to a hall or a double leaf — and, where the drawing states one,
whatever it says. Nothing else on a floor plan is that
standard — a sofa is anything from 1500 to 2400, a bed is a choice, a wall is 4
inches or 9 or 12. And it asks the user to **recognise** rather than to measure,
which is the real win: anyone looking at a plan can tell a bathroom door from a
room door, and nobody can hold a two-click measurement to a pixel.

**And a fourth option, for a drawing that says.** The three presets are a
recognition task, and that is their strength — but a plan carrying a dimension
string, a door schedule or a joinery detail *knows* its width, and that is better
information than the list. So there is an **"Enter a custom width…"** field below
the three. It goes through `scaleFromDoor` unchanged; there is no second scale
path to drift.

It is **bounded, at 450–3000mm** (`CUSTOM_DOOR_MM`), and the bounds are not
fussiness. This number divides the entire plan, and a typed `90` where `900` was
meant fails nowhere downstream — it produces a drawing at ten times the scale
that looks plausible until somebody orders from it. `parseDoorWidth` accepts
`825`, `750mm`, `1,200` and rounds a fraction, and refuses the two typos that
matter **by name**: a dropped zero (*"90mm is narrower than 450mm, which is
narrower than any door"*) and an answer in metres (*"Doors are measured in
millimetres here — did you mean 900?"*). The panel also shows the resulting
px/ft before it is applied, because that is the number a person can sanity-check
at a glance.

**Which side of the box.** A door in plan is a leaf plus a quarter-circle swing,
and the swing's radius *is* the leaf length — so both sides of a clean detection
box equal the door's clear width. They are never exactly equal, because the box
also encloses whatever frame and wall the leaf is hinged into, and that lands on
one axis and not the other. So the **shorter side** is taken as the opening: the
longer one is the one carrying the wall. On the sample plan the boxes come back
150×193, 120×115, 120×145 and 105×95 — close to square, anisotropic by up to a
quarter, and consistent with exactly that reading.

**The model never states a length.** It draws a box, the person names the door,
and the arithmetic happens in `src/lib/doors.js`. Same division of labour as
everywhere else here, and it is what keeps a detector that is 20% wrong about a
box from being 20% wrong about the scale of a whole building — because a person
looking at the result can see that a flat has come out 90 ft wide.

**The order the doors are offered in is the offer.** They are ranked not by
confidence but by **how close each is to the median opening**, and the first is
marked with a dashed outline as the suggestion. The user is picking a ruler for
the entire drawing: a confident detection of the one odd door on the sheet is a
worse ruler than an ordinary one, and the door that agrees with the most other
doors is the safest thing to measure.

**And the panel shows what the other doors would then measure.** The one way
this feature goes wrong is naming the wrong door — a 750 called a 1200 — and the
tell is that every other door on the plan comes out an implausible width. That
line, and the existing "Plan measures 26'9" × 42'2"", are the only checks
available without a dimension string on the drawing, and they are both cheap.

**It runs inside the project-type dialog.** Picking a project category turns that
same dialog into a loading state — *"Looking for doors…"* — and the user arrives
at a tracer that is finished. The alternative is landing them on an empty tracer
and popping the doors in underneath them a beat later, which is the worse version
of the same wait, because by then they have started clicking. It is skipped
entirely on a DXF: the file states its own units, and asking a detector would be
asking a worse source than the one already in the file.

**The door screen shows the doors and nothing else.** Before there is a scale,
every other control on that screen is inert — the spaces cannot be drawn because
their dimensions are unknown, the snap options change nothing, the trace refuses
the first click, and **Light all N spaces** has nothing to light. They used to be
on screen anyway, greyed or empty, and the panel opened with a fact about the
detector ("4 doors found") rather than an instruction. So `doorScreen` in
`OutlineTracer.jsx` puts all of it away and the panel says two sentences: what to
click, and where to go if none of these doors is one you can name. Six sections
of which five do nothing is a panel that gets skimmed, and skimming this screen
is how a plan ends up scaled off the wrong door.

**The snap engine is off, not merely unused.** It kept running under the cursor
on this screen: a crosshair, a glyph under the pointer, dotted alignment guides
across the plan, and a pill in the corner reading *"lined up with a corner"* —
about a corner nobody was placing. Every one of those is a statement that a
click here draws something, and here a click picks a door. `recomputeSnap` is
skipped while `doorScreen` holds, the last snap is cleared when it comes up, the
HUD keeps only the pan chip, and the cursor is plain `default` rather than
`not-allowed`, which reads as "this screen is broken" when it is simply waiting.

**The tracer screen went the same way as the door screen, for the same reason.**
The name, size and area of every space were drawn across the plan *and* listed in
the panel — the same four facts twice, the copy on the plan sitting over the
drawing they describe. The plan keeps the polygons; the panel keeps the words.
The panel itself had one subject spread over two sections with three unrelated
ones between them — a tally under "Spaces on the plan" at the top and the spaces
themselves under "Outlines" at the bottom — so they are one section now, and it
renders without a detectState, which the tally-only version could not: a plan
traced entirely by hand still has spaces to list. Snapping to what is already
traced was a section called "Snap to" one below a section called "Snapping": two
names for one idea, and the second appeared and vanished with the first outline,
so the panel reshuffled itself as you worked. It is a checkbox in "Snapping" now.
**And hovering any space thickens its outline** — the fill is left alone, because
the fill is carrying identity and brightening it would read as a change of state.
All of it is pinned by `tools/check-tracer.mjs`, which traces two spaces in a
real browser and then reads the hues off both the panel swatches and the Konva
polygons, counts the `Text` nodes drawn over the plan (zero), and moves the
pointer onto each space in turn to watch one stroke width change and the others
not.

**The grid is gone, and it was the snap engine that made it redundant.** It
rounded a traced dimension to the nearest 3″, 6″ or foot, anchored on the first
corner placed so it rounded the space's SIZE rather than its position — which was
the right design for the grid. But a corner that snaps lands on the wall it
belongs to, and a wall in the drawing is where the building actually is; rounding
it afterwards moves the corner OFF that wall to make a number tidier, which is a
worse outline dressed as a neater one. Two rounding schemes competing for one
corner is also how a grip stops landing where the cursor said it would.
`snapPoint` still takes `gridPx` and `tools/test-snap.mjs` still covers it —
nothing on this screen turns it on.

**The instruction is the screen, so it is sized like one.** It was a note in the
top-left corner of a panel with nothing else in it, which reads as a caption on
emptiness. The panel is now as tall as the plan beside it (`.rooms-side.door-only`
matches `.tracer-plan`'s height so the two line up top and bottom) and the
sentence sits in the middle of it at display size, with the escape hatch under it
in body size. **And hovering a door thickens its outline** — the fill is left
alone, because the fill already says "these are the doors" and a second fill
value would compete with the selected state. A button that does not answer the
pointer leaves you clicking to find out whether it is one.

**Failure is survivable, and that is why Measure still exists — as a tab, not as
a button.** No doors, a detector that is down, or four boxes that are all
obviously wrong all end in the same place: measure something by hand, which is
what the app did before this. That escape used to be a *"None of these — measure
instead"* button inside the door panel, which meant two doors to the same room:
the tab and the button. The tab is the one that survives, because it is where a
user who never clicked a door would look.

> **The bug this shipped with, for one build.** The door boxes went into the
> tracer's annotation layer, which is `listening={false}` — correctly, because
> everything else in it is a snap glyph or a guide and annotation must never eat
> a click meant for the drawing underneath. A door box is not annotation, it is a
> **button**. They drew perfectly, the cursor never changed, and clicking one did
> nothing at all. Same family as [the sconce whose grab area was painted under
> its own symbol](#everything-the-model-proposes-is-editable): a control that
> looks right and is not reachable. They have their own listening layer now, last
> inside the Stage so it paints on top too, and `tools/check-doors.mjs` clicks a
> real one in a real browser.

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

### Whose grid — the chunk is resolved per surface

A chunk is a region of ceiling with its own grid, so the segments available to a
surface are the ones in the chunk **that surface** sits in. This is decided
inside `planTaskSpots`, once per surface, from the centre of its outline.

It used to be decided once for the whole room, from the first surface's centre,
which is right until a room has two surfaces in different chunks — and a
living-dining room always does. The dining table was placed against the *coffee
table's* grid and its spot landed on a segment at the far end of the room,
several metres from the thing it was aimed at, while the pair of downlights
directly either side of the table went unused. There was never a sense in which
the other chunk's lines were candidates; the code just never asked the question
twice. `tools/test-spots.mjs` reproduces both the fix and the old behaviour, so
the failure is pinned rather than merely absent.

The used-once rule still spans the whole room. Two surfaces in different chunks
can never contend for a segment, but the set is planned as a set regardless.

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

### Panning: the middle button, on every canvas

Hold the **middle mouse button** and drag. It works on the layout screen and on
the tracer, which are two completely different canvases, and the point of using
one button for both is that a view control should not depend on which step you
are standing in.

**It is the middle button because the left one is spoken for at every level
here** — tracing a corner, dragging a grip, sliding a strip's end, boxing a
no-light zone. The tracer's space-drag still works and is unchanged, but a
modifier you have to hold *before* the gesture starts is a modifier you have to
remember; the middle button is free everywhere.

**Two canvases, two implementations, and that is right rather than lazy.**

- The **layout** SVG lives in a scroll container — `overflow: auto` with the
  plan sized by the zoom — so panning is *scrolling it*, and that is the whole
  implementation. Translating the SVG instead would mean owning the clamping,
  the scrollbars, the wheel and the keyboard that a scroll container already
  does correctly. Nothing else in `App.jsx` learns that a pan happened, because
  as far as the drawing is concerned nothing did: its own coordinates never move.
- The **tracer** is Konva with an explicit `pos`, so the pan sets `pos` from the
  pointer's delta. `pos` is in screen pixels and is not scaled, so there is no
  zoom arithmetic in between.

**Three things that are easy to get wrong, all of them found by pointing a real
browser at it** (`tools/check-pan.mjs`):

1. **`preventDefault` on the mousedown is not optional.** Chrome and Firefox on
   Windows and Linux start their own autoscroll on a middle press, which then
   fights the pan for the same drag.
2. **The move and up listeners go on the WINDOW, not the canvas.** A pan that
   ends when the pointer leaves the canvas ends every time you reach the edge of
   the thing you were panning away from — which is the only reason anyone pans.
   The `auxclick` a middle release fires is swallowed too, so a pan that happens
   to finish over a button does not also press it.
3. **`Konva.dragButtons` defaults to `[0, 1]` — left *and middle*.** So on the
   tracer a middle press on a grip started dragging that grip. Panning with the
   cursor over a vertex is most of the time, because the vertices are what you
   are looking at, which made this a corner of the outline quietly moving on
   almost every pan. One global line — `Konva.dragButtons = [0]` — set before any
   node exists.

Every gesture on the layout canvas now checks `e.button === 0` before acting.
A middle press reaching a drag handler starts a drag that no mouseup will ever
finish, because the pan swallows the release — the same class of bug as [the copy
bug](#direct-manipulation-and-the-copy-bug), one event arriving somewhere that
was only ever written for another.

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

## What kind of space is this?

Everything downstream of the ambient grid is **conditional on the answer**. A
bedroom gets bedside sconces; a store cupboard gets nothing. A conference room
gets a spot over the table; a toilet gets its basin sconces and nothing aimed.
Before this existed the user picked a room and pressed a button, one room at a
time, and had to know themselves which passes were worth running.

### The project type is asked, not guessed

One dialog, on upload, no dismiss: **Residential, Office, Hotel, Restaurant,
Educational**.

It is asked because a plan often cannot answer it. Twelve identical rooms off a
corridor are a hotel floor, a hostel or a student block, and the lighting differs
in each. It is one click, once, and it makes every classification after it
dramatically easier — a model told *"this is an office"* does not have to wonder
whether the room with one desk is a study or a chamber.

There is no close button and no backdrop click, which is a thing to be sparing
with and is earned here: every path afterwards reads the answer, so a skipped
dialog would mean a pipeline that either guesses or stops.

### Each project has its own short vocabulary

Seven to twelve room types per project, not one list of forty. **A classifier
picking one of nine is a different and far more reliable job than one picking
from thirty**, and a long tail of types nobody acts on differently is a long tail
of ways to be wrong for no benefit. A flat cannot be classified as a conference
room; an office cannot be a pooja room.

Each type carries what it looks like in plan — the same lesson as the furniture
pass — and the drawing's own text label is passed as evidence where `rooms.js`
found one, hedged as *"may be a room number, a level marker or plain wrong"*.

### What a type is entitled to is a property of the type

`accent` and `spots` are two flags on the type itself, not a list of ids
somewhere in `App.jsx`, so the rule and the vocabulary cannot drift apart:

| | accents | spots |
|---|---|---|
| bedroom, living space, office chamber, conference room | ✓ | ✓ |
| guest room, suite, lobby, dining area, bar, library, canteen | ✓ | ✓ |
| **toilet** | ✓ | — |
| kitchen, corridor, balcony, store, workspace, classroom, … | — | — |

A toilet gets its basin sconces and **no directional spot**: there is nothing in
a WC to aim at, and one over a basin is glare in a mirror.

An unknown project or an unreadable type is entitled to nothing. A classification
that could not be read comes back as `other` **with a confidence of zero** —
whatever number the model volunteered was about a category we then rejected, and
carrying it forward would display as "90% sure this is Other", a confident-
sounding claim about the one case where we know nothing.

### A kitchen is lit twice as hard, and a toilet nearly three times

The type decides the ceiling's density as well as its layers. `TARGET_AREA_BY_TYPE`
in `roomTypes.js` overrides what one cell should cover, against everywhere else's
50 sqft:

| type | cell | accepted between |
|---|---|---|
| **kitchen** | 25 sqft | 18.75 – 31.25 |
| **toilet** | 18 sqft | 13.5 – 22.5 |

**The tolerance is the shared one.** `areaTol` is a single ±25% applied to
whatever `targetArea` is, so neither of these gets a band of its own — that is
the point of stating the override as an area rather than as a number of lights.

The only lever this engine has for "more light" is the size of a cell. Halve the
area a cell covers and you double the number of fittings over it, which doubles
the lumens landing on the floor. That is the whole mechanism.

**It reaches the chunker, not just the grid.** Decompositions are enumerated and
scored against the cell they are expected to carry, so enumerating for 50 sqft
cells and then laying 25 sqft ones on the winner answers a question nobody asked.
Both options objects carry the override. A room re-enumerates when its type
arrives, and a chunking picked by hand is resolved afresh and falls back to the
recommendation if the denser reading no longer offers it.

What it actually does, on a plain rectangle with no obstacles:

| kitchen | at 50 sqft | at 25 sqft |
|---|---|---|
| 7 × 12 galley | 2 lights, 21 lm/sqft | 3 lights, 32 lm/sqft |
| 8 × 10 | 2 lights, 23 lm/sqft | 4 lights, 45 lm/sqft |
| 10 × 12 | 2 lights, 15 lm/sqft | 4 lights, 30 lm/sqft |
| 12 × 16 | 4 lights, 19 lm/sqft | 9 lights, 42 lm/sqft |

**The galley is the one that does not double**, and it is the acceptance band
doing it: 7 ft will not carry two columns of 5 ft cells once `minLightSpacing`
(3.9 ft) has had its say, so the room takes three lights in a single file
instead of six. That is a refusal with a reason attached rather than a silent
failure, and it is the shape of kitchen to check first if the result looks thin.

**It is a proxy, and worth saying so.** The quantity every standard is written in
is lux, and this engine has never worked in lux — `targetArea: 50` is an
assertion rather than a calculation, and 25 is the same assertion doubled. Rough
arithmetic on the current spec (900 lm, utilisation 0.7, maintenance 0.8) puts a
normal room near 100 lux at the working plane and a kitchen near 200, against the
300 a kitchen is usually specified at. Getting there honestly means making
lumens an **input** to the layout rather than a figure the Result panel reports
afterwards — deriving cell area from a target illuminance, so 50 sqft becomes a
consequence of 900 lm at 150 lux instead of a constant. That is a different piece
of work; this is the one number that buys most of it today.

Nothing else about a kitchen changes: it still gets no accents and no task spots,
and the grid is still centred and uniform, which is the [known
limit](#known-limits-v1) worth reading before trusting it in a galley.

### A wet room gets a different lamp in the same grid

A toilet at 18 sqft a cell is a cell about 4.2 ft square, and **a 36° 7 W fitting
over a cell that size throws most of its cone at the walls**. So the grid is
unchanged and the product is not: a toilet's ambient downlights are **5 W at 30°**,
drawn **20% smaller** than the standard fitting.

What this required was separating two things the app had been treating as one:

- **`kind` is geometry.** `small` means one light centred in a cell, `large`
  means one serving a pair. The planner deals only in this and never in products.
- **`fixture` is what you buy.** Resolved from the room's type by `fixtureFor`
  in `roomTypes.js`, stamped onto each light in `App.jsx` — the one place that
  knows both the layout and the type — and read by the canvas, the BOQ and every
  exporter.

For every other room the two are the same string, which is why they had never
needed separating. A light with no `fixture` at all — a plan saved before this
existed — falls back to its `kind`, and there is a test for it.

**It is a separate catalogue line from the directional spot**, though the lamp
is identical (5 W, 30°, 450 lm). A spot is aimed at a task surface and this is
ambient; merging them would give a schedule the electrician wiring a WC cannot
read. On the drawing they stay distinguishable by size and symbol; in the DXF the
narrow downlights get their own `LIGHT-SMALL-NARROW` layer, so they can be
isolated and counted. The BOQ shows a **Small 5W** column only on plans that have
any.

What it does, on plain rectangles:

| toilet | at 50 sqft | at 18 sqft |
|---|---|---|
| 4 × 5 | 1 light | 1 light |
| 5 × 7 | 1 light | 2 lights |
| 6 × 8 | 1 light | 3 lights |
| 6 × 10 | 1 light | 4 lights |

The small end does not change, and should not: a 4 × 5 WC has never wanted more
than one fitting. It is the 6 × 10 that was being under-lit by a grid sized for
a living room.

## The pipeline, and the loading screen that is its progress

Pressing **Light the whole plan** used to be one synchronous act. It now runs up
to four model calls per room before the user sees anything — a minute on a
six-room flat — so the wait has to be both visible and worth it.

1. **Placing the beds** — the two detectors' answers, judged room by room
2. **Reading your geometry** — the ambient layout, no model involved
3. **Understanding room types** — one small call per room
4. **Adding accent lighting** — only the rooms whose type qualifies
5. **Aiming task lights** — the same rooms, less the toilets

Then the user lands on the layout with everything already on it.

**The bed step is first, and its position is load-bearing** — the only step here
of which that is true. A bed is a no-light zone, a zone changes where the ambient
lights go, and everything after step 2 reads those light positions: the accent
pass is shown them so it does not put a sconce under a downlight, and the task
spots are placed on the grid they form. Settle the beds after the layout and all
three are working from a layout that is about to change underneath them. So it
runs before the rooms are marked lit at all — it needs only the traced outlines —
and the layout is then computed **once**, with the zones already in it.

It is skipped entirely unless the detector ran in `judge` mode, and it does not
re-run on a panel's recompute button: re-judging is its own button next to
**Look again**, because the two cost different things and fail differently. See
[A third model decides which of the two got it right](#a-third-model-decides-which-of-the-two-got-it-right).

**Nothing aborts the whole run.** A room whose classification fails is an `other`
and gets no accent pass; a room whose accent call 502s is noted and skipped. Five
rooms lit and one not is a far better outcome than a spinner that gave up at room
two, and every failure is on the console.

**The crop is built once per room and reused** by the three passes that follow.
(The bed step's crops are not among them and cannot be: it runs before the layout
exists, and its two pictures carry rectangles the others must not have on them.) It is the
same picture of the same room, and building it three times is three canvas
renders and three JPEG encodes for one image.

> **Why the rooms are read from a ref.** Everything after step one needs the
> *computed* rooms — polygons, chunks, the ambient lights — and those come out of
> a memo that cannot run until React has re-rendered with the new `litIds`. An
> async function holding `rooms` from its own closure would hold the empty array
> it was created with, forever. So the ref is the live view and the pipeline
> waits for it to fill.

### The loader is the plan

Not a spinner. Every room the user just confirmed is drawn as its own outline,
and each carries its state on its face: a pulse travelling round the stroke while
it is being worked on, solid and filled once it is done. You watch the work move
across your own drawing, which is both the honest progress bar and the thing that
makes the wait feel like progress rather than like nothing happening. The room
labels change from the drawing's own text to the classification as it arrives.

The shapes come from the **outlines**, not from the computed rooms, so the loader
has something to draw the instant it opens — the layout it is waiting for does
not exist yet, and a loading screen that starts empty and fills in is the thing
it exists to avoid.

> **The travelling stroke, and the obvious way that does not work.** One dash
> painted with a gradient that fades at both ends seems right and is wrong: an
> SVG gradient is *spatial*, so `objectBoundingBox` maps the fade to the
> polygon's width. The pulse tapers nicely along a room's top and bottom edges
> and is flat colour down the sides — which looks like a bug on any room that is
> not a letterbox.
>
> So the taper is built out of the **dashes**, which are measured along the path
> and therefore work at every orientation and around corners: three laps of the
> same outline, each a longer dash at a lower opacity, phase-shifted to sit
> behind the one in front. Head, body, trail — a comet. A positive
> `stroke-dashoffset` shifts the pattern *backward* along the path, which is what
> puts the trail behind the head.
>
> Dash lengths are fractions of each polygon's own **perimeter**, or a WC and a
> hall get the same absolute dash and the effect reads completely differently on
> each. Each room's animation is delayed by its index, so six rooms do not pulse
> in lockstep like a Christmas light. `prefers-reduced-motion` stops it dead.

## Additional lighting: three tools, and the detectors underneath

The accent panel and the task-surface panel are gone, and what replaced them is
three armed tools in the ceiling-object idiom: **LED strip** (click the two ends
of the run), **sconce** (click a wall and it seats itself), **directional spot**
(drag a box round what it should light).

Both panels were *reports*. One listed what the accent detector had found in the
selected space with a button to ask it again; the other did the same for task
surfaces. That was the right shape while those detectors were the thing being
built, and the wrong shape on a finished layout — two dropdowns, two model
buttons and a scrolling list of zones nobody edits, sitting where the obvious
question is "how do I run a strip along that wardrobe".

**The detectors still run.** They are part of the pipeline that lays the plan out
before anyone sees it, exactly like the bed pass. What went is their reporting,
and with it the assumption that a fitting exists only because a model proposed
one.

**And the tools do not make a fourth kind of thing.** A hand-placed strip is an
accent zone, identical in shape to one the detector proposes. A hand-drawn spot
box is a *task surface* — which is why the spot tool is a surface tool
underneath: the fitting is then placed by the same secondary-grid code that
serves every detected surface, so a hand-placed spot still lands on a line with
the ambient layout instead of wherever the pointer happened to be. `surfacesPx`
and `accentZonesPx` each merge two sources into one list, and nothing downstream
— canvas, schedule, exports, drag handles — knows or needs to know which source a
fitting came from.

> **That last sentence was true of every reader and false of both writers, and
> it cost two bugs.** A hand-placed strip or sconce **could not be moved and
> could not be deleted**. It drew correctly, it selected, its grips appeared,
> the drag armed — and nothing happened.
>
> Reading merges the two stores. Writing did not. `accentResults[roomId].zones`
> holds what the accent pass produced and `manualAccents` is a flat list of what
> the palette placed; every edit went `setAccentResults(...)`, where a `man-…`
> id simply is not. In a room with **no accent pass at all** it was worse — the
> updater's first line is `if (!res?.zones) return m`, so it bailed before
> looking. Delete had the same shape with an extra twist: the id went into
> `accentDismissed`, and `accentZonesPx` only ever filtered the *pass's* zones
> through that list, appending the manual ones unfiltered right after.
>
> The fix is `updateAccentZone(roomId, id, fn)`: **both** updaters run, and each
> returns its own state by reference when the id is not one of its own, so a
> miss is a no-op and never a re-render. Deliberately not "look up which store,
> then write" — that lookup has to happen outside a setState updater, against a
> possibly stale copy, which is the same class of bug one level down.
>
> **Delete keeps two verbs on purpose.** `accentDismissed` is a persisted record
> of *"the detector proposed this and I said no"*, and it has to persist because
> the pass can run again and must not put the fitting back. A hand-placed
> fitting has no generator to come back from, so it is **removed** instead —
> parking its id in that list would suppress something that no longer exists for
> the life of the plan. The merge still honours the dismissed list for both, so
> a plan saved while this was broken stays deleted rather than resurrecting.
>
> The lesson worth keeping: **a merged read is a promise that every write has to
> keep too.** Merging two sources at the point of display makes them look like
> one collection to everything downstream, and every writer then has to be told
> that they are still two. If the merge is the interface, the write belongs
> behind the same function as the read.

The sconce is the clearest case: the click says which wall and roughly where
along it, and `placeZone` — the same function the detector's output goes through
— finds the wall, projects the point onto it, works out which way is into the
room, and returns a fitting in exactly the shape everything else expects.

### Every tool says what the click will do, before it is spent

**The strip snaps on the tracer's own engine.** Placing a run by eye and placing
an outline corner by eye are the same problem — a strip a hair off the wall it is
concealed behind is as wrong as a corner that is — so `snapAt` from `snap.js`
gets pointed at this screen's geometry rather than a second, weaker snapper being
written for it. The segments are the SPACE OUTLINES: on an image they are the
only geometry there is, and they are the walls anyway, since an outline is traced
on the inner face. On a DXF the drawing's own line work joins them, so a run can
catch the edge of a wardrobe the outline knows nothing about. Ortho is on and
Shift releases it, which is the tracer's convention and the opposite of this
screen's convention for resizing a ceiling object — deliberately, because the
reference for this gesture is drawing a line on a plan, and a run along a wall is
axis-aligned far more often than not. Having caught something, the cursor says
so: a diamond for an edge, a square for an end, the tracer's alphabet, because
"it snapped" is not the useful information and WHAT it snapped to is.

**The sconce is previewed by running the real placer.** Not a marker at the
cursor — the whole point of this fitting is that the wall decides where it goes,
so a preview under the pointer would show something that never lands. What is
drawn is the output of `placeZone`, the same function the click will run, at
0.55 opacity with the wall it chose dashed behind it. What you watch slide along
the wall as the pointer moves IS the fitting. It is O(the polygon's edges) per
mouse move, and a room has a dozen.

**A strip's run is the exception that proves the rule.** Its two points are
exactly where they were clicked, with no wall projection, because somebody
placing a strip by hand is looking at the drawing — snapping their second click
onto a wall they did not click is the tool disagreeing with them. The snap
engine offers, the click decides.

> **The bug all three shared.** None of them changed the cursor. `overRoom` —
> the flag that decides between a crosshair and a pointer — was maintained only
> inside the ceiling-object branch of the move handler, so for these three tools
> it held whatever it had last been told and the cursor sat there claiming a
> click would do nothing. The tell was that arming a tool and then arming a fan
> made the crosshair appear.

### A spot says what it is aimed at

The task-surface boxes came off the drawing because a dashed rectangle round a
dining table is working, not design. But "why is this fitting here, and aimed at
what" is a fair question to ask of any spot, and the arrow answers only half of
it. So hovering one ghosts its surface and tethers the fitting to it. Under the
pointer is the right moment for it: asked about one fitting at a time, and
costing the sheet nothing the rest of the time.

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

### Rule 1 takes its bed from the bed detector, and nowhere else

**The accent pass does not decide where a bed is.** It is asked what furniture is
in the room, and it answers about beds too, but that box is discarded before the
rules run. `App.jsx` substitutes the **`bed-filter` bounding box** for that room —
or, where bed-filter found nothing in a space the classifier called a bedroom,
the box from the GPT bedroom crop. One furniture item per real bed.

Two consequences, both intended:

- **Two twins produce two symmetric pairs**, not one pair straddling both. The
  substitution is per box, so the rule fires once per mattress.
- **No detected bed means no sconces.** If neither bed pass put a bed in the
  room, the accent pass's belief that there is one is not promoted to a
  position. The room still gets its wardrobe strip and everything else; the bed
  is not a bed until the bed detector says so.

The reason is that the offset became a **measurement**. While a bedside sconce
sat at `0.24` of the bed's own width, the bed box was a hint — near enough to
pick the right wall, and nothing downstream cared about its edges. One foot from
the mattress edge makes the box a dimension, and a dimension has to come from the
thing that measures. A second, looser opinion about the same mattress competing
with a measured one is how one bed became several stacked zones.

### Why the bedside offset is one foot and not a fraction

It was `bedsideOffsetFrac: 0.24` — about a quarter of a double bed's width,
which is roughly where a nightstand sits. That keeps `accentPlace.js` unit-free,
which was the point: it works in plan pixels and in feet without being told
which.

**But it makes the offset scale with the bed.** A 3ft single pulls its sconces in
to 8.6 inches; a 6ft double pushes them out to 17. The thing being lit — a
shoulder, a book, a nightstand — is the same size in both rooms. So it is now
`bedsideOffsetFt: 1.0`, converted with `pxPerFt` at the call site, and
`tools/test-accents.mjs` asserts that a 3ft bed and a 6ft bed get the same gap.

The fraction survives as the fallback for a caller with no scale — a sconce in
roughly the right place beats no sconce — and rule 3 (a basin) still uses a
fraction, because a pair flanking a mirror really is proportional to the mirror.

### The rules are applied in code, and that is a repair

The five house rules were in the prompt, stated to the model, and trusted:

1. **a bed** — a sconce on both sides, **one foot clear of the mattress**
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
- a **strip's two ends** go wherever you put them, independently
- a **strip's body** drags whole, keeping its length and direction

**A sconce is one-dimensional and that is still the design.** It mounts on a
wall; it cannot leave one without becoming a different thing, so the drag
projects onto the wall's own line and clamps at its ends.

**A strip used to be one-dimensional too, and that was wrong.** Its ends were
projected onto the wall the placement pass had chosen, with the run's offset off
that wall preserved. That is the right gesture for a run on the right wall at
the wrong length — and it is no use at all in the case people actually hit,
which is the run being on the **wrong wall**, or standing off it, because the
furniture box it was derived from was off. Sliding an end along a line that is
itself in the wrong place cannot fix a run that is in the wrong place.

So the end goes where the pointer goes, and every old constraint comes back as a
**snap** — which hands the old behaviour back for free whenever it is the one
you wanted:

| snap | what it is | why it is there |
|---|---|---|
| **axis** | the line through the other end, along the run's current direction | "just make it longer". First, because a run stays collinear unless you mean it not to |
| **wall** | any wall of the room, not only the one it was placed on | a strip is concealed joinery, and joinery is against something |
| **ortho** | horizontal or vertical through the other end | for a run taken off the walls entirely — a cove round a false-ceiling island — which should still come out straight |

Tolerance is **0.45 ft**, quoted in feet and multiplied by px/ft at the call
site. An accent fitting lives in plan pixels, and a hard-coded pixel tolerance is
generous on a site plan at 6 px/ft and unusable on a flat at 40.

**Shift is a hard axis lock** — the end may only move along the run's existing
line, however far off it the pointer is. That is the old constrained drag,
available on demand rather than as the only option. On the body drag, Shift
turns wall snapping off, for placing a cove deliberately clear of a wall.

**The run's wall is re-derived on every edit.** Left pointing at the wall the
model originally chose, a run dragged across the room keeps claiming a wall it is
nowhere near — which is the stale state that made the constrained drag feel
broken in the first place. A run that is no longer on any wall is marked `free`
and drops its `alongWall` position rather than reporting a number that means
nothing.

**The whole run drags because two end handles cannot rescue a wrong wall.** You
would drag one end across the room, watch the run swing round like a compass
needle, then chase the other. The body gesture is "not here, there", and it moves
by the pointer's delta so a strip grabbed near one end stays grabbed near that
end. Snapping applies to the run as a **unit**: a wall is only offered when the
run is already parallel to it (within ~2.5°), because snapping each end to its
own nearest wall would shear a rigid thing across a corner.

**A press is not a drag.** Pointerdown on the body both selects and arms the
move — needing one click to select and a second to drag is what makes a canvas
feel slow — so the move does not begin until the pointer has travelled 3 screen
pixels, measured from the origin rather than from the last frame so a slow drag
still crosses it. Without that, every plain click would translate the run by
whatever fraction of a pixel the hand wobbled and mark it `edited` for it: a
fitting claiming to have been moved by hand when nobody moved it.

**A run still may not collapse.** Dragged onto its other end it stops
`minLen` (0.35 ft) short. The clamp is **radial** now rather than a comparison of
two positions along one wall — that only meant anything while both ends were
still on that wall, which is exactly the assumption this change removes.

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

## Export for CAD: a DXF that lands on the drawing it came from

**Offered only on a DXF**, because it is only meaningful on one. It comes back
out in the *original file's own coordinates* so it overlays the drawing you
started from — and an image's pixels have nothing to line up with.

Five layers, and nothing else in the file:

| layer | what is on it |
|---|---|
| `superluminal_spots` | every recessed fitting — ambient downlights **and** directional task spots |
| `superluminal_led_strips` | accent strip runs, as open polylines |
| `superluminal_decorative` | chandeliers and wall sconces |
| `superluminal_ceiling_objects` | fans, AC cassettes, trap doors |
| `superluminal_rooms` | one closed polyline per room outline |

No grid, no cells, no no-light zones, no chunk boundaries. Those are the
planner's working, not the drawing.

### The space outline is off on the layout screen

`LAYER_DEFAULTS` in `App.jsx` starts `region: false`. It is the one layer on that
screen that is **scaffolding rather than deliverable**: it says where the boundary
somebody traced is, which is the question of the *tracer* screen and a settled
fact by the time fittings are being placed. On a plan with eight spaces it is
eight heavy closed curves laid over the drawing the fittings have to be read
against. It stays a checkbox, because confirming a fitting sits inside its own
space is a real thing to want to do.

Two consequences worth knowing, because neither is obvious from the change:

- **It comes out of the PNG and SVG too.** Those two exports serialise the live
  canvas, so every layer toggle is also an export toggle. That is the intended
  direction here — a client sheet should not carry the traced boundary — and the
  **DXF is unaffected**, because it is built from data rather than from the
  screen and puts the outline on its own `ROOM` layer regardless.
- **Focus is no longer shown on the canvas.** `focusId` was used in exactly one
  place: drawing the focused space's outline heavier. Survivable, because focus
  is *assigned* rather than chosen — it falls back to the first room when
  nothing is picked — so it was never a reliable signal of intent, and the panel
  already names the space it is editing. If focus needs a canvas signal later, it
  should be one that does not depend on a layer the user can turn off.

**A saved plan keeps its own value**, and fixing that surfaced a latent bug.
Restoring used to do `set.setLayers(p.ui.layers)` — a wholesale assignment — so
**every layer added after a plan was saved came back `undefined` on that plan**.
Falsy, so off, with nothing on screen to say why one drawing was missing a whole
category of fitting. It now merges over `LAYER_DEFAULTS`, so a new layer arrives
switched on and an explicitly saved preference still wins.

### The layers follow the trade, not the pass that made the thing

That is the principle, and it is worth stating because one consequence looks like
a bug: **a chandelier exports to `decorative`, not to `ceiling_objects`** — which
is where it lives everywhere else in this codebase.

Internally a chandelier *is* a ceiling object: it has a body, keeps a clearance
and anchors the grid, identical treatment to a fan, and [that sameness is the
whole point](#ceiling-objects-a-chandelier-is-a-fan-with-a-different-drawing) of
`ceilingObjects.js`. On a drawing it is none of those things. It is bought from a
lighting supplier, wired to a lighting circuit, and switched with the sconces. A
fan and an AC cassette are somebody else's scope entirely.

The same logic puts an **ambient downlight and a directional task spot on one
layer**. They arrive from completely different passes — one from the grid, one
aimed at a coffee table off the secondary grid — and they are one recessed
schedule: same fitting, same circuit, ordered together.

Each layer is a thing a person switches off on its own to look at the rest, which
is the only test a layer split has to pass.

### How it differs from the other DXF

`toDXF` produces a **standalone** drawing: feet, Y flipped, its own layer names,
everything the planner knows. Useful to look at, useless to overlay. This one is
for importing back over the original, which means every entity has to arrive in
the source file's units, at its origin, with its Y-up orientation — or the whole
lighting layer lands in the next flat along and at the wrong scale.

`source.toDu` is exactly that mapping, inverted from the one that brought the
drawing in, so it is used for every single point and nothing is converted by
hand.

**Transform points, never angles.** Screen Y grows downward and CAD Y grows
upward, so a rotation carried across as a *number* comes out mirrored — a trap
door turned 30° arrives turned −30°, which looks plausible and is wrong. Carried
across as four corners it cannot. The AC unit's rectangle is built in pixels,
rotated in pixels, and only then converted, which is why there is no minus sign
anywhere in the exporter.

### R12, deliberately

`POLYLINE`/`VERTEX`/`SEQEND` rather than `LWPOLYLINE`, no handles, no object
section, and an explicit `LAYER` table with colours. It is the dialect every CAD
program on earth reads, and nothing here needs anything newer. `$INSUNITS`
carries the **original** drawing's unit code, not feet: import scaling keys off
it, and a file that claims feet while holding millimetres arrives 300× too big.

A strip exports as an **open** polyline — it is a run, and its two ends are the
whole specification. A sconce exports at its **wall point**, not at the offset
the on-screen symbol hangs out into the room, because the mounting position is
what gets set out on site. A refused fitting exports as nothing at all.

### Tested by converting back

`tools/test-cad-export.mjs` exports, re-reads the file with its own independent
scanner, and runs the coordinates back through `fromDu` to check they land on the
pixels they started from. A self-consistent export that is uniformly wrong passes
any check that only looks at the file, and borrowing our own parser to read it
back would let a shared misunderstanding agree with itself.

The fixture is a **millimetre** drawing at an awkward non-zero origin
(51234.5, −8765.25) — millimetres to catch a missing unit conversion, and the
offset to catch an exporter that quietly assumes 0,0. One assertion exists purely
to prove the origin is far enough out that a 0,0 bug would fail the test.

> Writing that fixture surfaced something worth knowing: it was 5 × 4 ft at
> first, and `parseDXF` read it as **centimetres** despite `$INSUNITS 4`, because
> a 5 × 4 ft building in millimetres is below its plausibility floor. That is the
> unit guesser working as designed (see [Units](#units)) — but it means a test
> fixture has to be a realistic size or every length assertion in it is off by a
> factor of ten for a reason that has nothing to do with what is being tested.

## The BOQ: the drawing, counted

A lighting layout leaves the studio twice — once as a drawing, and once as a list
of things to buy. **Design** and **BOQ** in the top bar are those two halves, and
the BOQ **replaces** the canvas rather than sitting beside it: a schedule is read
at a different moment, by a different person, and squeezing it into a corner of
the drawing screen makes both worse.

The reason to generate it rather than type it is that a person counting fittings
off a screen miscounts, and then orders 34 downlights for a job that needs 37.

### What is on it

| | | | |
|---|---|---|---|
| Recessed downlight — small | 7 W | 36° | the ambient grid's ordinary cell |
| Recessed downlight — large | 12 W | 60° | serves a pair of cells |
| Directional spot | 5 W | 30° | aimed at a task surface |
| Wall sconce | — | — | accent; wattage by fitting selection |
| LED strip | 9.6 W/m | — | accent; billed in **metres**, and also reported as runs |

**A sconce states no wattage, and that is not zero.** Zero would sum into the
connected load as a fitting that draws nothing, which is a claim about a lamp
nobody has chosen yet. The load figure therefore says what it excludes —
*"excludes 6 × wall sconce — wattage not specified"* — on the face of the table
and in all three files. A connected load that quietly omits eight sconces is
worse than no load at all, because the reader cannot tell it is incomplete. The
strip gets its W/m for the opposite reason: tape is bought by the metre at a
stated output, so 9.6 W/m is a default that can be *true*.

**Strip is counted twice, in metres and in runs.** A contractor buys metres and
installs runs, and the number of runs is what tells him how many drivers and end
caps. With no scale set the runs are counted and the metres are left at zero
rather than invented.

**Fans, chandeliers, AC units and trap doors are listed and not billed.** They
are on the drawing because they occupy ceiling — they are *why* the lights are
where they are — but a lighting BOQ that quotes an air conditioner is a lighting
BOQ nobody trusts. A chandelier is the awkward one and it goes here rather than
above: it is a light, but a specified, chosen object whose lamping is not ours,
so counting it and stopping is the only honest thing to do with it.

**And there is a per-room breakdown**, because that is how a site is wired and
how a contractor prices it. The room rows add up to the totals, and
`tools/test-boq.mjs` asserts it — a BOQ whose breakdown disagrees with its total
is worthless.

**It is derived, not stored.** `buildBOQ()` is a memo over the same sources the
canvas draws from, so "the schedule matches the drawing" is a property of the
code rather than something to remember. Lights move constantly — a fan is
dropped, a chunking re-picked, a strip dragged — and a schedule held in state
would drift from the first of those.

> **One cached number was left in, and it did exactly that.** App.jsx used to
> stamp a `runFt` field onto each accent zone when the pass placed it, and
> `runMetres` preferred it over measuring the geometry — a length already in feet
> looked like the better source. It is the worse source. A strip's end is dragged
> in **plan pixels** and the edit cannot know the scale, so it updates `run` and
> `runLength` and leaves `runFt` untouched. A strip stretched from 3 ft to 12 ft
> therefore went on reporting 3 ft, in the schedule *and* in the accent panel,
> for the rest of the session — with nothing to hint that the drawing and the
> list disagreed.
>
> `runLength` in plan pixels plus the live px/ft is the only pair that cannot go
> stale, because neither half is a copy of anything. The field is gone, feet are
> computed where they are shown, and `tools/test-boq.mjs` now drags a strip
> through `setRunEnd` and asserts the metres follow it — lengthened, trimmed, and
> unchanged by a whole-run move.
>
> The lesson is the one this file keeps arriving at from different directions: the
> moment a value is stored beside the thing it was computed from, there is a
> version of the app where the two disagree.

### Three files, one table

`boqTable()` produces a rectangular grid of strings and the three exporters only
know how to write a grid. That is the whole architecture, and it is why the CSV,
the spreadsheet and the PDF cannot disagree about a total: there is nowhere for
them to disagree.

**The sheet is A4 portrait** — 794 × 1123 at 96dpi, with about 15mm of margin —
and that is not decoration. The PDF export is A4 portrait, so a sheet with the
same proportions on screen is a *preview of the thing that prints* rather than a
differently-shaped cousin of it. It grows past one page the way the PDF does, by
carrying on; below the page width it stops pretending and the wide tables scroll,
rather than crushing eight columns into three characters each.

**No dependencies**, which is a choice and not a stunt. This repo already
hand-writes DXF and the same reasoning applies twice over: jsPDF is ~350KB to
draw eight columns of Helvetica, and SheetJS's free build **cannot write styles
at all** — formatting is its paid tier — so the library everyone reaches for
would not have got us the formatted sheet either. ExcelJS would, at about a
megabyte. An XLSX is a ZIP of a few small XML files and a PDF is a handful of
objects plus a byte-offset table; both are written in `src/lib/boqExport.js`.

### The spreadsheet is a spreadsheet, not a printout

The first version wrote every cell as text. It opened, and it was useless: a
schedule whose totals are typed-in strings is something the reader has to redo
before they can price it.

**The units had to leave the cell text**, and that one change is what made the
rest possible. `"7 W"` in a cell cannot be multiplied by anything. `7` with a
number format of `0" W"` looks identical on screen and can. So the number goes in
the cell and the unit goes in the format — `0" W"`, `0"°"`, `0.00" m"`,
`0.0" W/m"`, `#,##0" sqft"` — which is how a real schedule is built.

**And then the totals become formulas.** Load per line is `=IF(ISNUMBER(E8),C8*E8,"")`,
the totals are `SUM()` over ranges, the connected load is `=G13/C4`. This is more
than a convenience: a SUM computed by Excel from the cells the reader is looking
at **cannot disagree with them**, not even if the code above is wrong. Change a
quantity in the sheet and everything below it follows.

`ISNUMBER` and not `=""`, incidentally, because a sconce's rating cell shows an em
dash to mean *deliberately not specified* — and `IF(E11="",…)` is false against an
em dash, so the first version went on to compute `6 × "—"` and the cell read
`#VALUE!`. ISNUMBER asks the question that was actually meant.

**Two sheets**, because one sheet cannot have two column layouts — `Description`
wants 32 characters and `Area` wants 12. `Schedule` carries the fittings and the
ceiling items; `By room` carries the breakdown **and checks itself against the
schedule** with a cross-sheet formula that prints `OK — matches the schedule` or
`MISMATCH`. That invariant used to be a claim made by a unit test the reader
cannot see; now the spreadsheet asserts it in front of them.

Plus the things that make a file feel finished: a merged title, a banded header
with a rule under it, frozen panes, right-aligned numeric columns, wrapped notes,
column widths sized to the widest *formatted* value, and A4 portrait print setup
so it prints as the same page the PDF does.

> **Two width bugs only a render could show.** `0.32` is four characters and
> `0.32 W/sqft` is eleven, and the column has to fit the second one — it was 9
> wide, so the cell read `###`, which is a spreadsheet telling you it has given
> up. And the three header facts sat in one row across A..F, where column A is
> the 4-character `#` column, so "Rooms" came out as "Room". Both were invisible
> in the XML and obvious the moment LibreOffice drew the page.

**Validated by a spreadsheet application, not by our own reader.**
`tools/test-boq.mjs` unzips the file and checks its own structure, but the claim
that matters is that *Excel's arithmetic agrees with ours* — and that can only be
tested by something that actually calculates. LibreOffice recalculates the
workbook and returns 154, 48, 15, blank for the sconce, 57.1 for the strip, a
274.1 W total and 0.32 W/sqft: exactly what `buildBOQ` computes, from formulas
rather than from cached values. The check cell evaluates to `OK`.

Four things in there are worth knowing, because each is a way the format bites:

- **The zip stores rather than deflates.** Every reader, Excel included, has
  read stored entries since 1989, and the alternative is shipping an inflate
  implementation to save a few kilobytes.
- **Numbers are written as numbers and everything else as an inline string.**
  `36°` and `9.6 W/m` written as numbers is a sheet where every cell shows
  `#VALUE`; a room called `01 Bedroom` written as a number is data loss. Inline
  strings rather than a `sharedStrings.xml`, because a shared-strings index one
  out produces a file that opens with every label in the wrong cell.
- **The PDF's xref offsets are measured on the encoded bytes**, never computed
  from string lengths — a degree sign is one character and two bytes, and one
  byte out is a corrupt file with no useful message. The test follows every
  offset and checks it lands on its own object header.
- **The CSV leads with a BOM.** Without it Excel reads a UTF-8 file as the local
  codepage and `36°` arrives as `36Â°`.

Both writers are **deterministic** — fixed zip timestamps, no `new Date()` — so
the same layout produces byte-identical files and a schedule can be diffed
between revisions.

**The files are tested by being read back.** `tools/test-boq.mjs` unzips its own
xlsx, checks every entry's CRC32, pulls the cells and formulas out of the sheet
XML, and verifies the things a malformed stylesheet gets wrong — that the two
reserved fills are in place, that `cellXfs count` matches the number of records,
and that no cell points past the end of the style table. It walks the PDF's xref
and verifies each offset. A test that only checks the writer did not throw is a test that
passes on a file Excel refuses. `tools/check-boq.mjs` then clicks all three
buttons in a real browser and inspects what lands on disk.

### The panel has one job

With a schedule on screen the right-hand panel collapses to the export and
nothing else. Every other section there — arm a fan, recompute the accents,
toggle a layer — acts on a drawing you can no longer see, and a panel full of
controls for an invisible thing is worse than an empty one.

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
- **A kitchen's grid is denser but still centred and uniform**, and a kitchen is
  the room where that is least true to how it is used. The counter runs round the
  walls and the middle is a walkway, so a centred grid puts fittings where nobody
  stands and leaves the worktop lit from behind the person working at it — who
  then casts their own shadow on it. A denser uniform grid does that twice as
  expensively. The layout a kitchen actually wants is a run of downlights offset
  about 2 ft from the counter wall, plus an under-cabinet strip; neither is built,
  and the second is the only thing that fixes the shadow, because the shadow is
  cast by the person rather than by the fitting.
- **`minWallDistance` is backwards in a kitchen.** It keeps a large light 5 ft
  off the wall because its cone scallops the wall. In a kitchen the wall is
  cabinet fronts and scalloping it is the goal.
- **The BOQ has no rates and no cost.** It is a bill of quantities and not a bill
  of materials: no make, no model, no catalogue reference, no price, so nothing
  in it can be totalled into money. Adding a rate column is easy — and now that
  the spreadsheet has formulas it would extend itself, `=Qty*Rate` down the
  column and a SUM at the foot. Deciding whose rates is the hard part.
- **Only the spreadsheet computes.** The CSV and the PDF are still flat text, so
  a quantity edited in the CSV changes no total. That is inherent to CSV and
  right for a PDF, but it means the three files stop being interchangeable the
  moment anyone edits one.
- **Nothing is grouped by circuit or by switch.** A contractor prices per room
  from the breakdown, but the drawing has no concept of a circuit, so the
  schedule cannot say what is switched together.
- **The PDF truncates a long note** with two dots rather than wrapping it. A
  single-line-per-row table is what makes the columns readable; wrapping means
  variable row heights and a pagination pass, and the notes are short by design.
- **The door scale trusts one door.** The other doors' implied widths are shown
  as a check, but nothing cross-checks them automatically, and nothing reads a
  dimension string off the drawing — which is the one source on a plan that is
  better than a standard-width assumption. A plan drawn to no consistent scale,
  or one with a 825mm door nobody expected, comes out wrong and looks right.
- **A freed strip can be put somewhere silly.** Its ends no longer have to be on
  a wall, which is the point, but nothing checks that the result is a run a
  fitter could install — it may cross a wall, sit outside the room, or run
  diagonally across a ceiling. The snaps make the sensible thing easy rather than
  the daft thing impossible, and there is no room-polygon clamp.
- **The bed judge only ever picks a whole answer.** It chooses between two
  detectors' readings of a room, not between individual boxes: a room where
  Roboflow got the first bed right and GPT got the second one right has no
  outcome here that is fully right. Per-bed pairing is the fix and it is not
  built — it needs the two answers matched bed to bed before the crops are made,
  and a rule for the bed that only one of them found.
- **An uncontested bed is not checked.** Where only one detector committed, that
  box becomes a zone with no second opinion, by
  [design](#a-third-model-decides-which-of-the-two-got-it-right) — so a lone
  false positive from either detector goes through. Visible on the canvas, and
  draggable, but nothing catches it for you.
- **The judge is never told it is wrong.** There is no record of which detector
  won on which kind of plan, so `BEDFIT_DEFAULTS.fallback` is an argument rather
  than a measurement. `tools/eval-detect.mjs` measures a detector in feet against
  a truth file and is exactly the harness this wants pointing at it; nobody has.
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
- The zones are **not exported** by the standalone DXF, CSV or JSON, which carry
  the ambient layout only. The CAD export does carry accents and spots — see
  [Export for CAD](#export-for-cad-a-dxf-that-lands-on-the-drawing-it-came-from).
- **The CAD export has no schedule.** It is geometry on three layers; nothing in
  it says which circle is a 12W downlight and which is a spot. Fitting types,
  counts and lengths are in the CSV, which is a separate file the recipient has
  to line up by eye.
- **A large and a small downlight share the `spots` layer**, told apart only by
  the radius of their symbol. So do an ambient light and a directional spot,
  which is deliberate — but it means the aimed ones cannot be isolated in CAD. A fitting you have moved by hand is therefore lost on
  reload along with the rest.
- **A hand-edited fitting is overwritten by the next run.** Asking again for a
  room replaces its whole list; there is no merge that keeps what you moved.
- Capped at 8 zones in the parser. The model is told to be restrained and is
  otherwise ungoverned.
- **The classification cannot be corrected.** A room read as a store gets no
  accents and there is no way to say "no, that is a bedroom" short of running the
  per-room buttons by hand. The type is shown on the room's row in the sidebar
  with the model's reason on hover, so at least the wrong answer is visible.
- **The pipeline cannot be re-run** without going back to the outlines and
  starting again, and it has no cancel button — only an internal flag that the
  reset path sets.
- **A project type cannot be changed** once chosen, short of reloading the plan.
- **Room types are not exported** anywhere: not in the CSV, the JSON or the CAD
  DXF, so the reason a room got what it got does not travel with the drawing.
- **A task surface gets exactly one spot.** A long conference table wants two or
  three along its length; nothing says so.
- **A spot only ever uses its own chunk's grid.** That is the right rule, but it
  means a surface sitting astride a chunk boundary — a dining table half in one
  piece of ceiling and half in the next — sees only the segments of whichever
  chunk holds its centre, and the pair of downlights on the other side of the
  line are not candidates however close they are.
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

## The app around the editor: accounts, projects, and what gets kept

Until now this was one screen. You dropped a file, you got a layout, and when you
closed the tab it was gone — which is fine for a tool you are building and
useless for a tool somebody works in. There are now five screens, one account
system, and a database, and the interesting decisions are all about **what is
worth storing and what is derived**.

```
/                    the promise, and the upload
/login               an email and six digits
/dashboard           every project
/projects/:id        every plan in one project
/plans/:id           the editor — what used to be the whole app
```

**The editor does not know Supabase exists.** `App.jsx` is three thousand lines
of geometry and it stays a pure editor over a `File`: props in, callbacks out.
`routes/Planner.jsx` is the only module that knows a plan has a row. That line is
worth defending — the moment a `supabase.from(...)` appears inside a
`useMemo` over the ceiling, the geometry stops being testable in Node, and
`tools/` is twenty-five scripts that depend on it not being.

**The upload comes before the sign-in, deliberately.** Asking for an email before
showing what the app does is asking for trust nobody has yet; asking while a
drawing is being read is asking at the only moment the answer is obviously worth
it. So the file is held in memory across the login step (`pendingUpload.js` — a
module variable, not localStorage, because a 30MB survey base64'd is both over
quota and a copy of somebody's drawing left on a shared machine), and the moment
a session exists it becomes a plan and the editor opens on it. A hard reload does
lose it, and the login screen says so rather than pretending.

**Email OTP, and the code rather than the link.** A magic link opens a *second*
tab, and the drawing the user just dropped is in the first one's memory. Six
digits typed into the tab that already holds the file keeps the upload alive.

**The wordmark gave up the top-left corner.** On a screen you reach by choosing a
plan inside a project, that corner has one job: say which plan this is and get
you back out. So it is `← Back to Projects` and the plan's name, edited in place —
a plan auto-named from a filename is a name nobody chose, and this is where
anybody who cares about it is looking.

### What is stored, and why it is three columns and not one

A lighting layout is not the valuable artefact. The valuable artefact is the
**pair**: what the segmenter proposed, and what a human then did about it. That
is the whole reason `plans` looks the way it does.

| column | what it is | written |
| --- | --- | --- |
| `editor_state` | every outline **as edited**, room types, no-light zones, ceiling objects, chunk picks, the accents that were rejected | on the autosave |
| `design_json` | the finished layout in feet, in exactly the shape `exporters.toJSON` produces | on the autosave, once a layout exists |
| `boq_json` | the schedule that was billed from it | with the design |
| `stats` | six numbers, flat, so a list of eight plans never touches the jsonb | with everything |
| `snapshot_path` | a PNG of the sheet | at milestones only |

`design_json` is the **same shape as the JSON export** on purpose. A second
serialisation of the same drawing would drift from the one people actually read
inside a month.

And `plan_revisions` is append-only, and it is the corpus rather than a backup.
The columns above are the working copy, overwritten all day. A row is appended
here only at the moments that mean something — `outlines` (the spaces were
confirmed), `design` (the pipeline finished), `export` (somebody took it away,
which is the strongest available signal that a design was considered finished).
An autosave never writes one, or the table would be 95% pointer-moves.

**What is deliberately not stored:** anything transient (drags, ghosts, hovers,
the busy string), anything derived (`rooms`, the layouts, the BOQ, px/ft — all
memos over what *is* stored), and anything huge and re-creatable (the accent
detector's room crops, which are base64 images that would multiply the row size
by ten for something re-made in a second).

### The autosave, and the two bugs in it that were not obvious

Debounced at 1.5 seconds of quiet, coalescing to the **latest** payload rather
than a queue: an intermediate state halfway through dragging a strip has no
value, only where it ended up does. Flushed on `beforeunload` and on unmount,
which is what catches "Back to Projects" clicked half a second after the last
nudge.

Two things about it are load-bearing and neither is visible in the happy path:

**The state object must be a memo with exact dependencies.** `onPersist` marks
the route dirty, which re-renders the editor. If the state object were built
fresh each render, the effect would fire again on that re-render — and that is a
loop that writes to the database forever. Identity stability *is* the termination
condition.

**And the restore gate has to be state, not a ref.** Effects run in declaration
order in one commit. The restore effect is near the top of the component and the
autosave effect is near the bottom, so a ref set by the first is already true
when the second runs *in the same pass* — while the serialised state still holds
the pre-restore blank, because the setters have only been scheduled. The autosave
would then write an empty plan over the saved one. A state flag cannot do that:
it only reads true in a later render, which is the render that carries the
restored values. There is a test for the round trip
(`tools/test-plan-state.mjs`), and its last section walks the writer's own keys
and asserts every one of them reaches a setter — because a field added to one
half and forgotten in the other fails **silently**, and would not be noticed for
weeks.

**A reopened plan does not re-run the detectors.** Four model calls, real money,
and the results would overwrite the corrections the user made last time. Each of
the four auto-effects is guarded on `restoring.current && nonce === 0`; a
non-zero nonce means the user pressed a re-run button, so it goes through.

### Realtime, and the column list that makes it viable

`projects` and `plans` are published, because the dashboard and the project page
are lists that change from somewhere else — the autosave in another tab, a second
window, a phone. Polling those is a request every few seconds forever for a
change that happens twice an hour.

**The publication carries a column list, and that is the whole trick.** `plans`
holds three jsonb columns that are routinely megabytes, and the autosave writes
them every couple of seconds while somebody drags a fitting. Replicating the
whole row would push that entire payload down every open socket on every
keystroke — the exact opposite of the performance this is for. So only the columns
a card is drawn from are published; a client that needs the geometry fetches the
row it is opening. (PG 15+, which Supabase is well past.)

One consequence, and it changes the client: with the default replica identity, a
`DELETE` event carries only the primary key — no `project_id`. A subscription
filtered on `project_id` therefore never sees a deletion and the list keeps
showing a plan that is gone. `replica identity full` would fix it and put the
jsonb back on the wire, so instead `subscribePlans` is **unfiltered** and relies
on RLS to scope the stream. A studio has tens of plans, not millions.

### Running the migrations

One file: `supabase/migrations/0001_init.sql`. Paste it into the SQL editor, or
`supabase db push`. It is idempotent — every create is `if not exists` or dropped
first — so re-running it after an edit is safe. It creates:

- `profiles`, with a trigger on `auth.users` so the row exists before the client
  could ask for it. Doing that from the browser after sign-in is the version that
  silently fails, because the OTP flow can land a session in a tab that
  immediately navigates.
- `projects`, `plans`, `plan_revisions`, with the indexes each list actually
  sorts by, and a partial index on `status = 'ready'` for the query a training
  export starts with.
- Triggers: `updated_at` maintenance; `plans.owner` taken **from the project**
  rather than from the client, which is what lets every RLS policy be a cheap
  `owner = auth.uid()` instead of a join; and a project's `updated_at` following
  its plans, so the dashboard sorts by work rather than by renames.
- One exemption in those triggers worth knowing about: **opening a plan is not
  editing it.** `last_opened_at` moves on every open, and if that bumped
  `updated_at` the dashboard would re-sort itself because somebody glanced at
  something.
- RLS on all four tables. The anon key ships in the browser bundle by design;
  these policies are the actual security boundary, so read them as code and not
  as configuration. `plan_revisions` has no update or delete policy, which is how
  "append-only" is enforced — RLS denies what no policy permits, so there is
  nothing to remember not to do.
- Storage policies on the existing public `uploads` bucket. Paths are
  `<user-id>/<plan-id>/…` and the first segment *is* the security model: a policy
  compares `folder[1]` against `auth.uid()`. The bucket being public is a
  deliberate, limited trade — it is what lets a DXF be re-fetched and a snapshot
  shown in an `<img>` without minting signed URLs on every card. If drawings are
  ever confidential, make the bucket private and swap `publicUrl()` in
  `src/lib/supabase.js` for `createSignedUrl()`; that is the only call site.

### Two config changes the router forced

**`base: '/'` in `vite.config.js`, not `'./'`.** A relative base emits
`./assets/index-abc.js`, which resolves against the *current path*. Fine for one
screen served from the root; fatal the moment there are real URLs — open
`/projects/8f2c…` directly and the browser asks for `/projects/assets/…` and the
app is a white page with two 404s. The font URLs are unaffected: they are relative
imports from inside `src/`, hashed and rewritten by the bundler.

**`vercel.json`, with the API carved out.** Every path that is not a real file and
not `/api/*` serves `index.html`, or a refresh on a deep link is a 404 from the
CDN. The negative lookahead is load-bearing — `/api/detect` and `/api/accents` are
functions and must not be handed the HTML shell.

### The environment, and the one place VITE_ is correct

Everything else in this repo that touches a key is server-side and deliberately
unprefixed. These two are the opposite — they are designed to ship in the bundle:

```
VITE_SUPABASE_URL=https://<project-id>.supabase.co   # or VITE_SUPABASE_PROJECT_ID
VITE_SUPABASE_ANON_KEY=<the anon / publishable key>
```

`SUPABASE_SECRET_KEY`, already in `.env.local`, bypasses RLS entirely and must
never be given a `VITE_` prefix.

### When the login screen sits on "Sending…"

Two very different bugs share that symptom, and `node tools/check-supabase.mjs
you@studio.com` tells them apart in about ten seconds. It bypasses the app
entirely — plain `fetch`, no supabase-js, no React — and prints the status and
the timing of the exact call `signInWithOtp` makes, plus whether the anon key's
project ref actually matches `VITE_SUPABASE_URL` (a mismatch 401s everything with
a famously unhelpful message).

**If that call hangs there too, it is not the app.** `signInWithOtp` waits for
the email to be *sent* before it answers, so a wedged or throttled mailer leaves
the HTTP request pending — and supabase-js ships no timeout, which is why the
button used to sit there forever. Every auth call now has a 30-second ceiling and
a sentence explaining what to look at; `Logs → Auth` in the dashboard will name
the actual failure. The built-in mailer allows only a handful of emails an hour,
so custom SMTP is the fix for anything beyond testing.

**Three settings that break this flow specifically:**

- **Authentication → Emails → Magic Link must contain `{{ .Token }}`.** The
  default template sends a *link*, not a code. It will appear to work — an email
  arrives, nothing is broken — and there will be no six digits to type into the
  form. This is the one people lose an evening to.
- **Email provider enabled**, under Authentication → Providers.
- **New sign-ups allowed.** `signInWithOtp` is called with
  `shouldCreateUser: true`, because the whole point is that somebody who just
  dropped a drawing does not have an account yet. With sign-ups disabled, a
  first-time email is rejected outright.

**"Error sending confirmation email"** is the next station along, and it is good
news: the request reached Supabase and Supabase answered. Its mailer then failed,
and it reports every SMTP failure through that one generic string, so the message
itself tells you nothing. The real error is in **Logs → Auth**, and it is almost
always one of four things: the sender address is not verified with the SMTP
provider (Resend and SendGrid both refuse unverified domains outright); the
username is wrong in a provider-specific way (`resend` for Resend, `apikey`
literally for SendGrid, with the API key as the password); the port is wrong (465
or 587 — 25 is blocked); or the email template has a Go-template syntax error,
which is worth suspecting first if the template was just edited. `{{ .Token }}`
with the spaces is valid; `{{ Token }}` or an unclosed brace fails the whole send.

**The SMTP settings that actually work with Resend**, since a 535 cost an hour
here: host `smtp.resend.com`, port `465`, username **`resend`** — the literal
word, the same for every account — and the password is the API key beginning
`re_`. The 535 is what you get for putting the email address or the API key in
the username field, which is the obvious thing to do and wrong.

One more, further down the same road: Resend will not send *from* an unverified
domain. Until `designopolis.co.in` has its DNS records verified in Resend, set
Supabase's sender address to `onboarding@resend.dev`, which works immediately but
delivers only to the Resend account owner's own address — enough to test the
whole login flow, not enough to sign anybody else in.

## PDFs: rasterised, not parsed — and why that is not the DXF route

A PDF is vector data, so the obvious move is to treat it like a DXF: pull the
line work out, skip the detector, get exact geometry for free. That is a trap,
and the reason is worth stating because it looks like the same problem and is not.

**A DXF carries layers and units. A PDF carries neither.** The DXF path is not
"vector data, therefore better" — it works because the file *names things*. It
says this line is on `WALLS`, that one is on `DIM`, and one drawing unit is one
millimetre. That naming is the entire value: `classifyLayers` reads it, the wall
stroke weight is applied to it, and the scale comes out of the header without
anyone measuring anything.

A PDF has none of that. It is a picture that happens to be made of paths. A wall
is two strokes; a dimension line is two strokes; a hatch is four hundred strokes;
a title block is a hundred more. Nothing in the file distinguishes any of them.
Extracting the paths would give us a *worse* image than rendering the page does —
same pixels, minus the antialiasing, plus a parser to maintain.

**And the scale is not in there either.** A page states its size in points, which
is the size of the paper. An A1 sheet plotted at 1:50 and the same sheet at 1:100
are identical files as far as the page box is concerned. Deriving feet from paper
size would produce a plausible number that is wrong, which is the worst possible
kind — a wrong scale still looks like a plan. So a PDF goes through the same
door-width measurement an image does.

So: **render page 1 at 2400px on the long edge, and from that moment it is a
raster plan.** The room segmenter, the furniture pass, the door detector, the
tracer, the planner — none of them know or care. That is the payoff of not
building a third pipeline.

Three details that are load-bearing:

- **White is painted under the page before rendering.** A PDF page's background
  is nothing at all, and transparent becomes *black* the moment it is encoded as
  JPEG, handed to a detector, or composited by a model's preprocessing. Every
  plan in this app is dark ink on light paper; this makes that true of PDFs.
- **2400px is deliberately not "as large as possible."** Every detector
  downscales its input anyway, the strokes are already sub-pixel crisp well below
  that, and a 6000px render of an A0 sheet is 140MB of RGBA for no extra line
  detail.
- **The worker is bundled, not fetched.** pdf.js parses off the main thread;
  letting it default would reach for a version-matched file over the network, and
  this app is meant to work on a site-office laptop with no connection.

**A drawing set asks which sheet.** One page opens silently. More than one and
you get thumbnails — because six sheets of which one is the plan and the rest are
elevations, a section and a door schedule is the normal case, and silently taking
page 1 would light the title block and then report finding no rooms as if the
drawing were at fault. The thumbnails come from the same render path at a twelfth
of the size, so what is previewed is exactly what will be used. The chosen page is
saved in `editor_state.pdfPage` and read straight off the row when the plan is
reopened, so a set never asks twice.

`source_kind` gains `'pdf'` (migration `0002_pdf_source.sql`). The editor turns
the file into a raster, but the object in the bucket is a PDF with twenty possible
pages, re-rendered on every open — recording it as `'raster'` would be a lie in
the one column whose job is to say what arrived.

## The upload is a background job

The first version blocked: drop a drawing, watch "Uploading…", get taken to the
editor once Supabase had the whole file. That is the wrong shape for this app, and
not by a little.

**Everything the editor does first is local.** The File is already in memory. A
DXF is parsed in the browser; a PDF is rendered in the browser; a raster is
decoded in the browser. The room segmenter, the door pass and the furniture pass
each send their own downscaled snapshot to their own endpoint and never touch the
bucket. So the upload is not a prerequisite for anything the user is about to do —
it is durability, running alongside. Blocking on it meant watching a spinner while
a 30MB survey crawled up, when the drawing could have been on screen and
segmenting a second after the drop.

**The plan id comes from the client**, which is what makes that possible. The
editor needs a URL, a URL needs an id, and waiting for the database to mint one is
a round trip before anything can be drawn. `crypto.randomUUID()` is exactly as
unique as `gen_random_uuid()`; the server was only adding latency.

So `lib/uploads.js` owns the sequence as a job, the pages navigate on the next
line, and `createPlanFromFile` — which did all three steps in one await — is gone.

**Two milestones, not one, and the distinction is load-bearing.** The ROW appears
after one fast insert; from that moment the autosave can write, so the user's
tracing is being persisted while the drawing itself is still going up. The FILE
lands whenever it lands, and only matters for reopening the plan later. A job
reports `rowReady` separately from `done`, and the only place the editor route
blocks is a write, which awaits `rowReady` — otherwise the first edits of a fast
tracer would hit an UPDATE against a row that does not exist yet and be reported
as a save failure.

They are also reported separately in the top bar, because they fail
independently and mean different things: the autosave protects the *work*, the
upload protects the *drawing*. "Uploading drawing…" beside "Saved" is a normal,
honest state. A failed upload leaves a Retry pill and does not touch the saved
work.

**A module-level registry holds the jobs**, which is deliberate rather than lazy:
the job must survive the navigation from dashboard to editor, and must hand the
editor the very File the user chose — which cannot go in a URL and must not go to
the bucket and back down again. React state cannot span that; a module singleton
can, because the navigation is a route change and not a page load. Finished jobs
are released when the editor unmounts, or a long session ends up holding every
drawing the user has opened.

### One bug that was hiding behind this

"Stuck on uploading" turned out to have two causes, and only one of them was the
blocking design. The other: `uid()` called `supabase.auth.getUser()`, which is
**not** a local read — it posts the JWT to `/auth/v1/user` for validation and takes
the auth lock while doing so. Every upload therefore began with a network round
trip that could queue behind any other auth call, and when it hung it hung *before
a single byte had been sent*, with the button reporting progress on a request that
had not started. `getSession()` reads what is already in memory; the token it
returns is signed, and the server verifies it on the next request anyway, which is
the only place verification actually matters.

`owner` columns are no longer sent from the client at all — `projects.owner`
defaults to `auth.uid()` and the `plans`/`plan_revisions` triggers derive theirs
from the parent row, which is the only source that cannot disagree with the row it
belongs to.

## Three changes: the fan detector goes, an admin overlay, and a second look for empty bedrooms

### The red-circle fan detector is gone

It scanned the raster for round red blobs, called each one a ceiling fan, and for
a while used their blade circles as the drawing's **ruler**. Both halves are
retired: the scale comes from a door, and a fan is placed by hand from the ceiling
palette, in feet, like every other object up there.

It was deleted rather than switched off because it guessed from **colour**, which
is the least reliable signal on a drawing — a red dimension leader, a north arrow,
a revision cloud, a hatched WC are all round-ish and red-ish on some office's
sheet. A detector nobody trusts still fills a state array that eight other things
read from, and it silently placed obstacles the user never asked for. Gone with
it: `lib/detect.js` (moved to `_to_delete/`), `FAN_DETECT`, `scaleFromFan` /
`scaleFromFans`, the `fans` and `fanReason` state, the "Quick-place fans" button
(the ceiling palette already places fans properly, in feet, with a blade sweep),
and the second fan list the BOQ had to add up.

**What deliberately stays** is everything downstream: `fanClearance`, the
chunker's preference for holding an obstacle clear, `cellIsAwkward`. Those never
cared where an obstacle came from — `planner.js` calls them all "fans" because
that was the first kind it met, and renaming forty call sites would be churn with
no behaviour attached.

### An admin overlay for role 1

`profiles.role === 1` marks an owner of this app rather than a user of it, and
unlocks one checkbox at the foot of the right panel: **show what was identified**.
It draws the task surfaces the detector marked and the bed zones the judge settled
on, plus counts of how many were re-asked and judged.

Both of those marks were on the drawing once and were deliberately removed —
working, drawn over a client's sheet. This does not undo that; it gates it behind
a role. The overlay is **magenta**, the only place in this app that breaks the
ink-and-one-blue rule, and that is the point: it must be unmistakable in a
screenshot that what is being looked at is working rather than a deliverable.

The bed zones are the interesting half. They are the one reading with no visible
consequence anywhere else: the planner obeys them — no downlight lands over a
mattress — but `drawnZones` excludes them, so a wrong bed is invisible except as
an unexplained hole in the grid.

**This is a UI gate and nothing more.** `role` arrives through RLS so a user can
only read their own, but a determined person can flip a boolean in a console — and
the answer is that it reveals nothing they don't already have, since the overlay
draws detections already in that browser's memory. Anything that must actually be
restricted belongs in a policy.

### A bedroom with no bed is a contradiction, so we ask again

The bed pass runs once, on upload, against the whole sheet downscaled to 1600px.
That is the right default — one call for however many bedrooms there are, answered
before anyone has traced anything. But on a six-bedroom villa each mattress is
left with a few dozen pixels and **both** detectors quietly drop beds: Roboflow
returns nothing above threshold, and GPT is looking at a picture where the bed is
genuinely hard to see.

Once a space has been classified, "no bed in this bedroom" stops being a result
and becomes a failed detection — and it matters more than any other miss, because
a bed is the one piece of furniture that changes the ceiling. Nothing goes over
it; whoever is lying there looks straight up into the fitting. A missed bed is a
downlight in somebody's eyes.

So there is a new pipeline step, **2b**, after the classification and before the
accents: for every space whose type `expectsBed` (bedroom, guest room, suite —
the flag lives in `roomTypes.js` with the vocabulary it belongs to) and which came
back empty, send the **room crop** to both providers again, asking only for beds.

Three things make it cheap and consistent rather than a second system:

- **The crop already exists.** The classifier built it and the accent and task
  passes reuse it; this reuses the same one, so the re-ask costs no extra canvas
  render or JPEG encode.
- **The thresholds land in the right frame.** `detectionsToZones` measures area
  fractions against the image it is given, so on a room crop a bed is judged as a
  share of the *room*. That is why the whole-plan pass has to allow up to 60% and
  this one does not have to fight it.
- **The same judge settles it.** `contestFor` decides whether the two readings
  differ enough to be worth asking about; only then does the judge see the two
  pictures, exactly as in the first pass. Both empty is a real answer — some
  rooms labelled bedroom are studies with a desk — and costs nothing. Provider is
  forced to `both` regardless of the user's setting, since the whole value here is
  a second opinion and one detector agreeing with itself is not one.

Verdicts from this step carry `refound: true`, which is the flag the admin panel
counts and the single most interesting thing about the row for anything training
on this later: the whole-plan pass missed this bed and a crop found it.

## The bed pass, and the day it turned out not to be a vision problem

Ten-bedroom resort sheet. Eight beds found out of fifteen. The obvious suspects
were all wrong — it was not resolution, not the colour of the drawing, not the
title block eating pixels, and not the models being weak. The console said so
plainly once we looked at it properly.

**The bed route was starving on output tokens.** `max_completion_tokens` on a
reasoning model is a budget for reasoning *plus* output, and the reasoning is
invisible. The bed route was capped at 1500 and the furniture route at 3000 — and
on the *same room crops, the same model, the same minute*, the furniture route
found twelve beds while the bed route found none in eight of ten rooms and
returned an empty `content` with a 200 OK. Every parser downstream reads that as
"no beds", which is indistinguishable from a room with no bed in it.

The proof is the latency correlation, and it is exact. The two bed calls that
answered took **13s and 20s** — the least reasoning, so budget left to speak.
Every call that came back empty took **21–26s**. In the furniture route at 3000,
the only two empty replies in the whole batch were the two slowest calls, at
**47s**. In both routes, every silent answer was a slow one.

So every cap is now 8000 (`MAX_OUT`, stated once per module with the reasoning).
**A cap is a ceiling, not a spend** — nothing is billed for headroom, so the
number belongs far above the largest plausible reply rather than tuned close to
it. Tuning it close is not a small inefficiency; it is a silent wrong answer.

**And Roboflow was never in the bed game at all.** Every call to the segmentation
workflow returned `predictions: []` with `"image":{"width":null,"height":null}`,
whole sheet and room crop alike — including a 63KB single-room crop where GPT
found four beds at 0.95 in the same request. So it is not a small-object problem.
Both "visualisation" images it returns are byte-for-byte the same length as each
other, which means nothing was drawn on either: the model block produced nothing.
The prime suspect is the `classes` parameter — we send the string `"bed"` where a
text-prompted block (Grounding DINO, YOLO-World) expects the list `["bed"]`.

It is deliberately still in the pipeline: on a clean drawing it is excellent, and
on this same sheet it returned 29 rooms at 0.94–0.97 and 13 doors at 1.00 in one
to seven seconds. It is superb at what it is trained for. But until that workflow
is fixed, "two readings and a judge" has been running on one detector — which is
also why the judge had never once fired.

### Big plans are asked one bedroom at a time

Over `LARGE_PLAN_SQFT` (3000 sqft of **built area** — the sum of the spaces, not
the sheet, so the same building on A1 and A0 is the same size) the whole-sheet bed
answer is not trusted at all, and every bedroom is asked about on its own crop.
Under it, the cheap path stands: the whole-sheet pass runs on upload and only the
bedrooms it left empty get a second look.

One step, two scopes, decided by the size of the plan rather than by a flag
anybody sets. On a large plan a bedroom is re-asked *even if the first pass
claimed to find something there*, because at that scale a hit is as likely to be a
mis-attributed neighbour as a real bed.

Which raises the last fix: **beds are attributed by containment, not by which crop
found them.** A crop carries a margin, so a room's picture routinely includes its
neighbour's bed — that is how one call came back with four beds labelled ROOM 8
and ROOM 9. Unattributed, they double-count the neighbour and let a room test as
"has a bed" on somebody else's mattress. Fresh finds are also deduped against
what the room already holds at the same iou 0.45 the whole-sheet merge uses.

The upload-time pass still runs once on a first upload even for a big plan, and
that is deliberate rather than an oversight: the built area is not knowable until
there is a scale, which on a raster means until a door has been measured — after
that effect has run. One wasted call on the first upload beats a bed pass that
waits for the tracer on every plan, large or small. Re-runs and reopened plans
skip it correctly.

## "Randomly logged out" was our bug, and the freeze underneath it was the lock

Two faults stacked, and the visible one was ours.

**The logout.** The initial session read was wrapped in a 12-second ceiling, and
its catch did `setSession(null)` — on the reasoning, written in the comment at the
time, that a failed read was "true enough" to treat as signed out. It is not true
at all. It turned a slow network into a logout while a perfectly good session sat
in localStorage. A read that does not answer means *we could not find out*, and
those are completely different facts.

So there are three states now, not two:

| state | what the app does |
| --- | --- |
| signed in | render |
| signed out — an actual `SIGNED_OUT` event | go to /login |
| **cannot tell**, and storage holds a session | say "Reconnecting", offer a retry |

Only `SIGNED_OUT` and `USER_DELETED` may clear the session. Nothing else — not a
timeout, not a network error, not a hung lock. And `onAuthStateChange` is now
subscribed *first* and treated as the bootstrap, since supabase-js fires it with
`INITIAL_SESSION` once it has read storage; `getSession()` is only a backstop
that can add a session but never remove one.

**The freeze.** supabase-js serialises auth calls behind a Web Lock so two tabs
cannot refresh one token at once. Good idea, one nasty failure mode: if the holder
never finishes, the lock is never released and every later auth call waits on it
*forever* — not slowly, forever, with no error. `getSession()` hangs;
`signInWithOtp()` queues behind it and hangs too. Which is exactly what the
Supabase logs showed: `/auth/v1/token` preflighted and then nothing, and every
auth call afterwards silent.

The usual trigger is a tab the browser put to sleep mid-refresh — Safari is
especially quick to suspend a background tab — so the symptom is "I came back to
a tab I left open and it had logged me out."

Two changes make it survivable. `softLock` bounds the wait: if the lock cannot be
taken in 4 seconds it runs unlocked and says so in the console. What that gives up
is cross-tab serialisation — two tabs could try to refresh at the same moment and
one could present an already-used refresh token, which Supabase tolerates with a
grace window. A rare retry is a much better failure than a permanent freeze. And
returning to the tab is now itself the retry: `visibilitychange` and `online` call
`refreshSession()` when the state looks stalled.

**And one dev-only cause worth knowing.** The client is now stored on `globalThis`
rather than at module scope, because Vite's HMR re-evaluates the module whenever
anything it imports changes — and a second `createClient` means a second
GoTrueClient competing for the same storage key and the same lock as the first.
Two clients fighting over one lock produces the identical freeze, and only on a
machine running the dev server. If the console ever prints "Multiple GoTrueClient
instances detected", that global has stopped working.

`signOut` is the mirror image of all this: it is the one place where clearing the
session is correct, so it is bounded at 8 seconds and clears local state whether
or not the network confirms. A "Log out" that leaves you looking signed in is its
own kind of broken, and on a shared machine it is worse than that.
