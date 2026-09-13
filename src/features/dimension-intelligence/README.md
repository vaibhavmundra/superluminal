# Dimension intelligence

The scale, read off a drawing that already states it — so a dimensioned plan
goes straight from upload to the outlines and never sees the door step.

`App` composes it with `usePlanDoc` and `usePlanSource`, above `useScale`.
Nothing else changed shape: `pxPerFt` is still one derived number and the
document is still the only persistent store.

## What it replaces, and what it does not

Until now every raster plan was MEASURED. The door detector found openings, the
user named one, and a door leaf's standard width became the ruler for the whole
building. That works on any drawing, so it stays — and it is still what happens
to a photograph, a scan, and any sheet that does not dimension itself.

What it does not have to be is the *first* thing that happens to every plan. A
great many uploads already carry the answer, written on them by the person who
drew them.

## The sequence

Fixed, and the order is the architecture:

1. **The plan opens and the room detector runs.** It always did — it needs no
   scale (`a polygon is pixels, and pixels do not need a scale`).
2. **Once the outlines are in, the scale is read** — from a chain, or from room
   sizes matched against those outlines, or both.
3. **A busy modal covers all of it** (`Finding the spaces…` → `Reading the
   dimensions…`), so nobody lands on a half-built screen.
4. **Then exactly two landings.** Scale read → the outlines, no door step at
   all. Scale not read → pick a door for the ruler, with the outlines already
   found and waiting so the plan fills in the moment a width is named.

**Reading waits for step 1 even when it would not have to.** A chain resolves
from the text alone, so settling early was tempting — and wrong: it would pick
whichever evidence happened to be ready first, and on a plan whose dimensions
are all room sizes (`resort_plan.pdf`, twenty-nine of them and not one chain)
that is no evidence at all. The answer would be "no dimensions" on a fully
dimensioned sheet. The wait costs nothing, because it is the detector's own.

"Are these all the doors?" is **not** part of this flow. It is a question about
switchboards and is asked by the wiring, the first time the electrical layer is
switched on.

## The two patterns

Both were found by looking at plans users actually uploaded. Neither needs the
PDF's line work read — see the note in `lib/pdfPlan.js` about why the drawing is
rasterised and why TEXT is the exception to it.

**Chains** (`chainScale.js`) — a row of figures along a wall. Each is centred on
the segment it describes, so the gap between two neighbours is half of one plus
half of the next:

```
|<--- 10'-0" --->|<----- 12'-6" ----->|
         *                  *
         |<---- 11'-3" ---->|            = (10 + 12.5) / 2
```

A length in feet and a length in pixels for the same span, from the text layer
alone. A chain of four yields three estimates that must agree, so a label knocked
off its segment disagrees with its neighbours and is dropped.

**Room sizes** (`roomScale.js`) — `18'-0" X 12'-0"` inside a room. The outline is
already on screen in pixels, because the room detector runs BEFORE the scale is
known and says so explicitly ("a polygon is pixels, and pixels do not need a
scale" — `useRoomRecognition`). And because it is a PAIR it checks itself: one
string gives px/ft twice, against the width and against the height, and the two
must agree. That single division confirms the number was parsed right, that the
label belongs to THIS room, and which way round the room reads.

## Why the bar is where it is

`doors.js` puts it better than this file can: a wrong ruler is the worst failure
this app has, *"because every room comes out the wrong size while still looking
exactly like a plan"*. Declining to read a scale costs one door click. So:

- **Two independent agreeing candidates, minimum.** One room's two ratios check
  each other but cannot reveal a systematic error — a single room whose polygon
  sits on wall centrelines is confidently 4% wrong with nothing to disagree with.
- **The largest cluster, not the median.** See below — this one was learned the
  hard way.
- **`N.T.S` on the sheet is ignored.** It was a hard veto, then a raised bar,
  and both were wrong. Every sample plan here carries `SCALE = N.T.S` —
  including a resort floor with twenty-nine room sizes and a one-bed flat with
  three. The phrase goes into a title-block template once and is never looked at
  again, so it carries no information about the drawing. Whether a plan is
  proportional is shown by whether its own measurements agree, which is the only
  thing weighed. The raised-bar version also made small plans unreachable by
  arithmetic, which is a refusal wearing a threshold's clothes.
- **An L-shaped room is refused**, because its extent is not its size.

## What a real dense plan taught this, and it is three things

`public/samples/floor_plan_dim_intelligence.pdf` read as "no dimensions at all"
on the first build, while carrying six chains and 71 figures. Each cause is a
property of dimension chains rather than a quirk of one file, and each has a
test built from that sheet's own measurements.

**Figures sit closer together than a space.** Gaps between neighbouring figures
on that sheet run from **0.54 to 11.8 text heights**. Reassembly joined at 1.8,
so `205` and `425` became one line reading `205 425`, which parsed as a single
205 occupying the width of both. The two populations to separate are the
sub-pixel splits pdf.js makes inside one string (at or near zero) and real gaps
between figures (0.5 and up) — so `GAP_TOL` is 0.35 and sits between them, not
at the widest space a font might contain.

**Chains stack.** A figure too wide for its own segment goes on a second row —
25 figures at y=1292 and 3 more 14px below at a text height of 12.1. At the old
1.2-height tolerance those merged into one chain and produced spans between
figures describing different things. `OFFSET_TOL` is 0.5.

**Not every segment carries a figure, and that error only points one way.**
Where a segment is too short to label, the figure is dropped or moved, so two
figures that look adjacent have unlabelled wall between them: the span is
credited with too few feet and reads as too *many* px/ft, never too few. On that
sheet the true 25.7 accounted for 34 of 57 adjacent pairs and the rest ran 28 to
70. A median survives 60% contamination and fails at 49% — too fine a margin to
rest a building on. So `consensus` takes the value with the most other
candidates within `TOL` of it: scattered wrong answers do not cluster, and ties
break low because the contaminant is always the higher number.

It now reads that sheet at **25.684 px/ft**, high confidence, 43 of 68
candidates agreeing — cross-checked against the sheet's own overall dimension
(`21773`mm = 71.43ft, predicting 1834.6px against a chain that spans 1827.5px).

## What it cannot see

A stated `18'-0"` is usually the CLEAR INTERNAL dimension, wall face to wall
face, while the detector's polygon may sit on centrelines. On an 18ft room with
9in walls that is about 4% — one direction, every room, invisible. It is not
corrected: the offset is constant across a sheet, so it shows as a uniform
disagreement against a chain, and solving for it wants evidence this feature does
not have alone. `spread` in the verdict is what makes it visible.

## The answer is latched

Outlines are evidence AND they are editable. Recomputing would mean dragging a
room corner silently re-scaled the building. So the reading happens once, is
written to the document's `stated` field, and is never re-read — nothing saves
the text layer, so a plan reopened tomorrow has no strings left in any case.

`STATED_SET` writes `stated` and `scaleMode` together because they are one fact.
And `'stated'` is a MODE, not an override: somebody who disagrees picks a door or
drags a reference line, the mode moves off it, and the record stays in the
document so the two can be compared. See the branch order in `useScale`.

## What this did to the doors

A switchboard is placed beside a door, so the door boxes are still wanted — but
that is a question about the WIRING, which most plans never reach. It is no
longer asked on upload. `deferDoors` holds the detector back while the drawing
may yet state its own scale or already has, and the first press of the electrical
layer runs it, opens the confirm step, and returns to the wiring once answered.
A plan that is only ever lit never spends the call.

The fallback route is untouched: when nothing can be read, the doors are the
ruler again and they are found on upload exactly as before.

## Files

| | |
|---|---|
| `dimText.js` | reassembling fragmented PDF runs into lines; reading a length |
| `chainScale.js` | the chain pattern |
| `roomScale.js` | the room-size pattern, and oriented extent |
| `consensus.js` | agreement, and the bar for skipping the step |
| `index.js` | `readScale()` and `statedRecord()` — the pure entry |
| `useDimensionIntelligence.js` | when the question is asked, and the one write |

Everything except the hook is pure and covered by
`tools/test-dimension-intelligence.mjs`. The text source is an ARGUMENT, not an
import: `lib/pdfPlan.js` supplies runs from a PDF's own text layer today, and a
vision pass reading a scanned plan would hand over the same shape without any of
this changing.
