import { useCallback, useMemo } from 'react';
import { useSceneTrackProjections,
         useSceneArrayProjections } from '../scene/useSceneFixtureProjections.js';
import { lumensPerWattFor } from '../../lib/lumens.js';
import { DEFAULT_DROP_FT } from '../../lib/cob.js';
import { arrayBarFor, arrayDraftBar, chunkSpecInForce } from './fixtureRules.js';

/**
 * WHAT IS ON THE CEILING, PROJECTED — the feature's SECOND call site, and the
 * one every other domain reads through.
 *
 * IT STANDS WHERE THE BLOCK IT REPLACES STOOD, above the lighting analysis, and
 * the position is load-bearing for the reason the geometry feature's second
 * call site is where it is: the BOQ, the lumen counting and the analysis
 * highlight all name `tracks.modulesPx` and `arrays.lampsPx`, and a `useMemo`
 * evaluates its dependency array on every render — so a reader above its own
 * `const` is a temporal dead zone and a blank screen.
 *
 * IT TAKES THE CEILING GEOMETRY THROUGH ITS PUBLIC INTERFACE AND NOTHING ELSE.
 * `arrayOutline` is `useCeilingGeometry`'s documented entry — one geometry id
 * (a shape's, or `room:<outlineId>`) in, one path out — and it is the only thing
 * this feature knows about how a cove, a guide or a track run is drawn. See that
 * feature's README.
 *
 * NOTHING HERE HOLDS DOCUMENT STATE. `cobArrays`, `trackFixtures` and
 * `manualCobs` are read out of the stores App hands in; nothing is copied and
 * nothing is written from here.
 */
export default function useFixtures({
  state, rooms, pxPerFt, country,
  ceilingShapes, trackFixtures, cobArrays, manualCobs,
  arrayOutline, ceilingMmFor, selShapeId,
}) {
  const { selArrayId, cobDraftArray } = state;

  const { projections: { magTracksPx, magTrackById, trackModulesPx } } = useSceneTrackProjections({
    ceilingShapes, rooms, pxPerFt, trackFixtures
  });

  /**
   * THE RUN THAT IS SELECTED, if the selected shape is one.
   *
   * A TRACK IS A CEILING SHAPE, so being selected is `selShapeId` naming it —
   * there is no second selection to keep in step. What this adds is the TEST:
   * `selShapeId` is just as likely to be a cove or a guide, and the module
   * drawer must not appear for either. See the ToolRail call site.
   */
  const selTrackId = useMemo(
    () => (selShapeId && magTrackById[selShapeId] ? selShapeId : null),
    [selShapeId, magTrackById]);

  const { projections: { arrayCobsPx, draftArrayPx, selArrayPathPx } } = useSceneArrayProjections({
    cobArrays, arrayOutline, pxPerFt, ceilingMmFor, cobDraftArray, selArrayId
  });

  /** WHAT THE BAR ASKS ABOUT THE ARRAY THAT IS OPEN — see `arrayBarFor`, which
   *  carries the whole argument for why the controls come off the GEOMETRY and
   *  not off what was stored on the array. */
  const selArrayBar = useMemo(() => {
    const a = cobArrays.find((q) => q.id === selArrayId);
    if (!a) return null;
    return arrayBarFor({ array: a, geo: arrayOutline(a.geomId), pxPerFt });
  }, [cobArrays, selArrayId, arrayOutline, pxPerFt]);

  /** WHAT THE BAR ASKS ABOUT THE ARRAY BEING SET OUT — see `arrayDraftBar`.
   *  IT IS A MEMO WHERE IT WAS AN INLINE IIFE AT THE `CobSpec` CALL SITE, which
   *  changes when it runs and not what it answers: it is a pure function of the
   *  draft, the outline and the scale. */
  const draftArrayBar = useMemo(() => {
    const d = cobDraftArray;
    const geo = d?.geomId ? arrayOutline(d.geomId) : null;
    return arrayDraftBar({ draft: d, geo, pxPerFt });
  }, [cobDraftArray, arrayOutline, pxPerFt]);

  /** WHAT A CHUNK HAS ALREADY BEEN DECIDED AT — see `chunkSpecInForce`. */
  const cobChunkSpec = useCallback((room) => chunkSpecInForce({
    cobs: manualCobs, room, pxPerFt }), [manualCobs, pxPerFt]);

  /* WHERE THE BUILDING IS AND HOW HIGH THE CEILING IS — the two facts outside
     the cell that the rule needs. Both callers share this so the bar and the
     toggle cannot come to disagree.
     A CALLBACK AND NOT A MEMO OVER THE HOVERED ROOM, because THREE callers need
     it and they are asking about different rooms. The bar asks about whichever
     space the pointer is over; the press asks about the space it actually landed
     in, resolved afresh at that moment; and autoplace asks about whichever
     space's toggle was switched. One function, so the three can never come to
     disagree — which matters more here than anywhere, because a recommendation
     that differed from what the toggle beside it places would be this app
     holding two opinions about one hole in one ceiling. */
  const cobBasisFor = useCallback((room) => ({
    lumensPerWatt: lumensPerWattFor(country),
    dropFt: (room ? ceilingMmFor(room.id) / 304.8 : 0) || DEFAULT_DROP_FT,
    inForce: cobChunkSpec(room),
  }), [country, ceilingMmFor, cobChunkSpec]);

  return {
    tracks: { runsPx: magTracksPx, byId: magTrackById,
              modulesPx: trackModulesPx, selId: selTrackId },
    arrays: { lampsPx: arrayCobsPx, draftPx: draftArrayPx,
              selPathPx: selArrayPathPx, bar: selArrayBar,
              draftBar: draftArrayBar },
    cob: { basisFor: cobBasisFor, specInForce: cobChunkSpec },
  };
}
