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
import { NOT_UNDOABLE, setterFor } from '../lib/planState.js';
import { materialsOf } from '../lib/materials.js';
import { clampWatts, nearestBeam } from '../lib/cob.js';

/* --- THE FIELDS, AND THE ONLY LIST OF THEM --------------------------------
   Field name -> what it starts as. The initial value is a FUNCTION because
   objects and arrays here are mutable defaults: one shared `{}` handed to every
   field would make two fields the same object.

   THIS TABLE IS THE DOCUMENT. `serialiseEditor` reads the object it produces,
   `applyEditor` writes into it, the undo stack diffs it, and the test asserts
   all three cover exactly these names. Adding a field is adding a line here.

   MIGRATION IN PROGRESS. Thirteen of sixty-one fields live here so far. The
   rest are still `useState` in App.jsx and are spread into the same document at
   the call site; see the note on `editorState`. The list grows one domain at a
   time and the test's coverage walk is what says which domain a field is in. */
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

/** The document as it starts: every field at its own default, and no others. */
export function initialDoc() {
  const doc = {};
  for (const [field, make] of Object.entries(DOC_FIELDS)) doc[field] = make();
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

    /* --- THE EDITS THAT ARE NOT A SHAPE ------------------------------------
       Four, and each one is here rather than in a generic case because the rule
       it applies is about THIS field and nothing else. A generic op with a
       predicate handed in from the call site would put the rule back in App. */

    /* THE TOGGLE GOING OFF TAKES BACK ONLY WHAT IS STILL THE TOGGLE'S. A lamp
       somebody has re-specified or dragged is theirs and stops being autoplace's
       to remove — see `autoplaceIn` in App and the `auto` flag on the fitting.
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

    /* A SAVED PLAN, OR AN UNDO STEP. See the note above the switch. */
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
export function usePlanDoc() {
  const [doc, dispatch] = useReducer(docReducer, undefined, initialDoc);

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
