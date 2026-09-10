import { useCallback, useMemo, useState } from 'react';
import { clampZoom, LAYER_DEFAULTS } from '../lib/planState.js';

// ---------------------------------------------------------------------------
// useViewPrefs — the editor's view state, in one place.
//
// `layers`, `zoom` and `view` are saved-plan fields, so their store remains the
// document reducer and this hook reads them from `doc`. The other preferences
// are session-only: they describe an open drop target, an in-progress rename,
// or temporary diagnostic ink and must never enter the saved document.
//
// `stageRef` stays in App because panning and pointer handling share it. The
// hook only reads it to answer the view-domain question “what zoom fits?”.
// ---------------------------------------------------------------------------
export default function useViewPrefs({ doc, source, stageRef }) {
  // The layer switches, the zoom and the tab are all in the document reducer —
  // see the domain-6c block in usePlanDoc.js. All three are saved (a plan
  // reopens the way it was left) and all three are held back from undo.
  // WHICH HALF OF THE DELIVERABLE IS ON SCREEN. A schedule is not a second view
  // of the drawing — it is the other half of what leaves the studio, read at a
  // different moment by a different person. So it replaces the canvas rather
  // than crowding it.
  /* THE SPACES TAB IS WHERE THIS OPENS NOW, and it used to be Design. The
     Design tab was the toolbox — two palettes and a View disclosure — and the
     palettes are the left-hand rail (see ToolRail); what a plan opens ON should
     be what it is FOR, which is the list of spaces and what each of them is.
     A saved plan still comes back on whatever tab it was left on: this is the
     default, not an override — see `ui.view` in planState.js. */
  const { zoom, view } = doc;

  /* --- A COMPLETE SET OF LAYERS, AND THIS IS THE ONE PLACE IT IS MADE ------
     A MISSING KEY MUST NEVER READ AS OFF, and until this memo existed it did.
     `layers` reaches the app from three places: the reducer's initial value (a
     spread of LAYER_DEFAULTS), a saved plan through App's `setLayers` (merged
     over the same), and — the one nobody defends against — a reducer state
     that was BUILT BEFORE a key existed and is still in memory. That last one
     is not hypothetical: adding a layer and reloading the module leaves an open
     session holding the old shape, and any plan written between the two is
     saved without the key too.
     THE FAILURE IS SILENT AND IT IS THE WORST KIND. `undefined && …` is falsy,
     so a canvas that gates a mark on a key it has not got draws nothing, and
     the switch that is supposed to explain why shows unticked next to a drawing
     nobody turned off. That is exactly what happened to `autoLights`: a whole
     lighting layout invisible, with the ambient grid gone and the accents left
     behind, because one key was absent from an object that had every other one.
     SO IT IS MERGED ON THE WAY OUT OF THE DOCUMENT rather than on the way in.
     Merging on the way in fixes the two restore paths and cannot fix the third,
     because there is no write to hang it on. Here, every reader — the View
     menu's ticks, `canvasLayers`, the exports — gets the same complete object,
     and a layer added tomorrow is on at its default the moment it is added.
     THE DOCUMENT IS UNTOUCHED, which is what keeps this a defaulting rule and
     not a migration: `toggleLayer` still patches the stored object, and what
     gets saved is still the answers somebody actually gave. */
  const layers = useMemo(
    () => ({ ...LAYER_DEFAULTS, ...(doc.layers || {}) }), [doc.layers]);
  const [over, setOver] = useState(false);
  // null = not editing. An empty string is a legitimate draft mid-edit, so the
  // two cannot share a value.
  const [nameDraft, setNameDraft] = useState(null);
  // THE AUDIT OVERLAY — the task-surface highlights, the beds the detector
  // found, the render pass's wall cells. Invisible to everyone but an owner
  // either way: every use of it downstream is gated `isAdmin && audit`.
  //
  // OFF BY DEFAULT, and back to off after a spell on. The argument for on was
  // that an owner opens a plan in order to look at the readings, so a default
  // of off cost two clicks before the drawing showed the thing being debugged.
  // Two clicks is the cheaper mistake.
  //
  // BECAUSE THE COST OF ON IS THE EXPORTS, and nothing filters this overlay out
  // of them — the PNG and the SVG serialise the live canvas. On by default meant
  // every owner who exported a sheet without first remembering a switch they
  // never touched put lit, captioned boxes on a client's drawing. A default is
  // exactly the setting nobody remembers, which is the wrong place to put a
  // thing that has to be turned off before the work leaves the building.
  const [audit, setAudit] = useState(false);
  /* THE PLANNER'S GRID, ON THE DRAWING, ON REQUEST — the chunk boxes and the
     cell lines the downlights were laid on. Separate state from `audit` and not
     a layer, on purpose: `audit` is what the MODELS read off the plan, and this
     is what OUR OWN code did with it afterwards. They are debugged at different
     moments and by different people, and folding the grid into `audit` would
     mean nobody can look at a chunk split without also lighting up every task
     surface on the sheet. Admin-only, and it carries the same export caveat the
     audit overlay does. */
  const [showGrid, setShowGrid] = useState(false);
  // A SWITCH OF ITS OWN, not a row under `audit`. The bed and surface overlays
  // are looked at while asking why a layout came out the way it did; the doors
  // are looked at while asking whether the SCALE is right, which happens on
  // arrival and usually with nothing else on screen. One checkbox for both
  // would mean turning on four overlays to check one number.
  const [auditDoors, setAuditDoors] = useState(false);
  /* THE BEDS, ON A THIRD SWITCH, for the reason the doors have a second one.
     They were dropped from `audit` when that overlay began opening by default —
     see the note in PlanCanvas's bed group — and what was lost with them is the
     only view of a fact the layout obeys but never draws: a bed moves every
     downlight around it and appears nowhere on the sheet. Asked on its own,
     because "is that bed right" is a question about one room at one moment, not
     a thing to have standing on. */
  const [auditBeds, setAuditBeds] = useState(false);

  /** The zoom at which the whole plan fits the stage, with a little air. */
  const fitZoom = useCallback(() => {
    const el = stageRef.current;
    if (!el || !source?.w || !source?.h) return 1;
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) + 34;
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) + 34;
    return clampZoom(Math.min((el.clientWidth - padX) / source.w,
                              (el.clientHeight - padY) / source.h));
    // `stageRef` is a stable ref owned by App; preserve the original dependency
    // array, whose only render-varying input is `source`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  return {
    layers, zoom, view,
    over, setOver,
    nameDraft, setNameDraft,
    audit, setAudit,
    showGrid, setShowGrid,
    auditDoors, setAuditDoors,
    auditBeds, setAuditBeds,
    fitZoom,
  };
}
