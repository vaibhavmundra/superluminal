import { useEffect, useMemo, useState } from 'react';
import { projectOutlinesPx } from '../../lib/planProjection.js';
import { readScale, statedRecord } from './index.js';

// ---------------------------------------------------------------------------
// useDimensionIntelligence — the read boundary for a scale the drawing states.
//
// Everything it decides is computed by the pure module beside it. What this
// hook owns is WHEN the question is asked, and the one write that follows.
//
// THE ANSWER IS LATCHED INTO THE DOCUMENT, AND THAT IS THE WHOLE DESIGN.
//
// A room outline is evidence here — a stated `18'-0" X 12'-0"` is only a ruler
// because there is a polygon to compare it against — and outlines are EDITABLE.
// Recomputing on every change would mean dragging a room corner silently
// re-scaled the entire building: every other room would resize under the
// pointer, the fitting count would move, and the schedule would follow. So the
// scale is read ONCE, written to `stated`, and never read again from the text.
//
// IN THE DOCUMENT AND NOT IN A REF for the same reason every other decision is:
// it has to survive a reload. Nothing saves the text layer, so a plan reopened
// tomorrow has no strings to re-read — the number it was scaled by has to be
// the plan's own, exactly as a door pick is.
//
// AND IT DOES NOT BIND ANYTHING. Writing `stated` sets `scaleMode` to 'stated',
// which is a mode like any other: somebody who disagrees with the reading picks
// a door or drags a reference line, the mode changes, and this never overrules
// them. See useScale, where the branches sit in that order.
// ---------------------------------------------------------------------------
/**
 * HOW LONG TO WAIT FOR THE SPACES BEFORE READING WITHOUT THEM.
 *
 * The detector is a model call over a network. It normally answers in two to
 * five seconds and it can also stall, be aborted, or — on a plan that never had
 * a segmentation saved — never start at all. None of those may leave somebody
 * staring at a modal for ever, which is the worst outcome this feature can
 * produce: the drawing is right there and the app has simply stopped.
 *
 * GENEROUS, BECAUSE GIVING UP EARLY IS ALSO WRONG. Cutting a slow-but-working
 * detector off throws away the room sizes and sends a dimensioned plan to the
 * door step. Fifteen seconds is far past any normal answer and far short of the
 * point where a person concludes the app is broken.
 *
 * AND IT IS NOT FINAL. If the outlines arrive after this fires, the reading
 * re-runs and the write effect still latches a scale it can now see — so a slow
 * detector costs a detour through the door step, not the feature.
 */
const WAIT_FOR_SPACES_MS = 15000;

export default function useDimensionIntelligence({
  doc, docActions, source, planText, textKind = null, isVector,
  /* A REOPENED PLAN NEVER RE-RUNS ITS DETECTORS — `restoring` in
     usePlanRecognition is set once from this and never cleared. See the note at
     `roomsSettled`, where it is the difference between "not started yet" and
     "not going to start". */
  restoredPlan = false }) {
  const { outlines, roomState, stated, scaleMode } = doc;

  /* THE OUTLINES IN PIXELS, PROJECTED HERE RATHER THAN BORROWED.
     App builds `outlinesPx` too, a hundred lines further down — after `useScale`,
     because almost everything downstream of a scale needs the scale. This one
     cannot wait for that: it is an INPUT to the scale. The projection is free of
     px/ft by construction (`fromDu` is the identity on a raster — see
     planProjection.js), so asking for it early is not a shortcut around an
     ordering problem, it is the reason there is no ordering problem. */
  const outlinesPx = useMemo(
    () => (source && !isVector ? projectOutlinesPx(source, outlines || []) : []),
    [source, outlines, isVector]);

  const verdict = useMemo(() => {
    // A DXF states its scale outright and an image has no text layer; in both
    // cases there is nothing to read and the door route is untouched.
    if (isVector || !planText?.length) return null;
    return readScale({
      textItems: planText,
      outlines: outlinesPx.map((o) => ({ id: o.id, name: o.name, pts: o.pointsPx })),
    });
  }, [isVector, planText, outlinesPx]);

  /* --- OUTLINES FIRST, THEN DIMENSIONS ------------------------------------
     THE SEQUENCE IS FIXED AND THIS IS THE GATE THAT FIXES IT. The room detector
     runs on upload for its own reasons and answers in a couple of seconds; the
     scale is read only once it has, so BOTH routes are on the table at the same
     moment — a chain resolves from the text alone, and a room that states its
     own size can only be scored against a polygon. Reading earlier would settle
     on whichever evidence happened to be ready first, which on a plan like
     `resort_plan.pdf` — twenty-nine room sizes, not one chain — is no evidence
     at all, and the answer would be "no dimensions" on a fully dimensioned
     sheet.

     IT COSTS NOTHING. The detector was already running during this window; the
     wait is its wait, not a new one. */
  /* --- WAITING FOR THE SPACES, BUT NOT FOR EVER ---------------------------
     Armed per plan and cleared with it. See WAIT_FOR_SPACES_MS. */
  const [waitedLongEnough, setWaitedLongEnough] = useState(false);
  useEffect(() => {
    setWaitedLongEnough(false);
    if (!source || isVector || !planText?.length) return undefined;
    const t = setTimeout(() => setWaitedLongEnough(true), WAIT_FOR_SPACES_MS);
    return () => clearTimeout(t);
  }, [source, isVector, planText]);

  /* WHEN NO MORE OUTLINES ARE COMING. Three ways, and the second one is a bug
     this feature walked straight into.

     'done' / 'error'  the detector answered. An error is an answer.

     'idle' ON A REOPENED PLAN IS TERMINAL, not early. `restoring` is set once
     from `restoredPlan` and NEVER cleared, so a reopened plan's detectors never
     run — and `applyEditor` restores `roomState` as 'idle' when the saved row
     carries no segmentation. Treating that as "still coming" left the busy modal
     up for ever on a plan whose spaces were never going to arrive. On a FRESH
     upload 'idle' means the opposite — the effect has not fired yet, one render —
     so the two cannot be merged.

     ...AND THE TIMEOUT CATCHES EVERYTHING ELSE, including a detector that hangs
     in 'running'. */
  const roomsSettled = roomState?.status === 'done' || roomState?.status === 'error'
    || (restoredPlan && roomState?.status === 'idle')
    || waitedLongEnough;

  /* THE ONE WRITE. Guarded on `stated` being empty, so it happens once per plan
     and a reopened plan is never re-read. */
  useEffect(() => {
    if (stated || !roomsSettled || !verdict?.ok) return;
    const rec = statedRecord(verdict);
    if (!rec) return;
    docActions.setStated(rec);
  }, [verdict, stated, roomsSettled, docActions]);

  /* WHAT HAPPENED, EVERY TIME — not only when it worked.
     A reading that silently fails is indistinguishable on screen from one that
     was never attempted, and the difference is the whole of the diagnosis: no
     text layer at all is a scan, text with no figures is an undimensioned sheet,
     and figures that disagree is a bug in here. The panel gets one sentence; the
     console gets the counts behind it. */
  useEffect(() => {
    if (isVector) return;
    if (!planText?.length) { console.log('[dimensions] no text layer on this plan'); return; }
    if (!verdict) return;
    console.log(verdict.ok
      ? `[dimensions] READ ${verdict.pxPerFt.toFixed(2)} px/ft`
        + ` (${verdict.confidence}, ${verdict.used.length}/${verdict.candidates.length} agreeing)`
      : `[dimensions] NOT READ — ${verdict.reason}`,
      { runs: planText.length, lines: verdict.lines.length,
        candidates: verdict.candidates.length, pairsFound: verdict.pairsFound,
        outlines: outlinesPx.length, used: verdict.used });
  }, [verdict, planText, isVector, outlinesPx.length]);

  /* --- WHERE THE USER LANDS, AND WHEN ------------------------------------
     'reading'  the busy modal is up: the spaces are being found, and the scale
                cannot be decided until they are.
     'read'     a scale came off the drawing. Straight to the outlines, no door
                step at all.
     'none'     nothing usable. The door detector runs (see `deferDoors`) and
                the door step is where they land — with the outlines already
                found and waiting, so the plan fills in the moment a door width
                is named.

     A DRAWING WITH NO TEXT AT ALL SKIPS THE WAIT. A photograph or a scan has
     nothing to read whatever the detector finds, so it settles now and the
     doors start immediately rather than a couple of seconds later. */
  const status = (stated && scaleMode === 'stated') ? 'read'
    : (isVector || !planText?.length) ? 'none'
    : !roomsSettled ? 'reading'
    : verdict?.ok ? 'read'
    : 'none';

  /* WHAT TO SAY ON THE PANEL. The reading is invisible otherwise: a plan that
     was scaled off its own figures and one that fell through to the door step
     look identical until somebody is already answering a question they did not
     need to be asked. One sentence, and the verdict's own reason when there is
     one to give — `consensus` writes those to be read by a person. */
  const note = status === 'read'
    ? (verdict?.ok
        ? `Scale read off the drawing — ${verdict.pxPerFt.toFixed(2)} px/ft from `
          + `${verdict.used.length} agreeing measurement${verdict.used.length === 1 ? '' : 's'}.`
        : stated
          ? `Scale read off the drawing — ${stated.pxPerFt.toFixed(2)} px/ft.`
          : null)
    : status === 'reading' ? 'Reading the dimensions on the drawing…'
    // A DXF states its scale outright. There was never a question to report on.
    : isVector ? null
    /* NOTHING TO READ IS NOT THE SAME AS NOTHING FOUND, and this used to say
       neither — it returned null, which put somebody on the door step with no
       account of why the drawing had not answered for itself. Which of the two
       it is depends on the FILE and not on the drawing, so `textKind` is what
       decides: a photograph never had text in it, and a PDF that came back
       empty was exported without a text layer. */
    : !planText?.length
      ? (textKind === 'image'
          ? 'An image carries no text to read, so the scale has to come off a door.'
          : textKind === 'pdf'
            ? 'This PDF has no text layer to read a dimension from, so the scale has to come off a door.'
            : null)
    : verdict?.reason ? `No usable dimensions on this drawing — ${verdict.reason}.`
    : null;

  return {
    status,
    note,
    /** The reading itself, for anything that wants more than the sentence. */
    pxPerFt: status === 'read' ? (verdict?.pxPerFt ?? stated?.pxPerFt ?? null) : null,
    /** True while the answer may still arrive — the door step waits on this. */
    pending: status === 'reading',
    /** The saved record, once there is one. */
    stated: scaleMode === 'stated' ? stated : null,
    /** The full reading, for the panel and for the console. Not saved. */
    verdict,
  };
}
