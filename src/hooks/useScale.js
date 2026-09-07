import { useMemo } from 'react';
import { REFERENCES, scaleFromReference } from '../lib/scale.js';
import { scaleFromDoor } from '../lib/doors.js';

// ---------------------------------------------------------------------------
// useScale — the saved scale choices and the scale they resolve to.
//
// The five saved fields stay in the document reducer, just as the saved view
// fields do in useViewPrefs. This hook owns their read boundary and the one
// derived value; usePlanDoc remains the persistence store and composition stays
// a one-way graph.
// ---------------------------------------------------------------------------
export default function useScale({ doc, isVector, source, doors, doorPick }) {
  const { ceilingFt, scaleMode, refId, customFt, measure } = doc;

  const pxPerFt = useMemo(() => {
    // A DXF states its own scale. There is nothing to measure and nothing to
    // guess, so the scale controls are not offered at all.
    if (isVector) return source.pxPerFt;
    if (scaleMode === 'ref') {
      if (!measure.a || !measure.b) return null;
      const len = Math.hypot(measure.b.x - measure.a.x, measure.b.y - measure.a.y);
      const ref = REFERENCES.find((r) => r.id === refId);
      return scaleFromReference(len, ref?.ft ?? customFt);
    }
    // A door picked and named. Until BOTH have happened there is no scale —
    // a clicked door with no width yet is a question, not an answer.
    if (!doorPick?.id || !doorPick.mm) return null;
    // THE PICK CARRIES ITS OWN RECT, AND THAT IS WHAT MAKES THE DOOR EDITOR
    // SAFE. This used to read the rect out of `doors` and nothing else — which
    // was fine while that list was written once by the detector and never
    // touched. The confirm-the-doors step can now move a box or throw one away,
    // and if that box happened to be the ruler the scale of the entire drawing
    // changed underneath a finished layout: every fitting, every metre of strip
    // and the whole schedule, silently, from a gesture about switchboards.
    //
    // The snapshot is taken when the door is CLICKED as the ruler — see
    // `onPickDoor` on the tracer screen — so the scale is anchored to the box
    // that was measured rather than to whatever is in the list now. The lookup
    // stays first, and is what keeps a plan saved before this existed working:
    // its `doorPick` has no rect, and its doors have never been editable.
    const d = doors.find((q) => q.id === doorPick.id);
    const rect = d?.rect ?? doorPick.rect ?? null;
    return rect ? scaleFromDoor(rect, doorPick.mm) : null;
  }, [isVector, source, scaleMode, measure, refId, customFt, doors, doorPick]);

  return { ceilingFt, scaleMode, refId, customFt, measure, pxPerFt };
}
