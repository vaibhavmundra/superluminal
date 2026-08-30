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
 * The editor, as a plain object. `s` is one flat bag of App's current values —
 * the call site names each one, so a rename in App.jsx fails loudly here rather
 * than writing `undefined` into the column.
 */
export function serialiseEditor(s) {
  return {
    v: STATE_VERSION,
    savedAt: new Date().toISOString(),

    // --- the drawing's interpretation, not the drawing itself
    unitId: s.unitId ?? null,

    // --- scale. Everything the app needs to arrive at the same px/ft again.
    // pxPerFt itself rides along as a CHECK, not as an input: the restored
    // state recomputes it from these, and a mismatch means the scale rules
    // changed under a saved plan, which is worth knowing.
    scale: {
      mode: s.scaleMode, refId: s.refId, customFt: s.customFt,
      measure: s.measure, doorPick: s.doorPick, pxPerFtAtSave: s.pxPerFt ?? null,
    },
    ceilingFt: s.ceilingFt,

    // --- SEGMENTATION: the model's answer and the user's corrections, in one
    // list, which is how the app itself holds them. An outline carries
    // `detected` (it came from the room detector), `reviewed` (a person looked
    // at it) and its points in drawing units — so a diff against the raw
    // detector payload below is what shows the tweak.
    outlines: s.outlines,
    litIds: s.litIds,
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

    // --- the ceiling as edited
    ceilingObjs: s.ceilingObjs,
    chunkPicks: s.chunkPicks,
    // WHAT KIND OF CEILING EACH SPACE HAS, and which of the rectangles that fit
    // in it the cove is set out in. Two small maps keyed by outline id, and they must be kept: the
    // layout is a memo over them, so a plan reopened without these comes back
    // as flat ceilings everywhere and silently loses every cove in the job.
    ceilingKinds: s.ceilingKinds,
    covePicks: s.covePicks,

    // --- the two model-proposed layers, and the fittings added by hand
    accentResults: s.accentResults,
    accentDismissed: s.accentDismissed,
    manualAccents: s.manualAccents,
    surfaceResults: s.surfaceResults,
    surfaceDismissed: s.surfaceDismissed,
    manualSurfaces: s.manualSurfaces,

    // --- view preferences. Cheap, and jarring to lose.
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
  set.setDoorState((p.doors?.length ?? 0)
    ? { status: 'done', restored: true, count: p.doors.length, rejected: [] }
    : { status: 'idle' });
  set.setDetectState((p.detections?.length ?? 0)
    ? { status: 'done', restored: true, count: p.detections.length, rejected: [] }
    : { status: 'idle' });

  set.setCeilingObjs(p.ceilingObjs ?? []);
  set.setChunkPicks(p.chunkPicks ?? {});
  set.setCeilingKinds(p.ceilingKinds ?? {});
  set.setCovePicks(p.covePicks ?? {});

  set.setAccentResults(p.accentResults ?? {});
  set.setAccentDismissed(p.accentDismissed ?? []);
  set.setManualAccents(p.manualAccents ?? []);
  set.setSurfaceResults(p.surfaceResults ?? {});
  set.setSurfaceDismissed(p.surfaceDismissed ?? []);
  set.setManualSurfaces(p.manualSurfaces ?? []);

  if (p.ui?.layers) set.setLayers(p.ui.layers);
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
