// ---------------------------------------------------------------------------
// WHAT A SAVED PLAN IS.
//
// This file is the contract between the editor's sixty pieces of useState and
// one jsonb column, and it exists as a module rather than as two inline blobs in
// App.jsx for one reason: THE TWO HALVES HAVE TO STAY THE SAME SHAPE. A field
// added to the writer and forgotten in the reader is the worst class of bug here
// — nothing breaks, nothing warns, and the user's tweak to a room outline is
// silently absent the next time they open the plan. Writer and reader sit twelve
// lines apart so the omission is visible.
//
// THREE THINGS ARE BEING KEPT, AND THEY ARE NOT THE SAME THING:
//
//   1. editor_state — everything needed to put the user back exactly where they
//      were. The segmenter's proposed rooms AND the corrections made to them,
//      which is the pair that matters: "what the model said" and "what a person
//      then did about it" is the training signal. One without the other is half
//      a datapoint.
//
//   2. design_json — the finished layout, in feet, in the same shape the JSON
//      export already produces (exporters.toJSON). Deliberately the SAME shape:
//      a second serialisation of the same thing would drift, and the export is
//      the one that gets looked at.
//
//   3. the snapshot — a PNG of the sheet. Not for the app (it re-renders from
//      the state), but for a human scanning a project page, and for a future
//      model that wants the picture next to the JSON.
//
// WHAT IS DELIBERATELY NOT KEPT: anything transient (drags, ghosts, hovers,
// guides, the busy string), anything derived (rooms, layouts, the BOQ, px/ft —
// all memos over what IS kept), and anything huge and re-creatable (the
// accent-detector crops, which are base64 room images that can be re-made in a
// second and would multiply the row size by ten).
// ---------------------------------------------------------------------------

export const STATE_VERSION = 1;

/**
 * THE FIELDS CTRL+Z DOES NOT TOUCH, AND THE ONLY LIST OF THEM.
 *
 * NOT A FOURTH KIND OF STATE. Every name here is saved and restored exactly like
 * every other field in this file — the question this answers is not "where does
 * it live" but "what does undo do to it", and those are different questions. The
 * viewport and the selection are held back because undoing a change while the
 * canvas jumps to where it was two gestures ago loses the reader's place and
 * hides the very thing that just changed. See `applyStep` in App.jsx.
 *
 * EXPORTED BECAUSE IT HAD TWO COPIES. `applyStep` used to hand `applyEditor` six
 * hand-written no-op setters, which is the same class of hand-maintained pair
 * this whole file exists to warn about: a field added to the document and
 * forgotten here starts jumping the canvas on every undo, and nothing says so.
 * One list, read by the reducer and by `applyStep`, checked by test-plan-state.
 *
 * FIELD NAMES, NOT SETTER NAMES. `setterFor` below is the mechanical mapping, so
 * there is nothing to keep in step.
 */
/**
 * WHICH LAYERS A DRAWING OPENS SHOWING, AND WHY IT IS PART OF THIS FILE.
 *
 * IT WAS MODULE-PRIVATE IN App.jsx, AND IT STOPPED BEING PRIVATE THE MOMENT THE
 * DOCUMENT OWNED `layers`. Three things need it now: the reducer, for the value
 * a fresh document starts at; `applyEditor`, which MERGES a saved plan's answer
 * over it rather than assigning; and the test, whose fixture has to agree with
 * both. A second copy of it is a plan that reopens with a layer nobody chose.
 *
 * THE MERGE IS THE WHOLE REASON IT LIVES BESIDE THE READER. A plan saved before
 * a layer existed has no key for it, and assigning the stored object would leave
 * that layer `undefined` — which reads as off, on a sheet whose author never
 * decided. Merged over these, it arrives at the default the rest of the app was
 * written against. See `setLayers` in App's setter bag.
 *
 * THE LOOPING IS OFF BY DEFAULT. A lighting drawing and a wiring drawing are two
 * sheets read by two trades, and the arcs cross the layout everywhere they
 * exist — so they are asked for. Serialised with the rest, so a plan reopens
 * showing whatever it was left showing.
 */
export const LAYER_DEFAULTS = { plan: true, dim: true, region: false, cells: true,
  lights: true, labels: false, fan: true, zones: true, accents: true,
  objects: true, spots: true, switchboards: true,
  electrical: false,
  /* DARK MODE FOR THE DRAWING, AND IT IS A PIXEL INVERSION OF THE SCAN — the
     same thing Cmd-I does in Photoshop, applied to the plan image and nothing
     else. It lives in `layers` because it is a preference about the PICTURE
     rather than a decision about the design, which means it is serialised with
     the rest of them and the plan reopens the way it was left. */
  invert: false };

/**
 * WHAT A LEGAL ZOOM IS, AND THE ONE PLACE IT IS DECIDED.
 *
 * HERE RATHER THAN IN App.jsx BECAUSE THE RESTORE GUARD DEPENDS ON IT. `ui.zoom`
 * is restored behind `if (p.ui.zoom)` — see applyEditor — and that truthiness
 * test is only safe because ZOOM_MIN is above zero, so 0 is unreachable and the
 * guard cannot swallow a real saved value. Two copies of the clamp is one copy
 * that can drift down to 0 while the guard goes on trusting it, silently.
 *
 * READ BY TWO CALLERS: the reducer, which clamps every write, and `fitZoom` in
 * App, which clamps its own result before handing it over.
 */
export const ZOOM_MIN = 0.2, ZOOM_MAX = 6;
export const clampZoom = (z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, +z.toFixed(3)));

export const NOT_UNDOABLE = [
  'focusId', 'selectedOutlineId', 'roomState', 'layers', 'zoom', 'view',
];

/** `focusId` -> `setFocusId`. The naming rule `stateSetters` already follows. */
export const setterFor = (field) => `set${field[0].toUpperCase()}${field.slice(1)}`;

/**
 * THE SAME SIX FIELDS, AS THE KEYS THEY ARE WRITTEN UNDER.
 *
 * A THIRD READER OF THE HOLD-BACK LIST, and it was already a third hand-written
 * COPY of it: `VIEW_FIELDS` in lib/undo.js, which is how `record` decides that a
 * document differs only in the viewport and is not worth a step. Two of the
 * three fields are nested under `ui`, so the list undo.js needs is key PATHS
 * rather than field names — hence this map rather than a second array.
 *
 * !!! `roomState` IS MAPPED TO THE WRONG KEY AND IT IS LEFT THAT WAY. This
 * serialiser writes the field out as `segmentation`, so `undo.js` deleting
 * `roomState` from a serialised document deletes nothing, and a re-run of the
 * room detector therefore counts as a substantive change and pushes an undo
 * step. Undoing that step restores nothing visible, because `applyStep` holds
 * `setRoomState` back — a Ctrl+Z that appears to do nothing.
 *
 * IT IS A PRE-EXISTING DEFECT AND NOT THIS REFACTOR'S TO FIX. Correcting it to
 * `segmentation` removes an undo step that a re-segmentation produces today,
 * which is a change in undo granularity — reportable, not silently acceptable.
 * The wrong value is preserved here EXACTLY so that unifying the three lists
 * changes no behaviour; the fix is a separate decision. See test-plan-state.
 */
export const NOT_UNDOABLE_KEYS = {
  focusId: 'focusId',
  selectedOutlineId: 'selectedOutlineId',
  roomState: 'roomState',        // TODO: should be 'segmentation' — see above
  layers: 'ui.layers',
  zoom: 'ui.zoom',
  view: 'ui.view',
};

/**
 * The editor, as a plain object. `doc` is the plan document — one object, so
 * there is no list of names here to fall out of step with the state itself.
 *
 * `pxPerFt` IS A SECOND, NAMED ARGUMENT AND NOT A FIELD OF THE DOCUMENT, because
 * it is the one thing in the output that is DERIVED — a memo over the scale
 * settings, the source and the doors (see App.jsx). Passing it in by name is
 * what keeps the document honest: a derived value living in `doc` would be a
 * value the reducer cannot own and the undo stack would record as a change.
 *
 * IT IS WRITE-ONLY. Nothing reads `pxPerFtAtSave` back — see the note at
 * `scale` below, and the TODO there.
 */
export function serialiseEditor(doc, { pxPerFt } = {}) {
  const s = doc || {};
  return {
    v: STATE_VERSION,
    savedAt: new Date().toISOString(),

    // --- the drawing's interpretation, not the drawing itself
    unitId: s.unitId ?? null,

    // --- scale. Everything the app needs to arrive at the same px/ft again.
    // pxPerFt itself rides along as a CHECK, not as an input: the restored
    // state recomputes it from these, and a mismatch means the scale rules
    // changed under a saved plan, which is worth knowing.
    //
    // TODO: NOTHING PERFORMS THAT CHECK. `pxPerFtAtSave` has been written since
    // this file was created and no reader has ever compared it to the px/ft the
    // restored state recomputes. The value is there and the comparison is not,
    // so a scale rule changed under a year of saved plans would go unremarked —
    // which is the failure this key was added to catch. Deliberately still not
    // implemented here: it wants a decision about what the app DOES on a
    // mismatch (warn, re-measure, or refuse), and that is a change in behaviour
    // rather than a change in bookkeeping.
    scale: {
      mode: s.scaleMode, refId: s.refId, customFt: s.customFt,
      measure: s.measure, doorPick: s.doorPick, pxPerFtAtSave: pxPerFt ?? null,
    },
    ceilingFt: s.ceilingFt,

    // --- SEGMENTATION: the model's answer and the user's corrections, in one
    // list, which is how the app itself holds them. An outline carries
    // `detected` (it came from the room detector), `reviewed` (a person looked
    // at it) and its points in drawing units — so a diff against the raw
    // detector payload below is what shows the tweak.
    outlines: s.outlines,
    litIds: s.litIds,
    // WHICH LIT SPACES HAVE MOVED SINCE. The difference between the tracer
    // offering "relight 2 changed spaces" and offering the whole sheet, so
    // dropping it on a reload would quietly put the bill back up. See the note
    // on `dirtyIds` in App.jsx.
    dirtyIds: s.dirtyIds,
    focusId: s.focusId ?? null,
    selectedOutlineId: s.selectedOutlineId ?? null,
    // The segmenter's own reply, unedited, kept beside the edited version for
    // exactly the reason above.
    segmentation: s.roomState?.status === 'done'
      ? { status: 'done', proposed: s.roomState.proposed ?? null, meta: s.roomState.meta ?? null,
          count: s.roomState.count ?? null, ms: s.roomState.ms ?? null }
      : null,

    // --- what kind of building, and what kind of room
    projectType: s.projectType ?? null,        // 'residential' | 'hospitality' | ...
    roomTypes: s.roomTypes,
    // WHICH SHEET OF A DRAWING SET THIS PLAN IS. Part of the plan's identity
    // rather than of its state: it has to be known BEFORE the file is rendered,
    // so routes/Planner.jsx reads it straight off the row and hands it to the
    // editor as a prop. Null for images and DXFs.
    pdfPage: s.pdfPage ?? null,

    // --- furniture and beds
    detections: s.detections,
    dismissed: s.dismissed,
    bedVerdicts: s.bedVerdicts,
    provider: s.provider,
    zones: s.zones,

    // --- doors. (Fans used to live here too, from the red-circle detector that
    // has since been removed; a fan is now a ceiling object like any other and
    // is saved with them below.)
    doors: s.doors,
    // WHETHER SOMEBODY HAS CONFIRMED THAT SET IS COMPLETE, which is what the
    // electrical layer is gated behind — see the note on `doorsOk` in App.jsx.
    // A DECISION AND NOT A SCREEN: the editor it is answered in is not saved,
    // so a plan never reopens mid-edit, but the answer is part of the design and
    // asking for it twice would be asking somebody to redo work they have done.
    doorsOk: s.doorsOk ?? false,

    // --- the ceiling as edited
    ceilingObjs: s.ceilingObjs,
    chunkPicks: s.chunkPicks,
    // WHAT EACH PIECE OF CEILING IS: outline id -> { chunk key -> option id }.
    // Small, and it must be kept — the layout is a memo over it, so a plan
    // reopened without this comes back as flat ceilings everywhere and silently
    // loses every cove in the job.
    designPicks: s.designPicks,
    // THE OLD ANSWER, WRITTEN BACK UNCHANGED. `ceilingKinds` was one word per
    // space — outline id -> 'cove' — before the decision moved to the chunk. No
    // UI writes it any more, and it is still saved so that a plan made under the
    // old switch keeps reopening with its coves in place however many times it
    // is saved in between. See the note on `designPicks` in App.jsx.
    // (`covePicks` — which of the rectangles in a space the cove was set out in
    // — is gone with the question: a cove is set out in a CHUNK now, and the
    // chunk is the thing that was picked.)
    ceilingKinds: s.ceilingKinds,
    /* THE COVES SOMEBODY DREW. Plan-space FEET, so a plan reopened after its
       scale was corrected has its shapes at the size they were set out at
       rather than at the size they happened to be on screen.

       IT HAS TO BE KEPT FOR THE SAME REASON `designPicks` does, and the failure
       is worse: the layout is a memo over this list, so a plan reopened without
       it comes back with the grid un-cut, the strips gone from the schedule, and
       no mark on the drawing to say anything was ever there. A cove that was
       chosen from a pill can at least be seen to be missing.
       Optional on read — see applyEditor — because every plan saved before this
       existed has no key here. */
    ceilingShapes: s.ceilingShapes,
    /* WHERE SOMEBODY DRAGGED A LIGHT TO: outline id -> cell key -> offset from
       that cell's own centre, in feet.

       AN OVERRIDE AND NOT A LAYOUT. The lights themselves are never saved —
       they are a memo over everything else in this file, and re-deriving them is
       what makes a reopened plan agree with the rules rather than with a
       snapshot. This is the small set of places a person overruled the rules,
       and it is exactly the same kind of record `boardMoves` and `runTrims` are.

       KEYED BY THE CELL'S GEOMETRY, which is what makes it safe to keep: a plan
       reopened after its grid was re-cut simply finds no cell of that name and
       the offset lapses, rather than moving some other lamp by a foot. See
       `cellKey` in planner.js.
       Optional on read — see applyEditor — because every plan saved before this
       existed has no key here. */
    lightMoves: s.lightMoves,

    // --- the two model-proposed layers, and the fittings added by hand
    accentResults: s.accentResults,
    accentDismissed: s.accentDismissed,
    manualAccents: s.manualAccents,
    surfaceResults: s.surfaceResults,
    surfaceDismissed: s.surfaceDismissed,
    manualSurfaces: s.manualSurfaces,
    // THE PIECES OF ART SOMEBODY DECIDED NOT TO LIGHT.
    //
    // A third dismissal list rather than a flag on the wall element, and for the
    // reason `accentDismissed` is separate too: the element belongs to the render
    // pass's answer, which is a record of what the model saw, and re-running that
    // pass must not be able to overwrite a decision a person made about it.
    // "There is a painting on this wall" and "do not light it" are two facts and
    // they have two owners.
    artDismissed: s.artDismissed,

    // --- the render pass's reading of the walls.
    //
    // THE ANSWER IS KEPT; THE RENDERS ARE NOT. The elements are a few hundred
    // bytes of English and cell references per room, and they are exactly the
    // kind of thing that must survive a reload — they came from an upload
    // somebody did by hand and cost two reasoning calls to produce.
    //
    // The render BYTES are still not in here, and never will be: megabytes of
    // somebody's photographs in a jsonb column would multiply the row size by a
    // hundred, and this column is read in full every time a plan is opened.
    // They go to the bucket instead (db.uploadRender) and this column keeps the
    // POINTERS — see renderRefs below.
    wallResults: s.wallResults,
    // ...and the lengths somebody dragged on the fittings the pass produced.
    // Two numbers per run, in feet, and the only thing about a reverse cove or a
    // shelf strip that a person chose rather than a rule derived — which is
    // exactly the test for what belongs in this column. See trimWallRun.
    runTrims: s.runTrims,
    /* THE REVERSE COVES SET OUT BY HAND.
       A SEPARATE COLUMN FROM `runTrims`, AND NOT A FLAG ON ANYTHING. The same
       split this file already makes twice — `accentDismissed` beside
       `accentResults`, `manualAccents` beside them both — and for the same
       reason: everything in `wallResults` is a record of what the render pass
       SAW, and re-running that pass must be free to replace all of it. A slot
       somebody drew on a wall is not the pass's to overwrite, so it is stored
       where the pass cannot reach.
       IT CARRIES ITS OWN GEOMETRY, unlike a detected cove. A detected one is
       re-derived from the wall finding on every open and needs only its trim
       kept; a hand-placed one has no finding behind it, so the band, the run and
       the wall it was set out on are the record. That is also why it survives a
       plan being reopened with the render pass never re-run.
       Optional on read — see applyEditor — because every plan saved before this
       existed has no key here, and an empty list is the honest reading. */
    manualCoves: s.manualCoves,
    /* THE DRAWN TRACKS, kept for the reason `manualCoves` is and with the same
       shape of argument: a run has no finding behind it to be re-derived from,
       so the path IS the record. It is stored in the plan's own feet, which is
       what makes it survive a scale correction — see `manualTracks` in App. */
    manualTracks: s.manualTracks,
    /* THE RECESSED COBs SOMEBODY PUT DOWN, kept for the reason `manualCoves` and
       `manualTracks` are and with the same shape of argument, plus one of its
       own. The shared reason: there is no finding and no solver behind a
       hand-placed lamp, so the fitting IS the record and losing it loses the
       fitting — a reopened plan would come back with a ceiling somebody had laid
       out by hand simply empty.
       THE ONE OF ITS OWN IS THE SPECIFICATION. Each lamp carries the wattage and
       the beam angle it was placed at, and those are not derivable from anything
       else in this column: the engine's recommendation for that point can be
       recomputed, but the decision to overrule it cannot. It is stored in plan
       FEET for the reason the two above it are — a plan reopened after its scale
       was corrected has its lamps where they were set out.
       Optional on read — see applyEditor — because every plan saved before this
       existed has no key here, and an empty list is the honest reading. */
    manualCobs: s.manualCobs,
    /* WHICH SPACES FILL THEIR OWN GRID. A list of outline ids, and it is kept
       for the reason `ceilingKinds` is rather than the reason `manualCobs` is:
       the LAMPS are already in the column above, so nothing is lost by
       forgetting this — except the switch's own position, which is a decision
       about the ceiling ("this space is laid out automatically") and reads as
       broken when it comes back off with its lamps still on the drawing.
       Optional on read — see applyEditor — because every plan saved before this
       existed has no key here. */
    autoSpots: s.autoSpots,
    /* THE ARRAYS OF SPOTS SET OUT ON A GEOMETRY. What is kept is the
       INSTRUCTION — which geometry, how many, which side, how far off — and not
       the lamps it works out to, which is the whole point of an array: the
       geometry is kept in `ceilingShapes` beside it, and reopening a plan
       re-derives the fittings from the two. A stored list of points would come
       back disagreeing with a shape that had been edited since.
       Optional on read, like everything added after the column existed. */
    cobArrays: s.cobArrays,
    /* THE MODULES CLIPPED INTO A MAGNETIC TRACK. The RUN is not here — it is a
       ceiling shape with `role: 'track'` and is already saved with the rest of
       `ceilingShapes`, which is the whole reason a track resizes, duplicates and
       snaps like everything else in the geometry library. What is kept is which
       run each module is on, which module it is, and the FRACTION of the run it
       sits at: reopening a plan resolves the positions from the shape and these,
       exactly as an array's lamps are resolved. See lib/magTrack.js.
       Optional on read, like everything added after the column existed. */
    trackFixtures: s.trackFixtures,
    // ...and where the views went.
    //
    // A PATH AND ITS DIMENSIONS, which is about ninety bytes per render, and it
    // buys two things. The obvious one: reopening a plan shows the pictures the
    // pass was run on instead of an empty drop target under a room full of
    // reverse coves nobody can account for, and re-running does not mean finding
    // the files again.
    //
    // The one that matters more: a render, the JSON the model returned for it
    // and the design that came out the other side are ONE TRAINING ROW, and a
    // revision already carries this whole object. Storing the pointer here is
    // what makes that row assemblable later. The sizes are recorded rather than
    // re-derived because they describe what was SENT — the model saw a 1400px
    // JPEG at quality 0.82, and that fact is part of the row.
    renderRefs: s.renderRefs,

    /* --- the electricals. ONE LIST, AND IT IS THE DELETIONS.
       `sbResults` WAS HERE — the on-demand pass's answer, keyed by room. Both
       the pass and the key are gone: the switchboard rules read the door boxes,
       the placed sconces and the bed box, so the boards are derived on every
       render and there is no answer left to store. A plan saved under the old
       shape still has that key in its column; nothing reads it, and the next
       save drops it.

       WHAT IS STORED NOW IS THE OPPOSITE — not what the rules said, but which of
       their plates a person threw away. It has to be stored for exactly the
       reason a derived fitting's dismissal always does: removing a board from a
       list it is computed into does not remove it, it removes it until the next
       render. Same shape and same argument as `accentDismissed` and
       `artDismissed` above.

       BY ID, AND THE IDS ARE STABLE FOR THIS. See the note on `id` in
       electrical.js: a board is `sb-<room>-<rule>`, keyed to the thing the rule
       fired off, so a stored deletion cannot slide onto a different plate when
       another rule starts firing. */
    boardsOff: s.boardsOff ?? [],
    /* ...AND WHERE THEY DRAGGED ONE TO: board id -> how far round that space's
       walls, in FEET.

       IT HAS TO SURVIVE A RELOAD OR THE FEATURE DOES NOT EXIST. A board is
       derived on every render, so this map is the only record that a plate is
       anywhere other than where the rule put it — drop it and the switch walks
       back to the door the next time the plan is opened, which is worse than not
       being able to move it at all.

       FEET, WHICH IS WHAT MAKES IT SAFE TO STORE. Arc length round the room's
       wall runs from their own starting corner — see `wallPath` in
       electrical.js. Not a point in plan pixels, which moves the day somebody
       corrects a door width; and not a run index, which renumbers the day
       somebody re-traces a corner. `runTrims` above is stored in feet for the
       first of those reasons and this is the second one as well. */
    boardMoves: s.boardMoves ?? {},
    /* ...AND WHAT THEY PUT ON ONE: board id -> `[{ id, kind, amps, label }]`.

       THE SAME ARGUMENT A THIRD TIME. A plate's composition is derived from the
       flows that run back to it (see switchboards.js), so a 16A socket somebody
       added for an air conditioner exists nowhere in the derivation and is gone
       on the next render unless it is stored. Deletions, positions, additions:
       three stores, one reason.

       THE POINT'S OWN ID IS IN THE RECORD and is generated when it is added,
       because two 6A sockets on one plate are two rows a person can remove
       independently and `{kind, amps}` cannot tell them apart. */
    boardPoints: s.boardPoints ?? {},
    /* --- AND THE TWO THINGS A PERSON DECIDES ABOUT A WIRE.

       `flowBoards` is flow id -> board id: which plate a loop runs off, where
       the rules' nearest-plate answer is not the one wanted. `flowBends` is
       flow id -> { leg key -> feet }: how far each arc is nudged off where the
       rule bows it, as a DELTA, in feet for the same reason `runTrims` and
       `boardMoves` are in feet.

       THE SAME ARGUMENT AS EVERY OTHER OVERRIDE HERE — a flow is derived on
       every render, so both of these are the only record that a wire is
       anywhere other than where the rules put it.

       AND THE FLOW IDS ARE STABLE ENOUGH TO STORE, which they were not before
       this pair existed. See the note by `id` in flows.js: they used to be a
       counter, and a counter would have moved somebody's reassignment onto a
       different wire the first time a light was added to an earlier chunk. */
    flowBoards: s.flowBoards ?? {},
    flowBends: s.flowBends ?? {},
    /* --- AND THE PLATES SOMEBODY PUT ON A WALL THEMSELVES.
       `[{ id, roomId, sFt }]` — how far round that room's walls each one sits,
       in feet, which is the same coordinate `boardMoves` above stores and is
       stored that way for the same two reasons.

       THE ODD ONE OUT IN THIS BLOCK, AND WORTH SAYING SO. Everything else here
       modifies something a rule produced: a deletion, a position, an assignment,
       a bend. Nothing derives these plates at all — no pass proposes one, so
       there is no answer for this to override. The list IS the fact, the way
       `manualCoves` and `manualAccents` are, and losing it loses the boards
       rather than losing an adjustment to them. */
    manualBoards: s.manualBoards ?? [],
    /* ...AND WHICH OF THE TWO THINGS EACH PLATE IS: board id ->
       `{ outlet, amps }`.

       A SOCKET OUTLET IS ONE SOCKET AND NO SWITCH, and a switchboard is
       everything else; either can be turned into the other, including a plate a
       rule placed — adding any point to an outlet makes it a board, and one
       press makes a board an outlet. What is stored is only what somebody CHANGED — a plate with
       no entry here is whatever it was born as, hand-placed ones being outlets
       and rule-placed ones boards — so an entry that only restated the default
       is deleted rather than written. See `setBoardOutlet` in App.jsx.

       THE RATING LIVES HERE AND NOT ON `manualBoards` ABOVE, for one reason: it
       has to survive the conversion. A 16A outlet ticked into a switchboard is a
       board with a 16A socket on it, and a rating stored against the outlet
       would have been lost on the way through. */
    boardKinds: s.boardKinds ?? {},
    /* ...AND HOW HIGH EACH ONE IS SET: board id -> millimetres above finished
       floor level.

       THE ONE THING ABOUT A SWITCHBOARD A PLAN VIEW CANNOT SHOW. A plate is the
       same rectangle from above at 300mm as at 1200mm, and the difference
       between those two numbers is the difference between a socket and a switch.
       The rules have a default per role (SB_HEIGHT_MM in electrical.js) and a
       default is all it can be — 1200 is switch height in most of the world and
       1100 in some offices — so what is stored here is the plates somebody
       actually set, and nothing else.

       THE PRIMARY HEIGHT ONLY. The wall facing a bed is two plates at two
       heights, which is what makes it two; an override replaces the first of
       that list and leaves the second alone. See `withMode` in
       features/electrical/useBoardRules.js. */
    boardHeights: s.boardHeights ?? {},
    /* ...AND THE ORDER ITS MODULES SIT IN: board id -> an array of unit keys,
       left to right.

       WHICH SWITCH IS LEFTMOST IS NOT DERIVABLE. It is which one your hand finds
       walking through the door, and that depends on the side the door is on, on
       which lamp matters most, and on what the client is used to. The rules pick
       an order that reads well; this is the one somebody chose.

       UNIT KEYS AND NOT MODULE INDICES. A fan's switch and its regulator are one
       unit, and so are a socket and the switch that controls it, so what is
       stored cannot express an arrangement in which either pair comes apart. A
       key also survives the plate gaining a fitting, where an index would not —
       see `orderUnits` in switchboards.js for what happens to keys it has never
       heard of and keys whose fitting has gone. */
    boardOrders: s.boardOrders ?? {},

    // --- view preferences. Cheap, and jarring to lose.
    /* --- WHAT EACH SPACE IS, BEFORE ANYTHING IS PUT IN IT -------------------
       `ceilingMm` is room id -> height to the slab in millimetres, and
       `materials` is room id -> `{ ceiling, floor, walls }` where `walls` is
       edge index -> tone. See lib/materials.js.

       BOTH ARE SPARSE, AND THAT IS THE POINT. A room with no entry is a room at
       the defaults — 2700 and light on all three surfaces — so a plan nobody has
       touched the finishes on stores nothing at all, and a space traced next
       week arrives at the same defaults as the ones traced today. It is the same
       rule `boardKinds` follows: what is stored is what somebody CHANGED.

       THEY HAVE TO BE KEPT OR THE FEATURE DOES NOT EXIST. Unlike the lights,
       which are a memo over everything else in this file and are re-derived on
       every open, there is nothing to re-derive a finish FROM — the walls are
       what somebody said, and losing them loses the answer rather than an
       adjustment to it. Same argument as `manualCoves`.

       Optional on read — see applyEditor — because every plan saved before this
       existed has no key here. */
    ceilingMm: s.ceilingMm ?? {},
    materials: s.materials ?? {},
    /* WHAT WATTAGE EACH FITTING IS, ROOM BY ROOM — room id -> row key -> watts.
       THE KEY IS THE ROW AND NOT THE FAMILY, because what a row is depends on
       what the fitting is: anything sold by the metre is one row per RUN and is
       keyed by that run's own id, and anything sold by the piece is one row for
       the lot and is keyed by its family. See `fixtureGroups` in
       features/lighting-planner/lightingRules.js for who decides, and
       FIXTURE_FAMILIES in lib/lumens.js for the defaults.
       A RUN'S ID IS SAFE TO STORE FOR THE REASON `runTrims` AND `accentDismissed`
       ARE — it is the same handle. A run that stops existing simply takes its
       entry out of use; the entry lapses rather than landing on some other
       fitting, exactly as a `lightMoves` offset does when its cell is re-cut.
       SPARSE ON THE SAME RULE AS ITS TWO NEIGHBOURS: a row at its family's
       default stores nothing, so a plan nobody has touched the wattages on
       carries an empty object — and a default changed in lumens.js tomorrow
       moves every plan that never overruled it.
       Optional on read — every plan saved before this existed has no key. */
    fixtureWatts: s.fixtureWatts ?? {},
    /* THE DERIVED RUNS SOMEBODY DELETED — reverse coves and shelf strips, by
       their own ids. See the note on the state in App.
       IT HAS TO BE KEPT FOR THE REASON EVERY DISMISSAL IN THIS FILE DOES:
       both are re-derived from `wallResults` on every open, so a deletion that
       is not recorded is a run that comes back the next time the plan is
       opened. Same argument as `accentDismissed`, `artDismissed` and
       `boardsOff`; a different list because it is applied in a different place —
       where the RUN is built rather than where its tape is.
       Optional on read — every plan saved before this existed has no key, and an
       empty list is the honest reading. */
    runsOff: s.runsOff ?? [],

    ui: { layers: s.layers, zoom: s.zoom, view: s.view },
  };
}

/**
 * Put it back. `set` is App's setters, named identically to the fields above.
 *
 * EVERY ASSIGNMENT IS GUARDED with `??` against the stored value being absent,
 * because a row written by an older version of this file is a normal thing to
 * meet and must restore what it does have rather than blanking the rest.
 */
export function applyEditor(p, set) {
  if (!p) return;

  set.setUnitId(p.unitId ?? null);

  const sc = p.scale || {};
  if (sc.mode) set.setScaleMode(sc.mode);
  if (sc.refId) set.setRefId(sc.refId);
  if (sc.customFt != null) set.setCustomFt(sc.customFt);
  if (sc.measure) set.setMeasure(sc.measure);
  set.setDoorPick(sc.doorPick ?? null);
  if (p.ceilingFt != null) set.setCeilingFt(p.ceilingFt);

  set.setOutlines(p.outlines ?? []);
  set.setLitIds(p.litIds ?? []);
  set.setDirtyIds(p.dirtyIds ?? []);
  set.setFocusId(p.focusId ?? null);
  set.setSelectedOutlineId(p.selectedOutlineId ?? null);
  // The detector's status is restored as 'done' with its count so the tracer
  // does not offer to run a segmentation whose answer is already on screen.
  set.setRoomState(p.segmentation
    ? { status: 'done', restored: true, count: p.segmentation.count ?? (p.outlines?.length ?? 0),
        meta: p.segmentation.meta ?? null, ms: p.segmentation.ms ?? null }
    : { status: 'idle' });

  set.setProjectType(p.projectType ?? null);
  set.setPdfPage(p.pdfPage ?? null);
  set.setRoomTypes(p.roomTypes ?? {});

  set.setDetections(p.detections ?? []);
  set.setDismissed(p.dismissed ?? []);
  set.setBedVerdicts(p.bedVerdicts ?? {});
  if (p.provider) set.setProvider(p.provider);
  set.setZones(p.zones ?? []);

  set.setDoors(p.doors ?? []);
  /* GRANDFATHERED OFF THE LAYER. A plan saved before this key existed has no
     answer here, and `false` would be the wrong reading of that for the ones
     that were already showing their wiring: it would take the electricals off a
     finished sheet and put a question in front of somebody who has been looking
     at the loops for a week. Having the layer on IS the old evidence that the
     electricals were wanted, so it stands in for the confirmation once. */
  set.setDoorsOk(p.doorsOk ?? !!p.ui?.layers?.electrical);
  set.setDoorState((p.doors?.length ?? 0)
    ? { status: 'done', restored: true, count: p.doors.length, rejected: [] }
    : { status: 'idle' });
  set.setDetectState((p.detections?.length ?? 0)
    ? { status: 'done', restored: true, count: p.detections.length, rejected: [] }
    : { status: 'idle' });

  set.setCeilingObjs(p.ceilingObjs ?? []);
  set.setChunkPicks(p.chunkPicks ?? {});
  set.setCeilingKinds(p.ceilingKinds ?? {});
  set.setDesignPicks(p.designPicks ?? {});

  set.setAccentResults(p.accentResults ?? {});
  set.setAccentDismissed(p.accentDismissed ?? []);
  set.setManualAccents(p.manualAccents ?? []);
  set.setSurfaceResults(p.surfaceResults ?? {});
  set.setSurfaceDismissed(p.surfaceDismissed ?? []);
  set.setManualSurfaces(p.manualSurfaces ?? []);
  // Optional on purpose: a plan saved before this existed has no key here, and
  // the default is the honest reading of that — nothing was dismissed.
  set.setArtDismissed?.(p.artDismissed ?? []);
  set.setWallResults?.(p.wallResults ?? {});
  set.setRunTrims?.(p.runTrims ?? {});
  set.setManualCoves?.(p.manualCoves ?? []);
  set.setManualTracks?.(p.manualTracks ?? []);
  set.setManualCobs?.(p.manualCobs ?? []);
  set.setAutoSpots?.(p.autoSpots ?? []);
  set.setCobArrays?.(p.cobArrays ?? []);
  set.setTrackFixtures?.(p.trackFixtures ?? []);
  set.setCeilingShapes?.(p.ceilingShapes ?? []);
  set.setLightMoves?.(p.lightMoves ?? {});
  // THE POINTERS, NOT THE PIXELS. App fetches the bytes back from the bucket
  // afterwards and only for the space that is open — see the rehydrate effect.
  set.setRenderRefs?.(p.renderRefs ?? {});
  set.setBoardsOff?.(p.boardsOff ?? []);
  set.setBoardMoves?.(p.boardMoves ?? {});
  set.setBoardPoints?.(p.boardPoints ?? {});
  set.setFlowBoards?.(p.flowBoards ?? {});
  set.setFlowBends?.(p.flowBends ?? {});
  set.setManualBoards?.(p.manualBoards ?? []);
  set.setBoardKinds?.(p.boardKinds ?? {});
  set.setBoardHeights?.(p.boardHeights ?? {});
  set.setBoardOrders?.(p.boardOrders ?? {});

  set.setCeilingMm?.(p.ceilingMm ?? {});
  set.setMaterials?.(p.materials ?? {});
  set.setFixtureWatts?.(p.fixtureWatts ?? {});
  set.setRunsOff?.(p.runsOff ?? []);

  if (p.ui?.layers) set.setLayers(p.ui.layers);
  /* THE TRUTHINESS GUARD IS ONLY SAFE BECAUSE ZOOM IS CLAMPED. Every write goes
     through `clampZoom` — exported above, applied by the document reducer on
     every write, and applied by `fitZoom` in App to its own result — so with
     ZOOM_MIN at 0.2 a stored 0 is unreachable and `if (p.ui.zoom)` cannot
     swallow a real saved value. If that clamp ever admits 0 this line becomes a
     silent bug: a plan saved at zoom 0 would reopen at 1 with nothing to say it
     moved. There is a test on the pair. */
  if (p.ui?.zoom) set.setZoom(p.ui.zoom);
  if (p.ui?.view) set.setView(p.ui.view);
}

/**
 * The card's numbers. Small, flat, and read by the project page — which is why
 * they are a column of their own rather than something dug out of design_json:
 * a list of eight plans should not pull eight lighting designs over the wire to
 * print "12 lights".
 */
export function statsFrom({ totals, rooms, boq }) {
  return {
    rooms: totals?.rooms ?? 0,
    roomsFailed: totals?.failed ?? 0,
    lights: totals?.lights ?? 0,
    coves: totals?.coves ?? 0,
    areaSqft: totals?.areaSqft != null ? +totals.areaSqft.toFixed(1) : 0,
    lumens: totals?.lumens ?? 0,
    fittingLines: boq?.lines?.length ?? boq?.rows?.length ?? 0,
    outlines: rooms?.length ?? 0,
  };
}

/**
 * `uploaded` → `tracing` → `ready`. Drawn from what actually exists rather than
 * set by hand at each step, because a status set by hand is a status that is
 * wrong after any path nobody thought about.
 */
export function statusFrom({ outlines, litIds, totals }) {
  if (totals?.rooms) return 'ready';
  if (litIds?.length) return 'planning';
  if (outlines?.length) return 'tracing';
  return 'uploaded';
}
