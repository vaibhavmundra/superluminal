// src/hooks/usePlanDoc.js — THE PLAN DOCUMENT, AS ONE REDUCER.
//
// WHAT THIS IS FOR. `serialiseEditor` and `applyEditor` in lib/planState.js are
// two hand-written lists of the same sixty-one fields, and App.jsx held a THIRD
// — the `editorState` memo, which named every one of them twice, once in the
// object and once in its dependency array. Three lists, nothing checking any of
// them against the others, and the failure when they drift is silent: a field
// added to two of the three is a user's edit that is quietly not saved, or a
// value that never re-renders the thing that persists it.
//
// The document is ONE OBJECT now. `editorState` is a memo over `doc` and one
// named derived argument, so there is no list in App.jsx left to forget a field
// in, and the reducer's own field table is what the test walks.
//
// WHAT IS NOT IN HERE, AND MUST NOT BE.
//
//   SESSION state — the view, the open panel, the detector's status, the busy
//   string. It survives a re-render and not a reload, nothing serialises it, and
//   folding it in would put a panel being opened into the undo stack.
//
//   GESTURE state — drags, drafts, ghosts, hovers, the rubber band. It lives for
//   one interaction. Folding it in would put forty documents into a single drag.
//
//   ANYTHING DERIVED. See the note on `pxPerFt` in planState.js: a derived value
//   in the document is a value that changes identity when its own inputs change,
//   which produces a new document, which the autosave effect writes, which
//   re-renders, which produces a new document. That is the infinite save loop
//   the comment on `editorState` has been warning about, and keeping the
//   document to state the reducer OWNS is what makes it structural rather than
//   a rule somebody has to remember.
//
// IDENTITY STABILITY IS LOAD-BEARING AND IT IS THE WHOLE OF THE UNDO BEHAVIOUR.
// The undo stack records a step on a QUIET_MS debounce over `editorState`'s
// IDENTITY, so a reducer that returns a fresh object for an edit that changed
// nothing produces an undo step for a no-op — a Ctrl+Z that appears to do
// nothing, which is worse than no undo at all. Every case below returns the
// state object UNCHANGED when the value it would write is the value already
// there, exactly as the `useState` updaters it replaces did. `same` is how, and
// there is a test for it.
import { useReducer, useMemo } from 'react';
import { NOT_UNDOABLE, setterFor, LAYER_DEFAULTS, clampZoom }
  from '../lib/planState.js';
import { materialsOf } from '../lib/materials.js';
import { clampWatts, nearestBeam } from '../lib/cob.js';
import { DEFAULT_PROVIDER } from '../lib/furniture.js';
import { withSweep } from '../lib/ceilingObjects.js';

/* --- THE FIELDS, AND THE ONLY LIST OF THEM --------------------------------
   Field name -> what it starts as. The initial value is a FUNCTION because
   objects and arrays here are mutable defaults: one shared `{}` handed to every
   field would make two fields the same object.

   THIS TABLE IS THE DOCUMENT. `serialiseEditor` reads the object it produces,
   `applyEditor` writes into it, the undo stack diffs it, and the test asserts
   all three cover exactly these names. Adding a field is adding a line here.

   THE MIGRATION IS COMPLETE. All sixty-one fields live here. `editorState` in
   App.jsx is a memo over `doc` and one named derived argument — `pxPerFt` — so
   there is no longer any list of field names in that file to fall out of step
   with this one. The test's coverage walk is what says so, and what will say so
   again the first time somebody adds a field to two of the three places. */
export const DOC_FIELDS = {
  /* --- domain 1: the sparse per-room maps ---------------------------------- */
  // room id -> height to the slab in millimetres. Sparse: a room with no entry
  // is a room at DEFAULT_CEILING_MM. See planState.js.
  ceilingMm: () => ({}),
  // room id -> { ceiling, floor, walls } where walls is edge index -> tone.
  // Sparse on the same rule, and for the same reason.
  materials: () => ({}),
  // room id -> row key -> watts. Sparse: a row at its family's default stores
  // nothing, so a default changed in lumens.js moves every plan that never
  // overruled it.
  fixtureWatts: () => ({}),

  /* --- domain 2: the fittings and runs somebody put down by hand -----------
     ALL SEVEN ARE THE RECORD AND NOT AN ADJUSTMENT TO ONE. There is no finding
     and no solver behind a hand-placed lamp or a drawn path, so the entry IS
     the fitting and losing it loses the work — see planState.js. Stored in the
     plan's own FEET, which is what makes them survive a scale correction. */
  manualCoves: () => ([]),
  manualTracks: () => ([]),
  manualCobs: () => ([]),
  cobArrays: () => ([]),
  trackFixtures: () => ([]),
  /* A LIST OF OUTLINE IDS AND NOT OF OBJECTS, which is why it has its own two
     actions below. Migrated with this domain rather than a later one because
     one gesture writes it and `manualCobs` together — see `setAutoplace` — and
     splitting that across a reducer and a `useState` would put half of one act
     in each. */
  autoSpots: () => ([]),

  /* --- domain 3: the ceiling's geometry and the decisions about it ---------- */
  // A list of shapes in plan FEET — coves, guides and magnetic-track runs. The
  // grid is cut on their bounding boxes, so losing them un-cuts every ceiling.
  ceilingShapes: () => ([]),
  // outline id -> { chunk key -> option id }. The layout is a memo over it, so
  // a plan reopened without this comes back as flat ceilings everywhere.
  designPicks: () => ({}),
  /* THE OLD ANSWER, AND NO UI WRITES IT ANY MORE. One word per space, from
     before the decision moved to the chunk. It is still in the document so that
     a plan made under the old switch keeps reopening with its coves however
     many times it is saved in between — so the only action it has is the reset.
     See planState.js. */
  ceilingKinds: () => ({}),
  // outline id -> strategy id: how to read the space. Absent means "whatever is
  // recommended", which is what makes lighting eight rooms one act.
  chunkPicks: () => ({}),

  /* --- domain 4: the two model-proposed layers, the walls, and the doors ----
     THE SPLIT BETWEEN A PASS'S ANSWER AND A DECISION ABOUT IT IS THE WHOLE
     SHAPE OF THIS DOMAIN, and it is why there are nine fields here where a
     first reading of the feature would want three. `accentResults` is a record
     of what the model SAW and re-running the pass is free to replace all of it;
     `accentDismissed` is what a person then said about it and the pass must not
     be able to overwrite that; `manualAccents` has no pass behind it at all, so
     the entry IS the fitting. Three facts, three owners — see planState.js,
     which makes the same argument at length. */

  // room id -> the accent pass's parsed reply, boxes in PLAN px. Keyed by
  // outline id throughout, so switching rooms in the panel does not lose the
  // answer the last one gave.
  accentResults: () => ({}),
  // ...AND THE FITTINGS SOMEBODY THREW OUT, by their own ids. It has to be kept
  // for the reason every dismissal in planState.js does: an accent is rebuilt
  // from the pass's answer on every render, so "not this one" only exists as
  // long as this list does.
  accentDismissed: () => ([]),
  /* THE STRIPS AND SCONCES PLACED FROM THE PALETTE. A flat list, in PLAN px and
     not feet — see the note on `updateAccentZone` in
     features/room-intelligence/useAccentEditing.js: an accent lives on a
     wall in the space it was placed in, and converting to feet and back would
     add two roundings to every drag. No pass proposes one, so the list IS the
     fact the way `manualCoves` is. */
  manualAccents: () => ([]),

  // room id -> the task-surface pass's reply, and the same three-way split
  // again: the answer, the dismissals, and the ones drawn by hand.
  surfaceResults: () => ({}),
  surfaceDismissed: () => ([]),
  manualSurfaces: () => ([]),
  /* THE ART SOMEBODY DECIDED NOT TO LIGHT, by wall-element id. A THIRD
     dismissal list and not a flag on the wall element, for the reason
     `accentDismissed` is separate too: "there is a painting on this wall" and
     "do not light it" are two facts and they have two owners. Deleting a spot
     aimed at a painting takes the piece out of the LIGHTING design, not out of
     the render pass's reading of the wall. */
  artDismissed: () => ([]),

  /* THE RENDER PASS'S READING OF THE WALLS: room id -> { elements }. THE ANSWER
     IS KEPT AND THE RENDERS ARE NOT — a few hundred bytes of English and cell
     references per room, against megabytes of somebody's photographs. The bytes
     go to the bucket and `renderRefs` keeps the pointers. See planState.js. */
  wallResults: () => ({}),
  /* THE LENGTHS SOMEBODY CHANGED BY HAND: run id -> { a, b } in FEET.
     Reverse coves and shelf strips are DERIVED, not placed, so what is stored
     is the EDIT and not the result — see `trimWallRun` in
     features/scene/wallGeometry.js. Two numbers per
     run: how far each end moved from where the rule put it. Everything else
     stays derived, so a trimmed cove still follows its wall when the outline
     moves and still redraws at the right size when the scale changes.
     Keyed by the run's own id rather than per room, because a room can hold
     several and they are edited one at a time. */
  runTrims: () => ({}),
  /* THE DERIVED RUNS SOMEBODY DELETED, by the run's own id — `rcove-<element>-<n>`
     or `shelf-<element>-<n>`, two namespaces that cannot collide, which is what
     lets one list serve both.
     A SECOND DISMISSAL LIST BECAUSE IT IS APPLIED IN A DIFFERENT PLACE. An
     accent zone is filtered where the accent zones are built; a reverse cove
     has to be filtered where the COVE is built, or the tape would go and the
     slot it sits in would stay. That was a real bug — the id went in, nothing
     read it, and the run stayed on the sheet.
     A HAND-PLACED COVE IS NOT IN HERE AT ALL: it has a store of its own
     (`manualCoves`) and is removed from that instead, because a dismissal for a
     thing with no generator would suppress an id for the life of the plan long
     after the thing itself was gone. */
  runsOff: () => ([]),

  // The doors found on upload, and the ones drawn in by hand. Read by the scale
  // (one of them is the ruler), by the board pass and by the flows, which is why
  // `doorDrag` holds a live rect and only the release writes here.
  doors: () => ([]),
  /* WHETHER A PERSON HAS SAID THAT SET IS COMPLETE, which is the gate the
     electrical layer sits behind. NOT RE-DETECTED: a second model call would
     come back with the same recall and no way for anybody to tell, so it is
     asked once and by a person.
     A DECISION AND NOT A SCREEN. `doorsOk` is saved and `doorEdit` is not, so
     reopening a plan whose doors were confirmed does not ask again and does not
     reopen mid-edit either. Grandfathered on read — see applyEditor. */
  doorsOk: () => false,
  /* THE NO-LIGHT RECTANGLES, in image px: { id, x0, y0, x1, y1 }.
     DELIBERATELY NOT THE SAME THING AS A DETECTION. A detection is a property of
     the IMAGE and is found once; whether it is a no-light zone depends on which
     room is being lit. Keeping them apart is what lets the detection run before
     a boundary exists. */
  zones: () => ([]),

  /* --- domain 5: the electricals -------------------------------------------
     EIGHT OF THE NINE ARE AN OVERRIDE OF SOMETHING A RULE PRODUCED, and that is
     the whole shape of this domain. A switchboard and a wire are DERIVED on
     every render — from the door boxes, the placed sconces and the bed box —
     so there is no answer to store and there never was: `sbResults`, the
     on-demand pass's stored reply, used to be here and both it and the pass are
     gone. What has to survive a reload is what a person did to the derivation,
     because a change that is not stored is a change the next render undoes.
     `manualBoards` IS THE ODD ONE OUT and it says so in its own note. */

  // Board ids somebody threw away. A board is derived, so "not this one" cannot
  // be expressed by removing it from a list — the next render puts it straight
  // back. Same shape and the same reasoning as `accentDismissed` above.
  boardsOff: () => ([]),
  /* ...AND WHERE THEY DRAGGED ONE TO: board id -> distance round that space's
     walls, in FEET. Same kind of store as `boardsOff` and for the same reason.
     THE COORDINATE IS ARC LENGTH AND NOT A POINT. See `wallPath` in
     electrical.js: a run index renumbers when somebody re-traces a corner, and
     a point in plan pixels moves when somebody corrects the scale. */
  boardMoves: () => ({}),
  /* ...AND WHAT THEY PUT ON ONE: board id -> `[{ id, kind, amps, label }]`, in
     the order they were added.
     A THIRD STORE OF THE SAME SHAPE, AND THE SHAPE IS THE POINT. A plate's
     composition is derived from the flows that come back to it — the rules know
     how many switches a ceiling needs and nobody should have to count them —
     but they cannot know that this wall wants a 16A socket for an air
     conditioner. So the derivation stands and the additions live beside it.
     THE POINT'S OWN ID IS IN THE RECORD, because two 16A sockets on one plate
     are two rows a person can remove independently and `{kind, amps}` cannot
     tell them apart. */
  boardPoints: () => ({}),

  /* THE TWO THINGS A PERSON DECIDES ABOUT A WIRE.
       `flowBoards`  flow id -> board id: which plate a loop runs off, where the
                     rules' nearest-plate answer is not the one wanted. A room
                     with two boards has a real question about which switch its
                     lamps belong on and nothing in the geometry can settle it.
       `flowBends`   flow id -> { leg key -> feet }: how far each leg's arc is
                     nudged off where the rule bows it. A DELTA and not a
                     position, so a leg nobody touched still follows its own
                     length as the fittings move — see `loopLegs` in flows.js.
     THE FLOW IDS ARE STABLE ENOUGH TO STORE, which they were not before this
     pair existed: see the note by `id` in flows.js, where they used to be a
     counter that would have slid somebody's reassignment onto a different wire
     the first time a light was added to an earlier chunk. */
  flowBoards: () => ({}),
  flowBends: () => ({}),

  /* THE PLATES SOMEBODY PUT ON A WALL THEMSELVES: `[{ id, roomId, sFt }]`.
     THE ODD ONE OUT IN THIS DOMAIN, AND WORTH SAYING SO. Everything else here
     modifies something a rule produced. NOTHING derives these plates — no pass
     proposes one — so the list IS the fact, the way `manualAccents` and
     `manualCoves` are, and losing it loses the boards rather than losing an
     adjustment to them. That is also why deleting one REMOVES it from here
     rather than adding an id to `boardsOff`: there is no rule left to suppress.
     WHERE IT IS, AND NOTHING ABOUT WHAT IT IS. Whether a plate is an outlet or
     a full switchboard lives in `boardKinds`, because that is a question every
     plate on the drawing can be asked and not only these. */
  manualBoards: () => ([]),
  /* OUTLET OR SWITCHBOARD, AND THE SOCKET'S RATING: board id ->
     `{ outlet, amps }`.
     A SOCKET OUTLET IS ONE SOCKET AND NO SWITCH and a switchboard is everything
     else; either can be turned into the other, including a plate a rule placed.
     AN OVERRIDE AND NOT A VALUE. A plate with no entry here is whatever it was
     BORN as — hand-placed ones outlets, rule-placed ones boards — so an entry
     that only restates that is deleted rather than written, and a plate reverts
     by losing its entry rather than by being set back to a default that may
     have moved since. See BOARD_OUTLET_SET.
     `amps` LIVES HERE AND NOT ON `manualBoards` for one reason: it survives the
     conversion. A 16A outlet ticked into a switchboard is a board with a 16A
     socket on it, and a rating stored against the outlet would have been lost
     on the way through. */
  boardKinds: () => ({}),
  /* HOW HIGH OFF THE FINISHED FLOOR: board id -> millimetres.
     THE ONE THING ABOUT A SWITCHBOARD A PLAN VIEW CANNOT SHOW. A plate is the
     same rectangle from above at 300mm as at 1200mm, and the difference between
     those two numbers is the difference between a socket and a switch. The
     rules have a default per role (SB_HEIGHT_MM in electrical.js) and a default
     is all it can be, so what is stored is the plates somebody actually set.
     THE PRIMARY HEIGHT ONLY. The wall facing a bed is two plates at two heights
     — that is what makes it two — so an override replaces the first of that
     list and leaves the second alone. See `withMode` in
     features/electrical/useBoardRules.js. */
  boardHeights: () => ({}),
  /* AND THE ORDER THE MODULES SIT IN: board id -> `[unitKey, ...]`, left to
     right. WHICH SWITCH IS LEFTMOST IS NOT DERIVABLE — it is which one your
     hand finds walking through the door, and that depends on the side the door
     is on, on which lamp matters most, and on what the client is used to.
     UNIT KEYS AND NOT MODULE INDICES. A fan's switch and its regulator are one
     unit, and so are a socket and the switch that controls it, so what is
     stored cannot express an arrangement in which either pair comes apart. A
     key also survives the plate gaining a fitting, where an index would not —
     see `orderUnits` in switchboards.js. */
  boardOrders: () => ({}),

  /* --- domain 6a: the drawing's interpretation, and the plan's identity -----
     NOT THE DRAWING AND NOT ANYTHING DERIVED FROM IT. Every field here is an
     answer somebody gave ABOUT the file — what its units are, which sheet of a
     set it is, what a door on it measures, what kind of building it shows — and
     `pxPerFt`, the number all of that exists to produce, is deliberately NOT in
     here. It is a memo over these, it is the serialiser's second argument, and
     it is write-only. See the header, and the note at `scale` in planState.js. */

  // The user's override of the file's own units. Null means "believe the file".
  unitId: () => null,
  /* WHICH SHEET OF A DRAWING SET THIS PLAN IS. A PDF is not a third kind of
     source — it is rendered to a raster and then it IS a raster — so what is
     held is the one thing the raster cannot say for itself. Null for images and
     DXFs. Part of the plan's IDENTITY rather than of its state: it has to be
     known BEFORE the file is rendered, so routes/Planner.jsx reads it straight
     off the row and hands it to the editor as a prop. */
  pdfPage: () => null,

  /* --- THE SCALE. Everything the app needs to arrive at the same px/ft again.
       'door'  click a detected door, say how wide it is. The default, because
               it is the only one that asks the user to RECOGNISE rather than to
               measure, and recognising a bathroom door is something anyone
               looking at a plan can do without a steady hand.
       'ref'   drag a line across something and name it. The fallback, and the
               only thing that works on a plan with no legible doors.
     GONE: a px/ft box, which asked the user to know a number nobody knows about
     their own drawing; and the fan-sweep scale, which needed red markers drawn
     on the plan first. Fans are still detected and are still ceiling obstacles
     — they have simply stopped being a ruler. */
  scaleMode: () => 'door',
  refId: () => 'door900',
  customFt: () => 3,
  // The two ends of the reference line, in plan px. `{ a: null, b: null }` is
  // "nothing measured yet", which is not the same as an absent field.
  measure: () => ({ a: null, b: null }),
  /* THE DOOR THAT IS THE RULER: `{ id, mm, rect }`, or `{ id, mm: null }` while
     its width is being chosen. THE RECT RIDES ALONG WITH THE ID because the
     door boxes are editable from the electrical step now, so the scale has to
     be anchored to the box that was MEASURED rather than looked up in a list
     that can change under it. See `pxPerFt` in App.jsx. */
  doorPick: () => null,
  /* THE PLAN'S ONE CEILING HEIGHT IN FEET — the figure the accent pass quotes
     to a model. NOT the per-space height: that is `ceilingMm`, in millimetres,
     because a flat has a 2700 bedroom and a 3600 living room in one drawing.
     NOTHING WRITES THIS ANY MORE. It is read (see the accent prompt) and it is
     saved, but the only writer left is `applyEditor` restoring it, so on a new
     plan it sits at 10 for ever. A PRE-EXISTING DEAD CONTROL — `ceilingMm`, per
     space, superseded it — recorded here rather than removed, because removing
     a saved field is a decision about old plans and not a refactor. */
  ceilingFt: () => 10,

  /* WHAT KIND OF BUILDING — residential, hotel, office; see roomTypes.js for
     why it is asked rather than guessed. Serialised as `projectType`, and the
     NAME IS THE POINT: App calls its own variable `projectId`, which is the one
     thing this is not. It is the kind of BUILDING and never the database
     project, whose id does not enter that component at all.
     SEEDED FROM THE PROJECT WHEN THE PROJECT KNOWS. A plan added to a project
     already classified as a hotel arrives classified — see the `seed` argument
     to `usePlanDoc`, which is the one field that has one. */
  projectType: () => null,
  // outline id -> { type, confidence, why }. What each space IS, which is what
  // the per-room rules read.
  roomTypes: () => ({}),

  /* --- domain 6b: the spaces, and what was found in them -------------------
     THE MODEL'S ANSWER AND THE USER'S CORRECTIONS, IN ONE LIST, which is how the
     app itself holds them and is the pair that matters: "what the model said"
     and "what a person then did about it" is the training signal, and one
     without the other is half a datapoint. See planState.js.

     THREE OF THESE SIX TRACER FIELDS ARE HELD BACK FROM UNDO — `focusId`,
     `selectedOutlineId` and `roomState` — and that is a FLAG and not a group.
     They are saved and restored exactly like everything else here; what
     `NOT_UNDOABLE` answers is what Ctrl+Z does to them, which is a different
     question from where they live. See planState.js and `applyStep`. */

  /* THE OUTLINES, IN RAW DRAWING UNITS. See toDu/fromDu in planSource: on a DXF
     that indirection is load-bearing — correct the unit interpretation and an
     outline is reinterpreted exactly as the walls are, so it stays on its walls
     instead of sliding off them. On an image the pair is the identity.
     EACH ONE CARRIES `detected` (it came from the room detector) and `reviewed`
     (a person looked at it), which is what makes a diff against the raw
     detector payload show the tweak. */
  outlines: () => ([]),
  // Which spaces are lit. One list rather than a flag on the outline, because
  // lighting is an act on a SET — see PLAN_LIT and RELIT.
  litIds: () => ([]),
  /* ...AND WHICH LIT SPACES HAVE MOVED SINCE. The difference between the tracer
     offering "relight 2 changed spaces" and offering the whole sheet, so
     dropping it on a reload would quietly put the bill back up.
     ONLY LIT SPACES GO IN HERE. An outline nobody has lit yet is not a space
     whose answers have gone stale — it is a space with no answers. */
  dirtyIds: () => ([]),
  // Which room the panel is editing, and which the tracer highlights. Both are
  // saved (reopening a plan should put you back where you were looking) and
  // both are held back from undo (see the note above).
  focusId: () => null,
  selectedOutlineId: () => null,
  /* THE SEGMENTER'S STATUS, AND IT IS THE ODD FIELD IN THE WHOLE DOCUMENT. It
     is written out as `segmentation` — the model's own reply — and read back
     DELIBERATELY LOSSILY: the reader drops `proposed` and stamps
     `restored: true`, which is what stops the app offering to run a
     segmentation whose answer is already on the screen. Neither half is a bug;
     see the exclusions in test-plan-state, which assert the asymmetry exactly.
     IT IS ALSO THE SUBJECT OF A KNOWN, DELIBERATELY UNFIXED DEFECT in
     NOT_UNDOABLE_KEYS. See planState.js — the key map names `roomState` where
     the writer emits `segmentation`, so a re-segmentation pushes an undo step
     that restores nothing visible. Not this refactor's to fix: correcting it
     REMOVES a step a gesture currently produces, which is a change in undo
     granularity. There is a test pinned to the current behaviour. */
  roomState: () => ({ status: 'idle' }),

  /* THE FURNITURE FOUND ON THE PLAN, in image px. DELIBERATELY NOT THE SAME
     THING AS A ZONE: a detection is a property of the IMAGE and is found once,
     whereas whether it is a no-light zone depends on which room is being lit. */
  detections: () => ([]),
  // ...and the boxes somebody struck out, by id. The same dismissal argument as
  // `accentDismissed`: a detection is re-read on every run.
  dismissed: () => ([]),
  /* ...AND WHAT THE BED CONTEST DECIDED, room by room: which detector won,
     whether the judge was asked, and why. Kept because it is the record of a
     decision that cost model calls, and because the panel prints it. */
  bedVerdicts: () => ({}),
  /* WHICH DETECTOR TO ASK. A preference rather than a finding, and the one
     field in this document that is ALSO mirrored into localStorage — see the
     two effects in App.jsx: the plan remembers what it was run with, and the
     browser remembers what this person prefers next time. */
  provider: () => DEFAULT_PROVIDER,

  /* --- domain 6c: what is already on the ceiling, and how it is being looked
     at ----------------------------------------------------------------------
     THE LAST THREE ARE VIEW PREFERENCES AND ARE HELD BACK FROM UNDO, for the
     reason `applyStep` gives: undoing a change while the canvas jumps to where
     it was two gestures ago loses the reader's place and hides the very thing
     that just changed. They are still SAVED — reopening a plan should put you
     back where you were looking — which is the distinction between the group
     and the flag. See NOT_UNDOABLE. */

  /* THE THINGS ALREADY ON THE CEILING — fans, cassettes, whatever was drawn
     before the lighting. THE ONLY LIST OF THEM: there used to be two, this and
     whatever the red-circle fan detector had found, and a fan is now a ceiling
     object like any other. In plan FEET. */
  ceilingObjs: () => ([]),
  /* WHERE SOMEBODY DRAGGED A LIGHT TO: outline id -> cell key -> offset from
     that cell's own centre, in feet.
     AN OVERRIDE AND NOT A LAYOUT. The lights themselves are never saved — they
     are a memo over everything else in the document, and re-deriving them is
     what makes a reopened plan agree with the RULES rather than with a
     snapshot. This is the small set of places a person overruled them, and it
     is exactly the same kind of record `boardMoves` and `runTrims` are.
     KEYED BY THE CELL'S GEOMETRY, which is what makes it safe to keep: a plan
     reopened after its grid was re-cut simply finds no cell of that name and
     the offset lapses, rather than moving some other lamp by a foot. See
     `cellKey` in planner.js. */
  lightMoves: () => ({}),
  /* WHERE THE RENDER-PASS VIEWS WENT: room id -> a list of pointers.
     THE PATH AND ITS DIMENSIONS, WHICH IS ABOUT NINETY BYTES PER RENDER, and
     the BYTES ARE NOT IN HERE and never will be: megabytes of somebody's
     photographs in a jsonb column would multiply the row size by a hundred, and
     this column is read in full every time a plan is opened. They go to the
     bucket instead (db.uploadRender) and this keeps the pointers.
     THE SIZES ARE RECORDED RATHER THAN RE-DERIVED because they describe what was
     SENT — the model saw a 1400px JPEG at quality 0.82, and that fact is part of
     the training row a render, its reply and the resulting design make up. */
  renderRefs: () => ({}),

  /* WHICH LAYERS THE DRAWING IS SHOWING. Cheap to store and jarring to lose.
     THE DEFAULTS ARE IN lib/planState.js AND NOT HERE, because three readers
     need them — this table, `applyEditor`'s merge, and the test's fixture. A
     saved plan's answer is MERGED over them rather than assigned, so a plan
     saved before a layer existed gains it at its default rather than at
     `undefined`. See LAYER_DEFAULTS. */
  layers: () => ({ ...LAYER_DEFAULTS }),
  /* HOW FAR IN. CLAMPED ON EVERY WRITE, by the same `clampZoom` the restore
     guard depends on — see ZOOM_MIN in planState.js. A stored zoom is always a
     legal one, which is what lets `if (p.ui.zoom)` be a safe test. */
  zoom: () => 1,
  // Which tab: spaces | design | boards | boq | admin.
  view: () => 'spaces',
};

/* --- WHAT THE ACTIONS ARE ALLOWED TO DO TO A LIST -------------------------
   SEVEN OF THE THIRTEEN FIELDS ARE LISTS OF THINGS WITH IDS, and the edits made
   to them are the same six shapes over and over: cleared, appended, patched by
   id, removed by id, and the two bulk forms. Writing thirty near-identical
   reducer cases by hand is how one of them ends up missing the no-op bailout
   that the undo granularity depends on, so the mechanics live here once and the
   named actions below say WHICH list and WHAT edit.

   EVERY ONE OF THEM RETURNS THE LIST UNCHANGED WHEN NOTHING MOVED. That is not
   an optimisation — see the header. `patchIn` and `dropFrom` both check before
   they build. */
const patchIn = (list, id, patch) => {
  const i = list.findIndex((x) => x.id === id);
  if (i < 0) return list;
  const cur = list[i];
  // A PATCH THAT CHANGES NOTHING IS NOT A CHANGE, which is what stops a slider
  // swept back to where it started from filling the undo stack with steps.
  if (Object.keys(patch).every((k) => cur[k] === patch[k])) return list;
  const next = [...list];
  next[i] = { ...cur, ...patch };
  return next;
};

const dropFrom = (list, gone) => {
  const next = list.filter((x) => !gone(x));
  return next.length === list.length ? list : next;
};

/* THE SAME IDS IN THE SAME ORDER? The bailout test for a field that IS a list of
   ids — `litIds`, `dirtyIds` — where "the value already there" cannot be decided
   by reference because the caller has just built a fresh array. Order matters
   because these lists are stored and a reordering is a diff in the saved plan. */
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/* MARK A SET OF OUTLINES REVIEWED, AND RETURN THE SAME LIST IF THEY ALL WERE.
   `ids` null means every one of them. REVIEWED IS THE ONLY THING THAT
   DISTINGUISHES A PROPOSAL SOMEBODY HAS LOOKED AT from one nobody has: the
   dashed line goes solid, because the corner is now where a person put it. It is
   not the same as confirming — see the three lighting acts, all of which mark
   what they light. */
const reviewedIn = (list, ids) => {
  let moved = false;
  const next = list.map((o) => {
    if (o.reviewed || (ids && !ids.includes(o.id))) return o;
    moved = true;
    return { ...o, reviewed: true };
  });
  return moved ? next : list;
};

/**
 * The document as it starts: every field at its own default, and no others.
 *
 * `seed` IS FOR THE ONE FIELD THAT ARRIVES AS A PROP, and it is the same
 * mechanism `useState(initialProjectType ?? null)` was: read ONCE, on the first
 * render, and never again. A plan added to a project already classified as a
 * hotel arrives classified — see `projectType` above.
 *
 * ONLY REAL FIELDS CAN BE SEEDED, so a typo in the seed is a default rather than
 * a field the document did not have. Called with no argument everywhere except
 * `usePlanDoc`, which is what the shape assertion in test-plan-state walks.
 */
export function initialDoc(seed) {
  const doc = {};
  for (const [field, make] of Object.entries(DOC_FIELDS)) doc[field] = make();
  if (seed) {
    for (const [field, value] of Object.entries(seed)) {
      if (field in DOC_FIELDS && value !== undefined) doc[field] = value;
    }
  }
  return doc;
}

/* WRITE A FIELD, OR RETURN THE STATE UNTOUCHED. The single place identity
   stability is decided, so no action can get it wrong by hand. `next` is
   compared by reference, which is the right comparison: every updater below
   returns the SAME nested object when it changes nothing, so a reference
   difference here means something actually moved. */
function put(state, field, next) {
  return state[field] === next ? state : { ...state, [field]: next };
}

/* --- THE ACTIONS ----------------------------------------------------------
   ONE PER EDIT THAT EXISTS TODAY, and each one carries what the handler used to
   close over rather than a finished value — `CEILING_MM_SET` takes the RAW text
   from the field and does the clamping here, because the clamp is part of what
   the edit MEANS and a caller that skipped it would write an illegal height.
   The rule everywhere below: the reducer owns the decision, the call site owns
   only the intent.

   `DOC_FIELD_RESTORED` IS THE ODD ONE OUT AND IS NOT AN EDIT. It replaces a
   field wholesale and exists for exactly two callers — `applyEditor` opening a
   saved plan, and `applyStep` applying an undo step. It is deliberately blunt:
   the optional-key defaulting that lets a plan saved last year still open lives
   in `applyEditor` and must stay there, so what arrives here is already the
   value that plan restores to. */
export function docReducer(state, action) {
  switch (action.type) {
    /* THE FIELD TAKES WHAT IS TYPED AND THE STORE TAKES WHAT IS MEANT. Clamped
       rather than refused: 27 is somebody halfway through typing 2700, and a
       field that rejects it cannot be typed in at all. An empty box is the
       default, which is the only reading of "no height" there is. */
    case 'CEILING_MM_SET': {
      const { id, raw, min, max } = action;
      const n = Math.round(Number(raw));
      const m = state.ceilingMm;
      if (raw === '' || !Number.isFinite(n)) {
        if (!(id in m)) return state;
        const next = { ...m }; delete next[id];
        return put(state, 'ceilingMm', next);
      }
      const mm = Math.min(max, Math.max(min, n));
      return m[id] === mm ? state : put(state, 'ceilingMm', { ...m, [id]: mm });
    }

    /* THE DEFAULTS ARE RESOLVED IN HERE, OFF `state`, AND THAT IS NOT A DETAIL.
       The `useState` updater this replaces read the map from inside itself — so
       two tone changes dispatched in one batch each saw the other's result. A
       version that took the resolved materials as an argument would read them
       from the render that queued the action instead, and the second of two
       edits in a batch would silently undo the first. `materialsOf` is imported
       rather than reimplemented so the defaulting rule still lives in exactly
       one place. */
    case 'SURFACE_TONE_SET': {
      const { id, surface, tone } = action;
      const m = state.materials;
      const cur = materialsOf(m, id);
      if (cur[surface] === tone) return state;
      return put(state, 'materials', { ...m, [id]: { ...cur, [surface]: tone } });
    }

    case 'WALL_TONE_SET': {
      const { id, edge, tone } = action;
      const m = state.materials;
      const cur = materialsOf(m, id);
      const walls = { ...cur.walls };
      // A WALL BACK AT THE DEFAULT IS A WALL WITH NO ENTRY, so a room somebody
      // set dark and then set light again stores nothing — the same rule
      // `boardKinds` follows, and it is what keeps a saved plan honest about
      // which decisions were actually taken.
      if (tone === 'light') delete walls[edge]; else walls[edge] = tone;
      return put(state, 'materials', { ...m, [id]: { ...cur, walls } });
    }

    case 'ROW_WATTS_SET': {
      const { roomId, key, watts, defaultWatts } = action;
      const m = state.fixtureWatts;
      const room = { ...(m[roomId] ?? {}) };
      if (watts === defaultWatts) delete room[key];
      else room[key] = watts;
      if (!Object.keys(room).length) {
        if (!(roomId in m)) return state;
        const next = { ...m }; delete next[roomId];
        return put(state, 'fixtureWatts', next);
      }
      return put(state, 'fixtureWatts', { ...m, [roomId]: room });
    }

    /* --- THE LISTS ---------------------------------------------------------
       THE FIELD IS A PARAMETER AND THE EDIT IS THE TYPE, which is the way round
       that matters: there is one `LIST_ADDED` case and seven fields that can be
       added to, rather than seven cases that each have to remember the bailout.
       The action creators below name the edit per field, so a call site still
       reads `addCove(c)` and cannot ask for an edit its field does not have. */
    case 'LIST_CLEARED': {
      const cur = state[action.field];
      return cur.length === 0 ? state : put(state, action.field, []);
    }

    /* THE ID IS MINTED HERE, and it is minted from the list's own length —
       `${prefix}-${stamp}-${l.length}` is the format every one of these lists
       has always used. THE STAMP COMES IN WITH THE ACTION and is not read from
       the clock in here, because a reducer that calls `Date.now()` is not a pure
       function of its arguments: React invokes reducers twice in development and
       the two runs would mint different ids. The length has to be read in here
       though — that is the whole reason this is not just LIST_ADDED. */
    case 'LIST_ADDED_MINTED': {
      const cur = state[action.field];
      const id = `${action.idPrefix}-${action.stamp}-${cur.length}`;
      return put(state, action.field, [...cur, { id, ...action.item }]);
    }

    case 'LIST_ADDED':
      return put(state, action.field, [...state[action.field], action.item]);

    case 'LIST_ADDED_MANY': {
      if (!action.items.length) return state;
      return put(state, action.field, [...state[action.field], ...action.items]);
    }

    case 'LIST_PATCHED':
      return put(state, action.field,
        patchIn(state[action.field], action.id, action.patch));

    case 'LIST_REMOVED':
      return put(state, action.field,
        dropFrom(state[action.field], (x) => x.id === action.id));

    case 'LIST_REMOVED_MANY': {
      const gone = new Set(action.ids);
      return put(state, action.field, dropFrom(state[action.field], (x) => gone.has(x.id)));
    }

    /* THE WHOLE LIST, ALREADY WORKED OUT. See `replaceCobs` in the actions
       below for when this is the honest action and when it is a smell. */
    case 'LIST_REPLACED': {
      const cur = state[action.field];
      return action.next === cur ? state : put(state, action.field, action.next);
    }

    /* --- THE ONE ACTION THAT CARRIES A FUNCTION, AND WHY IT HAS TO ----------
       A POINTER DRAG CAN FIRE TWICE BEFORE A RE-RENDER. hooks/useDrag.js says so
       in as many words at its `setList` call: anything computed from a render's
       closure is a frame behind, so the second move of a pair would be applied
       to the list as it was before the first and the drag would visibly stutter
       and then snap back.
       `LIST_REPLACED` CANNOT EXPRESS THAT. It carries a finished list, which
       means the caller had to read the current one from somewhere — and the only
       place it can read is the closure. So this case takes the same pure
       list -> list function `useState` took, and applies it to the reducer's OWN
       state, which is by definition the latest.
       THE FUNCTION IS NOT A PROBLEM HERE, and it is worth saying why: what this
       app serialises is the DOCUMENT, never the actions. There is no replay, no
       time-travel and no action log, so an action holding a closure costs
       nothing that is actually being bought elsewhere.
       FOUR CALLERS, ALL OF THEM PER-FRAME GESTURES — the shape drag, the shape
       resize, the COB drag and the array drag. A fifth should have to argue for
       itself: an edit that is not a pointer move has a render between it and the
       next one, and should carry a value rather than a closure. */
    case 'LIST_UPDATED': {
      const cur = state[action.field];
      const next = action.update(cur);
      return next === cur ? state : put(state, action.field, next);
    }

    /* --- THE TWO LISTS-OF-IDS ---------------------------------------------
       `autoSpots` holds outline ids and not objects, so `patchIn` and the
       id-keyed removals do not apply to it. Two actions, and the set semantics
       are in here rather than at the call site so that turning a switch on twice
       cannot produce a document. */
    case 'ID_ADDED': {
      const cur = state[action.field];
      return cur.includes(action.id) ? state : put(state, action.field, [...cur, action.id]);
    }

    case 'ID_REMOVED': {
      const cur = state[action.field];
      return cur.includes(action.id)
        ? put(state, action.field, cur.filter((x) => x !== action.id))
        : state;
    }

    /* --- THE MAPS ----------------------------------------------------------
       SPARSE, ALL OF THEM, and the sparseness is load-bearing: an entry equal to
       the default is deleted rather than written, so a plan nobody has touched
       carries an empty object and a default changed tomorrow moves every plan
       that never overruled it. See planState.js. */
    case 'MAP_CLEARED': {
      const cur = state[action.field];
      return Object.keys(cur).length === 0 ? state : put(state, action.field, {});
    }

    case 'MAP_ENTRY_SET': {
      const cur = state[action.field];
      if (cur[action.key] === action.value) return state;
      return put(state, action.field, { ...cur, [action.key]: action.value });
    }

    /* ONE ENTRY, GONE. THE WAY BACK OUT OF EVERY OVERRIDE MAP IN THE DOCUMENT:
       a board put back where its rule wanted it, a wire dropped home, a trim
       dragged to the derived length. BACK TO NOTHING RATHER THAN TO THE RULE'S
       OWN NUMBER, which is the distinction the whole of domain 5 turns on — an
       entry carrying a rule's answer as a hand answer is a plate marked "moved
       by hand" for ever, and one that stops following the door it was placed
       off. */
    case 'MAP_ENTRY_REMOVED': {
      const cur = state[action.field];
      if (!(action.key in cur)) return state;
      const next = { ...cur }; delete next[action.key];
      return put(state, action.field, next);
    }

    /* MERGE INTO ONE ENTRY, WHICH IS WHAT A MAP OF OBJECTS NEEDS. `boardKinds`
       holds `{ outlet, amps }` and `flowBends` holds a leg key -> feet, so
       re-rating a socket must not blank the outlet flag beside it and nudging
       one leg must not straighten the other three.
       THE BAILOUT COMPARES THE PATCH'S OWN KEYS, the same test `patchIn` makes
       on a list item — and it earns its keep on `flowBends`, which is written
       from a pointermove. */
    case 'MAP_ENTRY_PATCHED': {
      const cur = state[action.field];
      const entry = cur[action.key];
      if (entry && Object.keys(action.patch).every((k) => entry[k] === action.patch[k])) {
        return state;
      }
      return put(state, action.field,
        { ...cur, [action.key]: { ...(entry ?? {}), ...action.patch } });
    }

    /* --- A MAP WHOSE VALUES ARE LISTS -------------------------------------
       ONE FIELD HAS THIS SHAPE — `boardPoints`, board id -> the points somebody
       added by hand — and it needs two ops rather than the map ops above
       because what is edited is inside the list, not the entry.
       THE KEY IS LEFT IN PLACE WHEN THE LAST POINT GOES, deliberately: an empty
       array is what the `useState` updater this replaces wrote, and a plate
       stripped back to nothing is a plate somebody has still touched. Changing
       it to a delete would change what a saved plan holds. */
    case 'MAP_LIST_APPENDED': {
      const cur = state[action.field];
      return put(state, action.field,
        { ...cur, [action.key]: [...(cur[action.key] ?? []), action.item] });
    }

    case 'MAP_LIST_REMOVED': {
      const cur = state[action.field];
      const list = cur[action.key] ?? [];
      const next = list.filter((x) => x.id !== action.id);
      if (next.length === list.length && action.key in cur) return state;
      return put(state, action.field, { ...cur, [action.key]: next });
    }

    /* MANY ENTRIES AT ONCE, AND IT IS ONE ACT RATHER THAN N. The prep run reads
       every unread space and comes back with a map of answers; writing them one
       key at a time would be the same document N times over, and the room that
       failed would be indistinguishable from the room that was never asked.
       THE BAILOUT COMPARES EVERY ENTRY BY REFERENCE, so a re-run that returns
       the identical objects — or a run that found nothing at all — is not a
       change. `{}` merged into a map is the commonest shape of that: see the
       accent pass, which writes `got` whether or not any room answered. */
    case 'MAP_MERGED': {
      const cur = state[action.field];
      const keys = Object.keys(action.entries);
      if (!keys.length) return state;
      if (keys.every((k) => cur[k] === action.entries[k])) return state;
      return put(state, action.field, { ...cur, ...action.entries });
    }

    /* --- THE EDITS THAT ARE NOT A SHAPE ------------------------------------
       Four, and each one is here rather than in a generic case because the rule
       it applies is about THIS field and nothing else. A generic op with a
       predicate handed in from the call site would put the rule back in App. */

    /* THE TOGGLE GOING OFF TAKES BACK ONLY WHAT IS STILL THE TOGGLE'S. A lamp
       somebody has re-specified or dragged is theirs and stops being autoplace's
       to remove — see `autoplaceIn` in features/fixtures/useFixtureCommands.js
       and the `auto` flag on the fitting.
       This is the whole safety of the control and it is why the predicate is two
       terms rather than one. */
    case 'AUTO_COBS_DROPPED':
      return put(state, 'manualCobs',
        dropFrom(state.manualCobs, (c) => c.roomId === action.roomId && c.auto));

    /* A RUN'S MODULES GO WITH THE RUN. They are keyed by the shape id, so a
       track deleted without this leaves diffusers keyed to a geometry that no
       longer exists — which draws nothing and counts in the schedule for ever. */
    case 'TRACK_MODULES_DROPPED':
      return put(state, 'trackFixtures',
        dropFrom(state.trackFixtures, (f) => f.trackId === action.trackId));

    /* RE-SPECIFYING A HAND-PLACED LAMP. The clamps are in here because they are
       what a legal specification IS — a typed figure, a held arrow key and a
       restored plan all reach this, and one place has to decide. `spec: true`
       and `auto: false` ride along because re-specified is specified: the lamp
       is no longer carrying the engine's answer and is no longer the toggle's to
       take away. */
    case 'COB_SPEC_SET': {
      const { id, watts, beam } = action;
      const patch = {
        ...(watts != null ? { watts: clampWatts(watts) } : {}),
        ...(beam != null ? { beam: nearestBeam(beam) } : {}),
        spec: true, auto: false,
      };
      return put(state, 'manualCobs', patchIn(state.manualCobs, id, patch));
    }

    /* ONE ARRAY'S SETTING-OUT. The count is quantised against the geometry the
       run is set out on, and `quanta` is handed in because working it out needs
       `arrayOutline` — a memo over the shapes AND the rooms, which is derived
       state the document must not contain. What arrives is the arithmetic's
       input, not its answer, so the rule itself still lives in one place. */
    case 'ARRAY_SHAPE_SET': {
      const { id, count, side, offsetFt, quantise } = action;
      const patch = {
        ...(count != null ? { count: quantise(count) } : {}),
        ...(side != null ? { side } : {}),
        ...(offsetFt != null ? { offsetFt: Math.max(0, Number(offsetFt) || 0) } : {}),
      };
      return put(state, 'cobArrays', patchIn(state.cobArrays, id, patch));
    }

    /* --- domain 4's three, and each is about ONE pair of fields ------------ */

    /* A RE-RUN REPLACES A ROOM'S FITTINGS, SO ITS DISMISSALS GO TOO. The ids
       are POSITIONAL — `acc-<room>-<n>`, `surf-<room>-<n>` — so a dismissal
       left behind would strike out whatever takes that index next, which is a
       fitting somebody never rejected quietly missing from the sheet.
       THE ID FORMAT IS THE RULE AND IT LIVES IN HERE. The call site hands over
       the rooms that were re-read and nothing else; a version that passed the
       finished predicate in would put the naming convention back in App, where
       the two lists that share it could drift apart. Two fields, one case,
       parameterised by the prefix each namespace uses. */
    case 'ROOM_DISMISSALS_DROPPED': {
      if (!action.roomIds.length) return state;
      const heads = action.roomIds.map((id) => `${action.prefix}-${id}-`);
      return put(state, action.field,
        dropFrom(state[action.field], (x) => heads.some((h) => x.startsWith(h))));
    }

    /* ONE END OF ONE DERIVED RUN, NUDGED. `end` is 'a' or 'b' and `ft` is the
       distance that end moved from where the rule put it — already rounded to
       the setting-out increment by the call site, which is where it has to be
       because the conversion needs `pxPerFt`.
       BACK TO NOTHING RATHER THAN TO ZERO. A run dragged back to where the rule
       put it is a run with NO edit on it, and leaving `{a:0,b:0}` behind would
       mark it as hand-edited for ever and keep a row in every future save. Same
       sparse rule as `boardKinds` and the materials maps: what is stored is what
       somebody CHANGED. */
    case 'RUN_TRIM_SET': {
      const { trimId, end, ft } = action;
      const m = state.runTrims;
      const cur = m[trimId] ?? { a: 0, b: 0 };
      const next = { ...cur, [end]: ft };
      if (Math.abs(next.a) < 1e-6 && Math.abs(next.b) < 1e-6) {
        if (!(trimId in m)) return state;
        const out = { ...m }; delete out[trimId];
        return put(state, 'runTrims', out);
      }
      // THE POINTER FIRES FAR FASTER THAN THE INCREMENT CHANGES. A drag across
      // one snap step is dozens of moves that all round to the same figure, and
      // without this every one of them would be a fresh document.
      if (trimId in m && cur.a === next.a && cur.b === next.b) return state;
      return put(state, 'runTrims', { ...m, [trimId]: next });
    }

    /* AN EDIT TO ONE ACCENT FITTING, WHEREVER IT LIVES — AND IT IS ONE CASE
       BECAUSE IT IS ONE ACT.

       THIS IS THE FIX FOR A REAL BUG, carried over from `updateAccentZone` in
       App: a strip or sconce placed BY HAND could not be moved at all. The
       grips appeared, the drag armed, and nothing happened. Accent fittings live
       in TWO stores — `accentResults[roomId].zones` holds what the pass produced
       and `manualAccents` is a flat list of the ones placed with the palette —
       the canvas draws the MERGE of the two (see accentZonesPx), and the write
       went to the pass's store where the id was not.

       SO THE WRITE FOLLOWS THE ZONE INSTEAD OF ASSUMING THE STORE. Both stores
       are tried; each is left UNCHANGED when the id is not one of its own, so
       the miss costs a referential no-op and never a re-render. That is
       deliberately not "look up which store first" — the lookup would have to
       happen outside the reducer, against a copy from the render that queued the
       action, which is the same class of bug one level down. It is the trap the
       original `setSurfaceTone` fell into; see SURFACE_TONE_SET.

       `fn` MUST BE PURE, AND THAT IS WHY IT MAY RIDE IN AN ACTION. It can be
       invoked more than once for one edit — React is free to invoke a reducer
       twice — and the note on the drag it serves said exactly that before this
       was a reducer. This is the per-frame seam LIST_UPDATED describes, for a
       gesture that has to write two fields at once rather than one list. */
    case 'ACCENT_ZONE_UPDATED': {
      const { roomId, id, fn } = action;
      const list = state.manualAccents;
      let next = list.some((z) => z.id === id)
        ? put(state, 'manualAccents', list.map((z) => (z.id === id ? fn(z) : z)))
        : state;
      const m = state.accentResults;
      const res = m[roomId];
      if (res?.zones?.some((z) => z.id === id)) {
        next = put(next, 'accentResults',
          { ...m, [roomId]: { ...res, zones: res.zones.map((z) => (z.id === id ? fn(z) : z)) } });
      }
      return next;
    }

    /* ONE MODULE ON A RUN. Whole watts, because a module is specified in them
       and the length bands are keyed on them — see DIFFUSER_LENGTHS_MM. */
    case 'TRACK_MODULE_SPEC_SET': {
      const { id, watts, beam } = action;
      const patch = {
        ...(watts != null ? { watts: Math.max(1, Math.round(watts)) } : {}),
        ...(beam != null ? { beam: nearestBeam(beam) } : {}),
      };
      return put(state, 'trackFixtures', patchIn(state.trackFixtures, id, patch));
    }

    /* --- domain 6c: the ceiling's furniture, and the way it is looked at --- */

    /* ONE SWEEP, ONTO EVERY FAN IN THE SELECTION.
       THE NON-FANS ARE IGNORED RATHER THAN REFUSED, which is the reading the
       gesture wants: selecting two fans and a cassette and setting a sweep is a
       perfectly clear instruction about the fans. `withSweep` is imported rather
       than reimplemented so the millimetres-to-feet rule stays in one place —
       see lib/ceilingObjects.js. */
    case 'OBJECT_SWEEP_SET': {
      const gone = new Set(action.ids);
      let moved = false;
      const next = state.ceilingObjs.map((o) => {
        if (!gone.has(o.id) || o.kind !== 'fan') return o;
        const swept = withSweep(o, action.mm);
        if (swept.diaFt === o.diaFt) return o;
        moved = true;
        return swept;
      });
      return moved ? put(state, 'ceilingObjs', next) : state;
    }

    /* ONE LAMP, NUDGED OFF ITS CELL'S CENTRE. The offset is in FEET and it is
       computed at the call site because getting there needs the room's origin
       and `pxPerFt` — both derived. What is stored is a DELTA from the cell, not
       a position, which is what makes it lapse harmlessly when the grid is
       re-cut rather than moving some other lamp. */
    case 'LIGHT_MOVED': {
      const { roomId, cellKey, dx, dy } = action;
      const m = state.lightMoves;
      const room = m[roomId];
      const cur = room?.[cellKey];
      if (cur && cur.dx === dx && cur.dy === dy) return state;
      return put(state, 'lightMoves',
        { ...m, [roomId]: { ...(room || {}), [cellKey]: { dx, dy } } });
    }

    /* ...AND PUT BACK. A LIGHT CANNOT BE DELETED — it is derived, and a ceiling
       with a hole in it where a lamp should be is not a thing this app can
       express. What CAN be taken away is the decision somebody made about where
       inside its cell it sits.
       AND THE ROOM GOES WITH ITS LAST OFFSET. An empty `{}` left behind under a
       room id is a room marked hand-adjusted for ever, and a row in every future
       save — the same sparse rule the materials maps and `boardKinds` follow. */
    case 'LIGHT_MOVE_RESET': {
      const { roomId, cellKey } = action;
      const m = state.lightMoves;
      const room = m[roomId];
      if (!room || !(cellKey in room)) return state;
      const next = { ...room }; delete next[cellKey];
      const out = { ...m };
      if (Object.keys(next).length) out[roomId] = next; else delete out[roomId];
      return put(state, 'lightMoves', out);
    }

    /* ONE LAYER, SET OR FLIPPED.
       TWO ACTIONS RATHER THAN ONE, because the two callers know different
       things: a switch being toggled knows only WHICH layer, and the three
       places that turn one ON — arriving at the design screen, confirming the
       doors, selecting a board — know the value and must be idempotent. A
       toggle used for those would turn the layer off on the second visit. */
    case 'LAYER_SET': {
      const { key, on } = action;
      const l = state.layers;
      return l[key] === on ? state : put(state, 'layers', { ...l, [key]: on });
    }

    case 'LAYER_TOGGLED': {
      const l = state.layers;
      return put(state, 'layers', { ...l, [action.key]: !l[action.key] });
    }

    /* HOW FAR IN, ABSOLUTE OR BY A FACTOR — AND CLAMPED EITHER WAY.
       THE CLAMP IS THE RULE AND IT IS IN HERE, applied to the reducer's own
       state so a wheel held down cannot walk past the limit one frame at a time.
       `clampZoom` is imported rather than reimplemented because the truthiness
       guard on the restore path depends on ZOOM_MIN being above zero — see the
       note at that guard in planState.js.
       THE FACTOR IS A NUMBER AND NOT A FUNCTION. The old `zoomTo` took either a
       value or a `z => z * k` closure; every caller of the closure form was a
       plain multiplication, so the factor comes in as a factor and there is one
       less function riding in an action. */
    case 'ZOOM_SET':
      return put(state, 'zoom', clampZoom(action.to));

    case 'ZOOM_SCALED':
      return put(state, 'zoom', clampZoom(state.zoom * action.by));

    /* THE TRACER NEEDS THE STAGE, so arriving at it moves off a view that
       REPLACES the stage — and off nothing else. Forcing 'design' unconditionally
       meant a trip to straighten one wall put you back on a tab you had
       deliberately left; the schedule and the switchboard sheet are the only two
       that cannot survive the crossing, because both replace the stage. */
    case 'STAGE_VIEW_REQUIRED': {
      const v = state.view;
      return (v === 'boq' || v === 'boards') ? put(state, 'view', 'design') : state;
    }

    /* A SELECTION ON THE DRAWING PULLS THE TAB TO THE DESIGN, because the
       selection is what the tab is now about — a card on a surface nobody can
       see is no use.
       NOT FROM `admin`, WHICH IS NOT A STEP IN THIS WORK. It is a different
       audience's tab, and yanking an operator out of it because they clicked the
       drawing would lose whatever they were reading. */
    case 'DESIGN_VIEW_REQUESTED':
      return state.view === 'admin' ? state : put(state, 'view', 'design');

    /* --- domain 6b: the tracer's acts, which are acts on SEVERAL fields ----
       SIX OF THESE EIGHT WRITE MORE THAN ONE FIELD, and that is the shape of the
       tracer rather than a convenience: deleting a space takes it out of the
       lit list, the dirty list, the selection and the focus, and a version of
       that which left any one of them behind is a bug with a name — an id
       sitting in the dirty list for ever, offering a relight of a room that no
       longer exists. One act, one action, one document. */

    /* A SPACE DELETED, AND EVERYTHING THAT REFERRED TO IT.
       A SPACE THAT IS GONE IS NOT A SPACE THAT CHANGED — that is why `dirtyIds`
       is filtered rather than left: its id would otherwise sit in the list for
       ever and the tracer would offer a relight of a room that is not there.
       THE SELECTION AND THE FOCUS ARE CLEARED ONLY IF THEY WERE THIS ONE, which
       is what stops deleting room 3 from dropping the panel off room 1. */
    case 'OUTLINE_DELETED': {
      const { id } = action;
      let next = put(state, 'outlines', dropFrom(state.outlines, (o) => o.id === id));
      next = put(next, 'litIds', dropFrom(next.litIds, (x) => x === id));
      next = put(next, 'dirtyIds', dropFrom(next.dirtyIds, (x) => x === id));
      if (next.selectedOutlineId === id) next = put(next, 'selectedOutlineId', null);
      if (next.focusId === id) next = put(next, 'focusId', null);
      return next;
    }

    /* ONE OUTLINE'S CORNERS, EDITED — AND IT CARRIES A FUNCTION.
       `edit` IS A PURE `pointsDu -> pointsDu | null`, built at the call site
       because the conversion it wraps needs the plan SOURCE: a point arrives in
       pixels and is stored in the plan's own units, which is what keeps a nudged
       corner on its wall when a DXF's unit interpretation is corrected
       afterwards. `source` is a memo — derived state the document may not hold —
       so the conversion cannot come in here.
       THIS IS THE PER-FRAME SEAM AGAIN. A grip drag calls `movePoint` on every
       pointermove, so the points have to be read from the reducer's OWN state:
       see LIST_UPDATED, which says the same thing about `setList`.
       A RETURN OF NULL, OR OF FEWER THAN THREE POINTS, IS REFUSED. Two points
       are not a room, and `removePoint` relies on this rather than checking
       twice. */
    case 'OUTLINE_POINTS_EDITED': {
      const { id, edit } = action;
      let moved = false;
      const next = state.outlines.map((o) => {
        if (o.id !== id) return o;
        const pts = edit(o.pointsDu);
        if (!pts || pts.length < 3) return o;
        moved = true;
        // TOUCHING AN OUTLINE MARKS IT REVIEWED. See `reviewedIn`.
        return { ...o, reviewed: true, pointsDu: pts };
      });
      return moved ? put(state, 'outlines', next) : state;
    }

    /* LIGHT EVERYTHING TRACED OR PROPOSED — the primary act on the tracer.
       NOTHING IS SELECTED TO BEGIN WITH. `focusId` used to be seeded with the
       first outline, which was harmless while it only decided which room the
       panel described — it now also draws a blue outline on the canvas, and a
       space highlighted because it happens to be first is a selection nobody
       made. `focus` in App still falls back to rooms[0] for the panel's own
       purposes, so the details pane is unaffected.
       THE LIT LIST IS READ OFF `state.outlines` AND NOT HANDED IN, which is the
       whole reason this is a case: `outlines.map(o => o.id)` at the call site is
       the list as of the render that queued the act. */
    case 'PLAN_LIT': {
      const ids = state.outlines.map((o) => o.id);
      let next = put(state, 'outlines', reviewedIn(state.outlines, null));
      if (!sameIds(next.litIds, ids)) next = put(next, 'litIds', ids);
      if (next.dirtyIds.length) next = put(next, 'dirtyIds', []);
      if (next.focusId !== null) next = put(next, 'focusId', null);
      return next;
    }

    /* ...OR LIGHT ONE. An ASSIGNMENT and not a union — this is "light this room
       and nothing else", which is what the button on a single space says — and
       it is the one lighting act that DOES select what it lit, because a person
       who asked for one room is looking at that room. */
    case 'ROOM_LIT': {
      const { id } = action;
      let next = put(state, 'outlines', reviewedIn(state.outlines, [id]));
      if (!sameIds(next.litIds, [id])) next = put(next, 'litIds', [id]);
      if (next.selectedOutlineId !== id) next = put(next, 'selectedOutlineId', id);
      if (next.focusId !== id) next = put(next, 'focusId', id);
      next = put(next, 'dirtyIds', dropFrom(next.dirtyIds, (x) => x === id));
      return next;
    }

    /* ...OR RELIGHT, WHICH IS THE PIPELINE'S OWN. `ids` null is the whole sheet.
       A UNION, NOT AN ASSIGNMENT. On a partial relight the spaces that were
       already lit have to STAY lit — assigning the subset here would blank the
       rest of the sheet, which is the very thing the partial-run change exists
       to stop happening. */
    case 'RELIT': {
      const { ids } = action;
      let next = put(state, 'outlines', reviewedIn(state.outlines, ids));
      const lit = ids
        ? [...next.litIds, ...ids.filter((id) => !next.litIds.includes(id))]
        : next.outlines.map((o) => o.id);
      if (!sameIds(next.litIds, lit)) next = put(next, 'litIds', lit);
      if (next.focusId !== null) next = put(next, 'focusId', null);
      return next;
    }

    /* WHAT A RUN ANSWERED IS NO LONGER OUTSTANDING. A full run clears the list
       outright; a partial one clears only the ids it was given, so a space
       somebody moved WHILE the run was going stays marked and is still offered.
       Separate from RELIT because it happens at the END of the run and the two
       are seconds apart — folding them together would clear the dirty flag of a
       space that was moved in between. */
    case 'DIRTY_CLEARED': {
      const { ids } = action;
      if (!ids) return state.dirtyIds.length ? put(state, 'dirtyIds', []) : state;
      return put(state, 'dirtyIds', dropFrom(state.dirtyIds, (x) => ids.includes(x)));
    }

    /* THE SEGMENTER ANSWERED — AND IT IS ONE ACTION FOR TWO FIELDS BECAUSE THE
       SECOND ONE REPORTS ON THE FIRST. `roomState.proposed` is how many
       proposals were actually ADDED, which is not what came back: a proposal
       that landed on a room the user had already corrected is dropped, and
       reporting it as found would have somebody looking for an outline that is
       not there. The old code got that number out of a `let` assigned from
       inside a `setState` updater — which a reducer may not do, because React is
       free to invoke it twice — so the count comes back through the return value
       instead and there is no side effect left to be invoked twice.

       `merge` IS A PURE `outlines -> { outlines, roomState }`, AND IT IS THE
       FIFTH FUNCTION-CARRYING ACTION IN THIS FILE. LIST_UPDATED says a fifth
       must argue for itself, so: the merge rule is MERGE, NEVER REPLACE —
       anything the user has TOUCHED survives, whether they drew it or dragged a
       corner of it — and it must therefore run against the LATEST outlines. This
       write lands when a network call returns, and the effect that started it
       has `[source, roomNonce]` for dependencies, so its closure's `outlines`
       is not one frame stale but potentially many seconds stale: a room traced
       by hand while the detector was thinking would be silently thrown away.
       That is the same failure LIST_UPDATED exists to prevent, in a worse form.
       The naming and the unit conversion inside `merge` both need the plan
       source, which is a memo, so they cannot move in here. */
    case 'ROOMS_PROPOSED': {
      const merged = action.merge(state.outlines);
      let next = put(state, 'outlines', merged.outlines);
      return put(next, 'roomState', merged.roomState);
    }

    /* --- domain 6a's one -------------------------------------------------- */

    /* HOW WIDE THE RULER IS. The door was picked first — `doorPick` already
       holds its id and the rect it was measured on — and this is the second
       half of that one act, so it PATCHES rather than replaces: a width written
       over the whole pick would lose the rect and the scale would go looking
       for the box in a list that can have changed since.
       NOTHING TO WIDEN IF NOTHING IS PICKED, which is what the `useState`
       updater this replaces said too: the width control only exists under a
       chosen door, so this is the unreachable branch made explicit rather than
       a silent write of `{ mm }` with no id on it. */
    case 'DOOR_WIDTH_SET': {
      const cur = state.doorPick;
      if (!cur || cur.mm === action.mm) return state;
      return put(state, 'doorPick', { ...cur, mm: action.mm });
    }

    /* --- domain 5's five. THREE OF THEM DECIDE WHICH STORE TO WRITE, and
       that decision is IN HERE for the reason SURFACE_TONE_SET's defaults are:
       resolved off `state`, it is always the latest, and resolved at the call
       site it is the state of the render that QUEUED the action. On the board
       drag that difference is a frame, and a frame in a drag is a stutter. */

    /* A PLATE SLID ALONG ITS WALL, AND THE WRITE FOLLOWS THE PLATE.
       A HAND-PLACED PLATE HAS ONE POSITION AND IT IS ITS OWN. `boardMoves` is an
       OVERRIDE — it exists so a RULE's board can be somewhere the rule did not
       put it, and so the card can say both. A board somebody dropped on a wall
       has no rule behind it, so writing a move for one would be storing "moved
       from" a position that was itself a hand position: two records of one fact,
       and a plate that could be reset to a place nobody ever chose. */
    case 'BOARD_SLID': {
      const { id, sFt } = action;
      if (state.manualBoards.some((m) => m.id === id)) {
        return put(state, 'manualBoards', patchIn(state.manualBoards, id, { sFt }));
      }
      return state.boardMoves[id] === sFt
        ? state
        : put(state, 'boardMoves', { ...state.boardMoves, [id]: sFt });
    }

    /* A PLATE DELETED, AND IT IS TWO VERBS. THE SAME DISTINCTION
       `accentDismissed` MAKES. A rule's board is DERIVED, so "not this one"
       cannot be expressed by removing it — the next render puts it straight
       back — and the answer is a dismissal that has to persist. A hand-placed
       board has no rule to come back from, so dismissing one would leave an id
       in `boardsOff` for the life of the plan, suppressing something that no
       longer exists. It is removed instead. */
    case 'BOARD_DELETED': {
      const { id } = action;
      if (state.manualBoards.some((m) => m.id === id)) {
        return put(state, 'manualBoards', dropFrom(state.manualBoards, (m) => m.id === id));
      }
      return state.boardsOff.includes(id)
        ? state
        : put(state, 'boardsOff', [...state.boardsOff, id]);
    }

    /* A PLATE MADE AN OUTLET, OR MADE A BOARD AGAIN.
       NOTHING IS MOVED, ADDED OR DELETED HERE, and that is the whole reason this
       is short. It writes one flag; everything the change is FOR then happens
       because the derivation reads that flag — the plate composes as one socket,
       it produces an outlet flow so a wire appears and the far board grows a
       switch for it, `servesBay` goes false so anything switched from it falls
       back to the next plate, and it drops out of the pool a dragged wire may be
       dropped on. Set it the other way and all four reverse, in the same way and
       for the same reason. Nothing has to go and remove them.
       BACK TO NOTHING RATHER THAN TO A VALUE, when the flag matches what the
       plate was born as AND there is no rating riding along. `born` comes in
       with the action because it is read off the DERIVED plate — hand-placed
       ones are outlets, everything a rule put on a wall is a board, and `placed`
       survives the outlet transform (see `asOutlet`) so it is readable in either
       state. What is stored is only what somebody CHANGED. */
    case 'BOARD_OUTLET_SET': {
      const { id, outlet, born } = action;
      const m = state.boardKinds;
      const cur = m[id] ?? {};
      if (outlet === born && cur.amps == null) {
        if (!(id in m)) return state;
        const out = { ...m }; delete out[id];
        return put(state, 'boardKinds', out);
      }
      if (cur.outlet === outlet) return state;
      return put(state, 'boardKinds', { ...m, [id]: { ...cur, outlet } });
    }

    /* A WIRE DROPPED ON A PLATE.
       A DROP ON THE PLATE IT WAS ALREADY ON CLEARS THE OVERRIDE rather than
       storing it, which is the way back: dragging a wire home puts it back under
       the rules instead of pinning it to the answer the rules happen to give
       today. `home` is decided at the call site because it needs `flowsPx` —
       whether the wire is ALREADY on that plate is a fact about the derivation,
       which is the one thing the document may not contain. */
    case 'FLOW_BOARD_SET': {
      const { flowId, boardId, home } = action;
      const m = state.flowBoards;
      if (home) {
        if (!(flowId in m)) return state;
        const out = { ...m }; delete out[flowId];
        return put(state, 'flowBoards', out);
      }
      return m[flowId] === boardId ? state : put(state, 'flowBoards', { ...m, [flowId]: boardId });
    }

    /* DELETE ON A SELECTED WIRE, WHICH MEANS "UNDO WHAT I DID TO IT".
       A FLOW CANNOT BE DELETED: it is the switch a fitting needs, it is derived
       from the fittings, and removing it from the drawing would be claiming a
       lamp with no way to turn it on. So the only thing there is to take away is
       the PAIR of overrides — the plate it was dragged onto and the bends it was
       nudged into — and one action takes both, because putting a wire back under
       the rules is one act and half of it is not a state anybody asked for. */
    case 'FLOW_OVERRIDES_DROPPED': {
      const { flowId } = action;
      let next = state;
      for (const field of ['flowBoards', 'flowBends']) {
        const m = next[field];
        if (!(flowId in m)) continue;
        const out = { ...m }; delete out[flowId];
        next = put(next, field, out);
      }
      return next;
    }

    /* --- A WHOLE FIELD, WRITTEN. TWO NAMES, ONE BODY, AND THE NAMES MATTER.
       `FIELD_SET` is an EDIT: the scalar fields — a flag confirmed, a mode
       chosen, a viewport moved — have no shape to them, so there is nothing for
       a per-field case to own and the field is simply a parameter.
       `DOC_FIELD_RESTORED` IS NOT AN EDIT. It replaces a field wholesale for
       exactly two callers — `applyEditor` opening a saved plan and `applyStep`
       applying an undo step — and it is deliberately blunt: the optional-key
       defaulting that lets a plan saved last year still open lives in
       `applyEditor` and must stay there, so what arrives here is already the
       value that plan restores to.
       THE TWO ARE NOT MERGED BECAUSE THE HEADER'S CLAIM ABOUT THE RESTORE DOOR
       HAS TO STAY CHECKABLE — "two callers" is a thing somebody can grep for,
       and it stops being true the moment an edit borrows the restore action.
       THE BODY IS SHARED SO THE NO-OP BAILOUT CANNOT DRIFT between them: a
       restore of the value already there is not a change either, which is what
       stops opening a plan from looking like an edit. */
    case 'FIELD_SET':
    case 'DOC_FIELD_RESTORED': {
      const { field, value } = action;
      if (!(field in DOC_FIELDS)) return state;
      return put(state, field, value);
    }

    default:
      return state;
  }
}

/* WHICH FIELDS CTRL+Z LEAVES ALONE, resolved against the fields that actually
   exist. Read from planState.js's own list rather than restated, because a
   second copy of it is the bug this file exists to remove — see NOT_UNDOABLE
   there. Fields not yet migrated simply are not in here yet, which is the
   honest reading during the migration and is what the test asserts. */
export const heldBackFields = () =>
  NOT_UNDOABLE.filter((field) => field in DOC_FIELDS);

/**
 * THE DOCUMENT AND THE TWO WAYS TO CHANGE IT.
 *
 * Returns `[doc, actions, setters]`.
 *
 * `actions` is the EDITS — one entry per thing a person can do, and the only
 * door the UI uses. `setters` is the RESTORE — one `setX` per field, named as
 * `applyEditor` expects to find it, and used by exactly two callers: opening a
 * saved plan and applying an undo step.
 *
 * Both are stable for the life of the component — every entry closes over
 * `dispatch` and nothing else — which is what lets the handlers that call them
 * stay in `useCallback` with empty dependency arrays, exactly as they did when
 * they closed over a `useState` setter.
 *
 * `setters` IS GENERATED FROM THE FIELD TABLE and not written out, which is the
 * point of the whole exercise: the bag cannot be missing a field the document
 * has, because it is built from the document's own list.
 */
export function usePlanDoc(seed) {
  /* THE SEED IS READ ONCE. `useReducer`'s third argument runs on the first
     render only, which is exactly the lifetime `useState(prop)` had — see
     `initialDoc`. A later change to the prop does not reach the document, and
     did not before either: what re-applies it is `resetForNewPlan`, on every
     file load. */
  const [doc, dispatch] = useReducer(docReducer, seed, initialDoc);

  const actions = useMemo(() => ({
    setCeilingMm: (id, raw, { min, max }) =>
      dispatch({ type: 'CEILING_MM_SET', id, raw, min, max }),
    setSurfaceTone: (id, surface, tone) =>
      dispatch({ type: 'SURFACE_TONE_SET', id, surface, tone }),
    setWallTone: (id, edge, tone) =>
      dispatch({ type: 'WALL_TONE_SET', id, edge, tone }),
    setRowWatts: (roomId, key, watts, defaultWatts) =>
      dispatch({ type: 'ROW_WATTS_SET', roomId, key, watts, defaultWatts }),

    /* --- domain 2 -----------------------------------------------------------
       ONE NAMED CREATOR PER EDIT THAT EXISTS TODAY. The generic reducer cases
       are the mechanics; these are the vocabulary, and a call site can only ask
       for an edit its own field actually has — there is no `patchCove`, because
       nothing patches a cove. */
    clearCoves: () => dispatch({ type: 'LIST_CLEARED', field: 'manualCoves' }),
    addCove: (cove) => dispatch({ type: 'LIST_ADDED', field: 'manualCoves', item: cove }),
    removeCove: (id) => dispatch({ type: 'LIST_REMOVED', field: 'manualCoves', id }),

    clearTracks: () => dispatch({ type: 'LIST_CLEARED', field: 'manualTracks' }),
    addTrack: (track, stamp) => dispatch({ type: 'LIST_ADDED_MINTED',
      field: 'manualTracks', idPrefix: 'mtrack', stamp, item: track }),
    patchTrack: (id, patch) => dispatch({ type: 'LIST_PATCHED', field: 'manualTracks', id, patch }),
    removeTrack: (id) => dispatch({ type: 'LIST_REMOVED', field: 'manualTracks', id }),

    addCob: (cob) => dispatch({ type: 'LIST_ADDED', field: 'manualCobs', item: cob }),
    removeCob: (id) => dispatch({ type: 'LIST_REMOVED', field: 'manualCobs', id }),
    removeCobs: (ids) => dispatch({ type: 'LIST_REMOVED_MANY', field: 'manualCobs', ids }),
    setCobSpec: (id, patch) => dispatch({ type: 'COB_SPEC_SET', id,
      watts: patch.watts, beam: patch.beam }),
    dropAutoCobs: (roomId) => dispatch({ type: 'AUTO_COBS_DROPPED', roomId }),
    /* THE TWO THAT HAND OVER A FINISHED LIST, AND WHY THEY HAVE TO.
       Autoplacing a room and re-deriving every unspecified lamp's wattage are
       both computed from `rooms`, `pxPerFt` and `cobBasisFor` — memos, i.e.
       DERIVED state, which is the one thing the document may not contain (see
       the header). So App does the arithmetic and the reducer does the write.
       Both callers already return the list unchanged when nothing moved, and
       LIST_REPLACED honours that by reference, so the undo granularity is the
       same as it was. This is the seam, and it should stay two callers wide. */
    replaceCobs: (next) => dispatch({ type: 'LIST_REPLACED', field: 'manualCobs', next }),
    /* THE PER-FRAME SEAM. Handed to hooks/useDrag.js as its `setList`, which
       requires updater semantics — see LIST_UPDATED. */
    updateCobs: (update) => dispatch({ type: 'LIST_UPDATED', field: 'manualCobs', update }),

    addArray: (array, stamp) => dispatch({ type: 'LIST_ADDED_MINTED',
      field: 'cobArrays', idPrefix: 'carr', stamp, item: array }),
    removeArray: (id) => dispatch({ type: 'LIST_REMOVED', field: 'cobArrays', id }),
    setArraySpec: (id, patch) => dispatch({ type: 'LIST_PATCHED', field: 'cobArrays', id,
      patch: { ...(patch.watts != null ? { watts: clampWatts(patch.watts) } : {}),
               ...(patch.beam != null ? { beam: nearestBeam(patch.beam) } : {}) } }),
    setArrayShape: (id, patch, quantise) => dispatch({ type: 'ARRAY_SHAPE_SET', id,
      count: patch.count, side: patch.side, offsetFt: patch.offsetFt, quantise }),
    patchArray: (id, patch) => dispatch({ type: 'LIST_PATCHED', field: 'cobArrays', id, patch }),
    /* THE ARRAY'S OWN PER-FRAME DRAG — `useDrag`'s `setList` again. */
    updateArrays: (update) => dispatch({ type: 'LIST_UPDATED', field: 'cobArrays', update }),

    clearTrackFixtures: () => dispatch({ type: 'LIST_CLEARED', field: 'trackFixtures' }),
    addTrackFixtures: (items) => dispatch({ type: 'LIST_ADDED_MANY',
      field: 'trackFixtures', items }),
    patchTrackFixture: (id, patch) =>
      dispatch({ type: 'LIST_PATCHED', field: 'trackFixtures', id, patch }),
    removeTrackFixture: (id) => dispatch({ type: 'LIST_REMOVED', field: 'trackFixtures', id }),
    setTrackModuleSpec: (id, patch) => dispatch({ type: 'TRACK_MODULE_SPEC_SET', id,
      watts: patch.watts, beam: patch.beam }),
    dropTrackModules: (trackId) => dispatch({ type: 'TRACK_MODULES_DROPPED', trackId }),

    setAutoplace: (roomId, on) =>
      dispatch({ type: on ? 'ID_ADDED' : 'ID_REMOVED', field: 'autoSpots', id: roomId }),

    /* --- domain 3 ---------------------------------------------------------- */
    clearShapes: () => dispatch({ type: 'LIST_CLEARED', field: 'ceilingShapes' }),
    addShape: (shape) => dispatch({ type: 'LIST_ADDED', field: 'ceilingShapes', item: shape }),
    patchShape: (id, patch) =>
      dispatch({ type: 'LIST_PATCHED', field: 'ceilingShapes', id, patch }),
    removeShape: (id) => dispatch({ type: 'LIST_REMOVED', field: 'ceilingShapes', id }),
    /* THE DRAG AND THE RESIZE BOTH GO THROUGH THE UPDATER, and both are
       per-frame: the resize recomputes from where the pointer is NOW, and the
       drag is `useDrag`'s `setList`. See LIST_UPDATED. */
    updateShapes: (update) => dispatch({ type: 'LIST_UPDATED', field: 'ceilingShapes', update }),

    clearChunkPicks: () => dispatch({ type: 'MAP_CLEARED', field: 'chunkPicks' }),
    setChunkPick: (roomId, strategyId) =>
      dispatch({ type: 'MAP_ENTRY_SET', field: 'chunkPicks', key: roomId, value: strategyId }),

    clearDesignPicks: () => dispatch({ type: 'MAP_CLEARED', field: 'designPicks' }),
    setDesignPick: (roomId, picks) =>
      dispatch({ type: 'MAP_ENTRY_SET', field: 'designPicks', key: roomId, value: picks }),

    /* THE ONLY THING THAT HAPPENS TO `ceilingKinds` ANY MORE. No UI writes it —
       the decision moved to the chunk — and it is still in the document so a
       plan made under the old switch keeps its coves. See planState.js. */
    clearCeilingKinds: () => dispatch({ type: 'MAP_CLEARED', field: 'ceilingKinds' }),

    /* --- domain 4 -----------------------------------------------------------
       THE THREE-WAY SPLIT SHOWS UP HERE AS THREE VOCABULARIES. A pass's answer
       is MERGED (it arrives a roomful at a time); a dismissal is an ID ADDED to
       a set (pressing Delete twice on one fitting is one document); a
       hand-placed fitting is ADDED and REMOVED like any other object. Reading
       the three lists of creators is meant to make the ownership obvious. */
    clearAccentResults: () => dispatch({ type: 'MAP_CLEARED', field: 'accentResults' }),
    mergeAccentResults: (entries) =>
      dispatch({ type: 'MAP_MERGED', field: 'accentResults', entries }),
    clearAccentDismissed: () => dispatch({ type: 'LIST_CLEARED', field: 'accentDismissed' }),
    dismissAccent: (id) => dispatch({ type: 'ID_ADDED', field: 'accentDismissed', id }),
    /* THE DISMISSALS OF THE ROOMS THAT WERE JUST RE-READ. See
       ROOM_DISMISSALS_DROPPED: the prefix is the id namespace and it stays in
       the reducer. */
    dropAccentDismissals: (roomIds) => dispatch({ type: 'ROOM_DISMISSALS_DROPPED',
      field: 'accentDismissed', prefix: 'acc', roomIds }),

    addAccent: (zone) => dispatch({ type: 'LIST_ADDED', field: 'manualAccents', item: zone }),
    removeAccent: (id) => dispatch({ type: 'LIST_REMOVED', field: 'manualAccents', id }),
    clearAccents: () => dispatch({ type: 'LIST_CLEARED', field: 'manualAccents' }),
    /* THE PER-FRAME SEAM FOR A FITTING THAT LIVES IN TWO STORES. One action
       because it is one act — see ACCENT_ZONE_UPDATED for the bug this shape
       exists to have fixed, and for why `fn` is allowed to be a function. */
    updateAccentZone: (roomId, id, fn) =>
      dispatch({ type: 'ACCENT_ZONE_UPDATED', roomId, id, fn }),

    clearSurfaceResults: () => dispatch({ type: 'MAP_CLEARED', field: 'surfaceResults' }),
    mergeSurfaceResults: (entries) =>
      dispatch({ type: 'MAP_MERGED', field: 'surfaceResults', entries }),
    clearSurfaceDismissed: () => dispatch({ type: 'LIST_CLEARED', field: 'surfaceDismissed' }),
    dismissSurface: (id) => dispatch({ type: 'ID_ADDED', field: 'surfaceDismissed', id }),
    dropSurfaceDismissals: (roomIds) => dispatch({ type: 'ROOM_DISMISSALS_DROPPED',
      field: 'surfaceDismissed', prefix: 'surf', roomIds }),

    addSurface: (surface) =>
      dispatch({ type: 'LIST_ADDED', field: 'manualSurfaces', item: surface }),
    removeSurface: (id) => dispatch({ type: 'LIST_REMOVED', field: 'manualSurfaces', id }),
    clearSurfaces: () => dispatch({ type: 'LIST_CLEARED', field: 'manualSurfaces' }),

    /* THE PIECE OF ART NOBODY WANTS LIT. A dismissal and not a delete: the
       painting stays in the render pass's reading of the wall. */
    dismissArt: (wallId) => dispatch({ type: 'ID_ADDED', field: 'artDismissed', id: wallId }),
    clearArtDismissed: () => dispatch({ type: 'LIST_CLEARED', field: 'artDismissed' }),

    clearWallResults: () => dispatch({ type: 'MAP_CLEARED', field: 'wallResults' }),
    setWallResult: (roomId, result) =>
      dispatch({ type: 'MAP_ENTRY_SET', field: 'wallResults', key: roomId, value: result }),

    clearRunTrims: () => dispatch({ type: 'MAP_CLEARED', field: 'runTrims' }),
    /* ONE END, IN FEET, ALREADY ROUNDED. The rounding is the call site's because
       it needs `pxPerFt`; the sparse rule is the reducer's. See RUN_TRIM_SET. */
    setRunTrim: (trimId, end, ft) => dispatch({ type: 'RUN_TRIM_SET', trimId, end, ft }),
    /* A DERIVED RUN, DELETED. Its own list and not `accentDismissed`, because it
       is applied where the COVE is built rather than where its tape is. */
    dropRun: (runId) => dispatch({ type: 'ID_ADDED', field: 'runsOff', id: runId }),

    /* THE DOORS. `replaceDoors` carries the detector's finished answer — the one
       honest LIST_REPLACED outside the derived-state seam, because what is being
       written is not computed from the document at all: it is what came back
       over the wire. */
    replaceDoors: (found) => dispatch({ type: 'LIST_REPLACED', field: 'doors', next: found }),
    clearDoors: () => dispatch({ type: 'LIST_CLEARED', field: 'doors' }),
    addDoor: (door) => dispatch({ type: 'LIST_ADDED', field: 'doors', item: door }),
    removeDoor: (id) => dispatch({ type: 'LIST_REMOVED', field: 'doors', id }),
    /* THE RELEASE OF A DOOR DRAG, AND THE ONLY WRITE IT MAKES. See the door
       gesture in App: a move written on every pointermove would re-run the board
       pass, the bay pass and the flows forty times a second. */
    moveDoor: (id, patch) => dispatch({ type: 'LIST_PATCHED', field: 'doors', id, patch }),
    setDoorsOk: (ok) => dispatch({ type: 'FIELD_SET', field: 'doorsOk', value: ok }),

    addZone: (zone) => dispatch({ type: 'LIST_ADDED', field: 'zones', item: zone }),
    removeZone: (id) => dispatch({ type: 'LIST_REMOVED', field: 'zones', id }),
    clearZones: () => dispatch({ type: 'LIST_CLEARED', field: 'zones' }),

    /* --- domain 5 -----------------------------------------------------------
       NOTE HOW FEW OF THESE TAKE A FINISHED VALUE. Almost every edit an
       electrical drawing accepts is "this plate, this much" or "this wire, that
       board" — the rules work out the rest on the next render — so the
       vocabulary here is deliberately narrow, and the two that DO carry a
       computed value (`reorderBoardUnit`'s list and the drag's arc length) say
       why at their call sites. */
    clearBoardsOff: () => dispatch({ type: 'LIST_CLEARED', field: 'boardsOff' }),
    clearBoardMoves: () => dispatch({ type: 'MAP_CLEARED', field: 'boardMoves' }),
    clearBoardPoints: () => dispatch({ type: 'MAP_CLEARED', field: 'boardPoints' }),
    /* A PLATE SLID ALONG ITS WALL — one of the two per-frame writes in this
       domain. Which store it lands in is decided in the reducer; see BOARD_SLID
       for why that is not the call site's business. */
    slideBoard: (id, sFt) => dispatch({ type: 'BOARD_SLID', id, sFt }),
    /* ...AND PUT ONE BACK WHERE ITS RULE WANTED IT. Back to NOTHING rather than
       to the rule's own number — see MAP_ENTRY_REMOVED. */
    resetBoard: (id) => dispatch({ type: 'MAP_ENTRY_REMOVED', field: 'boardMoves', key: id }),
    /* A PLATE DELETED, WHICH IS A DISMISSAL OR A REMOVAL depending on whether
       anything derives it. See BOARD_DELETED. */
    deleteBoard: (id) => dispatch({ type: 'BOARD_DELETED', id }),

    addBoardPoint: (boardId, point) =>
      dispatch({ type: 'MAP_LIST_APPENDED', field: 'boardPoints', key: boardId, item: point }),
    removeBoardPoint: (boardId, pointId) =>
      dispatch({ type: 'MAP_LIST_REMOVED', field: 'boardPoints', key: boardId, id: pointId }),

    clearManualBoards: () => dispatch({ type: 'LIST_CLEARED', field: 'manualBoards' }),
    addManualBoard: (board) =>
      dispatch({ type: 'LIST_ADDED', field: 'manualBoards', item: board }),

    clearBoardKinds: () => dispatch({ type: 'MAP_CLEARED', field: 'boardKinds' }),
    /* `born` IS WHAT THE PLATE WAS BORN AS and it comes off the derived plate —
       see BOARD_OUTLET_SET, which is where the "an entry that only restates the
       default is deleted" rule lives. */
    setBoardOutlet: (id, outlet, born) =>
      dispatch({ type: 'BOARD_OUTLET_SET', id, outlet, born }),
    /* RE-RATE THE SOCKET. Patched into the entry rather than written over it,
       because the outlet flag lives beside the rating and must survive. */
    setBoardAmps: (id, amps) =>
      dispatch({ type: 'MAP_ENTRY_PATCHED', field: 'boardKinds', key: id, patch: { amps } }),

    clearBoardHeights: () => dispatch({ type: 'MAP_CLEARED', field: 'boardHeights' }),
    setBoardHeight: (id, mm) =>
      dispatch({ type: 'MAP_ENTRY_SET', field: 'boardHeights', key: id, value: mm }),

    clearBoardOrders: () => dispatch({ type: 'MAP_CLEARED', field: 'boardOrders' }),
    /* THE WHOLE ARRANGEMENT, REWRITTEN FROM WHAT IS ON SCREEN. The one place in
       this domain that takes a finished list, and it has to: the order is
       rebuilt from `units`, which is derived from the flows that reach the
       plate. See `reorderBoardUnit`. */
    setBoardOrder: (id, keys) =>
      dispatch({ type: 'MAP_ENTRY_SET', field: 'boardOrders', key: id, value: keys }),

    clearFlowBoards: () => dispatch({ type: 'MAP_CLEARED', field: 'flowBoards' }),
    clearFlowBends: () => dispatch({ type: 'MAP_CLEARED', field: 'flowBends' }),
    /* A WIRE DROPPED ON A PLATE, or dropped home — see FLOW_BOARD_SET. */
    setFlowBoard: (flowId, boardId, home) =>
      dispatch({ type: 'FLOW_BOARD_SET', flowId, boardId, home }),
    /* ONE LEG'S ARC, NUDGED. The other per-frame write in this domain, and the
       reason MAP_ENTRY_PATCHED has a bailout at all. */
    setFlowBend: (flowId, legKey, ft) => dispatch({ type: 'MAP_ENTRY_PATCHED',
      field: 'flowBends', key: flowId, patch: { [legKey]: ft } }),
    /* AND BOTH OVERRIDES OFF ONE WIRE, WHICH IS ONE ACT. See
       FLOW_OVERRIDES_DROPPED. */
    dropFlowOverrides: (flowId) => dispatch({ type: 'FLOW_OVERRIDES_DROPPED', flowId }),

    /* --- domain 6a ----------------------------------------------------------
       MOSTLY PLAIN WRITES, AND THAT IS THE HONEST SHAPE. These fields have no
       structure to have a rule about: a mode is chosen, a page is a number, a
       unit override is a string or null. The four with a rule in them are the
       door's width (which patches, so the rect survives), the room types (which
       MERGE, a roomful at a time), and the two resets.

       FOUR OF THESE ARE HANDED TO A CHILD AS PROPS — see the `scale` object in
       App.jsx, where `setMode`, `setRefId`, `setCustomFt` and `setMeasure` go to
       OutlineTracer. The child calls them with a plain VALUE, which is why these
       creators take one: a bare `dispatch` is not a setter and the child must
       not have to know that. */
    setUnitId: (id) => dispatch({ type: 'FIELD_SET', field: 'unitId', value: id }),
    setPdfPage: (page) => dispatch({ type: 'FIELD_SET', field: 'pdfPage', value: page }),

    setScaleMode: (mode) => dispatch({ type: 'FIELD_SET', field: 'scaleMode', value: mode }),
    setRefId: (id) => dispatch({ type: 'FIELD_SET', field: 'refId', value: id }),
    setCustomFt: (ft) => dispatch({ type: 'FIELD_SET', field: 'customFt', value: ft }),
    setMeasure: (m) => dispatch({ type: 'FIELD_SET', field: 'measure', value: m }),
    clearMeasure: () => dispatch({ type: 'FIELD_SET', field: 'measure',
                                  value: { a: null, b: null } }),
    /* THE WHOLE PICK, RECT AND ALL — see `doorPick`. Null un-picks. */
    setDoorPick: (pick) => dispatch({ type: 'FIELD_SET', field: 'doorPick', value: pick }),
    /* ...AND THE WIDTH, WHICH IS THE SECOND HALF OF ONE ACT. See
       DOOR_WIDTH_SET for why it patches. */
    setDoorWidth: (mm) => dispatch({ type: 'DOOR_WIDTH_SET', mm }),

    /* THE KIND OF BUILDING. `projectType` and not `projectId`, which is what
       App calls its own variable and is the one thing this is not. */
    setProjectType: (kind) =>
      dispatch({ type: 'FIELD_SET', field: 'projectType', value: kind }),
    clearRoomTypes: () => dispatch({ type: 'MAP_CLEARED', field: 'roomTypes' }),
    /* A ROOMFUL AT A TIME AND MERGED, NOT REPLACED. `setRoomTypes(found)` used
       to REPLACE, which meant re-reading two spaces threw away the answers for
       the other six — see the note at the classify pass in
       features/lighting-planner/usePlanPipeline.js. */
    mergeRoomTypes: (entries) =>
      dispatch({ type: 'MAP_MERGED', field: 'roomTypes', entries }),

    /* --- domain 6b ----------------------------------------------------------
       THE LIGHTING ACTS ARE THREE AND NOT ONE WITH A FLAG. `lightWholePlan`,
       `lightOneRoom` and the pipeline's relight differ in what they do to the
       SELECTION and in whether the lit list is assigned or unioned, and a single
       creator with two booleans would read as one act that behaves three ways.
       See PLAN_LIT, ROOM_LIT and RELIT. */
    clearOutlines: () => dispatch({ type: 'LIST_CLEARED', field: 'outlines' }),
    addOutline: (outline) =>
      dispatch({ type: 'LIST_ADDED', field: 'outlines', item: outline }),
    /* A RENAME, OR THE RIGHT-ANGLES SWITCH. Whether it counts as a CHANGE — and
       therefore marks the space dirty — is App's decision, not this one: see
       `updateOutline`, where `rectify` marks and a rename does not. */
    patchOutline: (id, patch) =>
      dispatch({ type: 'LIST_PATCHED', field: 'outlines', id, patch }),
    /* ...AND ITS CORNERS, which carry a function because the conversion needs
       the plan source. See OUTLINE_POINTS_EDITED. */
    editOutlinePoints: (id, edit) =>
      dispatch({ type: 'OUTLINE_POINTS_EDITED', id, edit }),
    /* A SPACE DELETED, WITH EVERYTHING THAT REFERRED TO IT. */
    deleteOutline: (id) => dispatch({ type: 'OUTLINE_DELETED', id }),
    /* THE SEGMENTER'S ANSWER, MERGED AGAINST THE LATEST OUTLINES. See
       ROOMS_PROPOSED for why this one carries a function. */
    proposeOutlines: (merge) => dispatch({ type: 'ROOMS_PROPOSED', merge }),

    lightWholePlan: () => dispatch({ type: 'PLAN_LIT' }),
    lightOneRoom: (id) => dispatch({ type: 'ROOM_LIT', id }),
    relight: (ids) => dispatch({ type: 'RELIT', ids: ids ?? null }),
    clearLit: () => dispatch({ type: 'LIST_CLEARED', field: 'litIds' }),
    /* UNLIGHT ONE SPACE. Delete on a focused space takes it out of the LAYOUT
       and leaves the outline — see the keydown handler. */
    unlightRoom: (id) => dispatch({ type: 'ID_REMOVED', field: 'litIds', id }),

    /* A LIT SPACE WHOSE ANSWERS HAVE GONE STALE. The "only if it is lit" rule
       stays in `markChanged` in hooks/useOutlines.js, which reads `litIds`
       through a ref for a
       reason worth keeping — see the note there. */
    markDirty: (id) => dispatch({ type: 'ID_ADDED', field: 'dirtyIds', id }),
    clearDirty: (ids) => dispatch({ type: 'DIRTY_CLEARED', ids: ids ?? null }),

    setFocusId: (id) => dispatch({ type: 'FIELD_SET', field: 'focusId', value: id }),
    setSelectedOutlineId: (id) =>
      dispatch({ type: 'FIELD_SET', field: 'selectedOutlineId', value: id }),
    setRoomState: (st) => dispatch({ type: 'FIELD_SET', field: 'roomState', value: st }),

    /* THE DETECTOR'S ANSWER REPLACES THE LOT — it is one call over the whole
       sheet, so a partial write would be an answer to a question nobody asked. */
    replaceDetections: (found) =>
      dispatch({ type: 'LIST_REPLACED', field: 'detections', next: found }),
    clearDetections: () => dispatch({ type: 'LIST_CLEARED', field: 'detections' }),
    /* ...AND THE ADMIN'S "LOOK AGAIN", WHICH APPENDS. It re-reads a few rooms and
       adds what it finds, so the boxes on the rest of the sheet stay. */
    addDetections: (found) =>
      dispatch({ type: 'LIST_ADDED_MANY', field: 'detections', items: found }),
    dismissDetection: (id) => dispatch({ type: 'ID_ADDED', field: 'dismissed', id }),
    clearDismissed: () => dispatch({ type: 'LIST_CLEARED', field: 'dismissed' }),

    setBedVerdicts: (verdicts) =>
      dispatch({ type: 'FIELD_SET', field: 'bedVerdicts', value: verdicts }),
    mergeBedVerdicts: (verdicts) =>
      dispatch({ type: 'MAP_MERGED', field: 'bedVerdicts', entries: verdicts }),
    clearBedVerdicts: () => dispatch({ type: 'MAP_CLEARED', field: 'bedVerdicts' }),

    setProvider: (id) => dispatch({ type: 'FIELD_SET', field: 'provider', value: id }),

    /* --- domain 6c ---------------------------------------------------------- */
    clearObjects: () => dispatch({ type: 'LIST_CLEARED', field: 'ceilingObjs' }),
    addObject: (obj) => dispatch({ type: 'LIST_ADDED', field: 'ceilingObjs', item: obj }),
    removeObjects: (ids) =>
      dispatch({ type: 'LIST_REMOVED_MANY', field: 'ceilingObjs', ids }),
    /* THE DRAG, THE RESIZE AND THE ROTATE — all three per-frame, and all three
       through the updater. Handed to hooks/useDrag.js as its `setList`, which
       requires updater semantics; the resize and the rotate recompute from where
       the pointer is NOW against the object as it was at the PRESS. See
       LIST_UPDATED, whose fifth caller this is and whose argument it is. */
    updateObjects: (update) =>
      dispatch({ type: 'LIST_UPDATED', field: 'ceilingObjs', update }),
    /* ...AND THE ONE EDIT THAT IS A RULE RATHER THAN A SHAPE. See
       OBJECT_SWEEP_SET for why the non-fans are ignored rather than refused. */
    setObjectSweep: (ids, mm) => dispatch({ type: 'OBJECT_SWEEP_SET', ids, mm }),

    clearLightMoves: () => dispatch({ type: 'MAP_CLEARED', field: 'lightMoves' }),
    /* THE PER-FRAME NUDGE. The feet come in already worked out because getting
       there needs the room's origin and `pxPerFt`; the sparse rule is in here. */
    moveLight: (roomId, cellKey, dx, dy) =>
      dispatch({ type: 'LIGHT_MOVED', roomId, cellKey, dx, dy }),
    resetLightMove: (roomId, cellKey) =>
      dispatch({ type: 'LIGHT_MOVE_RESET', roomId, cellKey }),

    clearRenderRefs: () => dispatch({ type: 'MAP_CLEARED', field: 'renderRefs' }),
    /* ONE MORE VIEW STORED FOR A ROOM. The map's values are LISTS — a room can
       have several renders — which is why this is the map-of-lists op and not
       MAP_ENTRY_SET. See planState.js on what a pointer is and is not. */
    addRenderRef: (roomId, ref) => dispatch({ type: 'MAP_LIST_APPENDED',
      field: 'renderRefs', key: roomId, item: ref }),

    /* THE LAYER SWITCHES. `setLayer` is idempotent and `toggleLayer` is not,
       deliberately — see LAYER_SET. */
    setLayer: (key, on) => dispatch({ type: 'LAYER_SET', key, on }),
    toggleLayer: (key) => dispatch({ type: 'LAYER_TOGGLED', key }),

    setZoom: (to) => dispatch({ type: 'ZOOM_SET', to }),
    scaleZoom: (by) => dispatch({ type: 'ZOOM_SCALED', by }),

    setView: (value) => dispatch({ type: 'FIELD_SET', field: 'view', value }),
    /* THE TWO CONDITIONAL MOVES, each named for what asks for it rather than for
       what it does to the field. See STAGE_VIEW_REQUIRED and
       DESIGN_VIEW_REQUESTED. */
    requireStageView: () => dispatch({ type: 'STAGE_VIEW_REQUIRED' }),
    requestDesignView: () => dispatch({ type: 'DESIGN_VIEW_REQUESTED' }),
  }), []);

  /* THE RESTORE DOOR, ONE SHIM PER FIELD. `applyEditor` calls these with the
     value a saved plan restores to — already defaulted through its own `??`, so
     the optional-key handling that lets a plan saved last year still open stays
     where it is and is not duplicated here. */
  const setters = useMemo(() => {
    const bag = {};
    for (const field of Object.keys(DOC_FIELDS)) {
      bag[setterFor(field)] = (value) =>
        dispatch({ type: 'DOC_FIELD_RESTORED', field, value });
    }
    return bag;
  }, []);

  return [doc, actions, setters];
}
