import { useCallback, useEffect, useMemo, useState } from 'react';
import { materialsOf } from '../../lib/materials.js';

/**
 * WALL MATERIALS, AND THE STEP THAT ASKS FOR THEM.
 *
 * WHAT IT PRODUCES IS SAVED AND NONE OF IT IS HERE. The tones themselves live
 * in the document's `materials`, written through `docActions` — see the note on
 * the two setters below for why nothing here resolves a room's current tones.
 * What this owns is the screen: which space is being answered for, which edge
 * was clicked, and where on the display the card should stand.
 */
export default function useWallMaterials({ rooms, materials, docActions }) {
  /* `wallEdit` IS A SCREEN AND IS NOT SAVED, exactly as `zoneEdit` and
     `doorEdit` are not: it holds the id of the space whose walls are being
     answered for, and it means "the panel is a step and the sheet is inert".
     What it PRODUCES — the tones — is in `materials` above, which is saved.
     `wallPick` is the popup: which edge was clicked and where on the screen, so
     the card can stand on its own answer. Null the rest of the time. */
  const [wallEdit, setWallEdit] = useState(null);
  const [wallPick, setWallPick] = useState(null);

  /* --- `materialsEdit` WAS HERE, AND THE FOLD IT GATED IS GONE ------------
     IT HELD THE ID OF THE SPACE WHOSE FINISHES WERE OPEN, because the finishes
     used to be a one-line summary you pressed to expand, and expanding them
     REPLACED the analysis in the space panel. The floating window shows the
     ceiling height, the three tone rows and the readout at once — every one of
     those rows moves the figure under it, which is the argument for having them
     on one screen — so there is nothing to be open or closed.
     IT LIVED OUT HERE RATHER THAN IN SpaceDetail for a reason worth keeping in
     mind if a fold ever comes back: "Configure walls" is reached FROM the
     finishes and unmounts the whole panel while the wall step runs, so local
     state would put somebody back on the analysis when they pressed Done, one
     step further out than they left. */

  /* THESE DO NOT RESOLVE THE ROOM'S CURRENT TONES AND MUST NOT. The reducer
     reads them off its own state, which is what the `setMaterials` updater these
     replace did — see the note there. Resolving here would read the materials of
     the render that queued the action, and the second of two tone changes in one
     batch would quietly undo the first. */
  const setSurfaceTone = useCallback(
    (id, surface, tone) => docActions.setSurfaceTone(id, surface, tone),
    [docActions]);

  const setWallTone = useCallback(
    (id, edge, tone) => docActions.setWallTone(id, edge, tone),
    [docActions]);

  /* WHAT THE CANVAS IS HANDED WHILE THE WALL STEP IS OPEN: one polygon and one
     tone per edge, in plan pixels. Null the rest of the time, which is what
     turns the step off in PlanCanvas — there is no second flag. */
  const wallEditRoom = useMemo(
    () => (wallEdit ? rooms.find((q) => q.id === wallEdit) ?? null : null),
    [wallEdit, rooms]);

  const wallEditGeo = useMemo(() => {
    const r = wallEditRoom;
    if (!r) return null;
    return {
      roomId: r.id,
      polygonPx: r.geo.polygonPx,
      tones: materialsOf(materials, r.id).walls,
      selected: wallPick?.edge ?? null,
    };
  }, [wallEditRoom, materials, wallPick]);

  /* THE POPUP GOES WHERE THE POINTER IS, IN VIEWPORT COORDINATES — the stage
     scrolls and zooms under it, and a card anchored to the drawing would have to
     be chased. See WallTonePopup. */
  const pickWallSegment = useCallback((edge, e) => {
    setWallPick({ edge, x: e.clientX, y: e.clientY });
  }, []);

  /* --- SAYING WHAT EACH WALL IS FINISHED IN ---------------------------------
     THE FOURTH STEP ON THIS SCREEN, AND THE SAME SHAPE AS THE OTHER THREE. Like
     the door, zone and switchboard editors it empties the panel, owns the
     pointer and stays open until it is closed — because what is being asked for
     is a gesture on the DRAWING, and a room's walls cannot be named in a panel:
     "wall 3" means nothing, and the wall you can see does.
     IT PUTS EVERY OTHER GESTURE AWAY on the way in, and that half of it is
     App's: putting the door step, the zone step, the switchboard step, the pens
     and whatever is armed away is arbitration between features, and App is the
     only place that knows all of them. So `openWallEdit` in App calls this and
     then stands the rest down, in the order it always did. */
  const openWallEdit = useCallback((roomId) => {
    setWallEdit(roomId); setWallPick(null);
  }, []);

  const closeWallEdit = useCallback(() => {
    setWallEdit(null); setWallPick(null);
  }, []);

  /* A STEP CANNOT OUTLIVE ITS SUBJECT. Deleting the space, re-tracing it or
     clearing the plan all take the room out from under this, and a panel asking
     about the walls of a room that is not there has no way out that makes
     sense. */
  useEffect(() => {
    if (wallEdit && !rooms.some((r) => r.id === wallEdit)) closeWallEdit();
  }, [wallEdit, rooms, closeWallEdit]);

  return {
    wallEdit, wallPick, setWallPick, wallEditRoom, wallEditGeo,
    setSurfaceTone, setWallTone, pickWallSegment,
    openWallEdit, closeWallEdit,
  };
}
