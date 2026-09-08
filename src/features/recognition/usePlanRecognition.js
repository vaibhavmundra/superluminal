import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import useRoomRecognition from './useRoomRecognition.js';
import useDoorRecognition from './useDoorRecognition.js';
import useFurnitureRecognition from './useFurnitureRecognition.js';
import useRoomBeds from './useRoomBeds.js';

const LS = 'lightPlanner.v1';

// The source, scale and outline controllers remain composed by App. This hook
// owns recognition sessions, and writes saved answers only through docActions.
export default function usePlanRecognition({
  doc, docActions, source, img, isVector, pxPerFt, wallLayerSet, restoredPlan, readOnly, useBoundingRect,
}) {
  // TRUE FOR THE WHOLE LIFE OF A RESTORED PLAN, not just until the restore
  // lands. It is what stops the four detectors below from firing on a drawing
  // whose answers are already saved — four model calls, real money, and the
  // results would overwrite the corrections the user made last time. Their
  // explicit re-run buttons bump a nonce, and a non-zero nonce means the user
  // asked, so it goes through.
  const restoring = useRef(restoredPlan);

  const { provider, projectType: projectId, roomState, roomTypes, detections } = doc;
  // The no-light rectangles are in the document reducer — see `zones` in
  // hooks/usePlanDoc.js for why they are not the same thing as a detection.
  // Furniture found on the plan. Deliberately NOT the same thing as a zone:
  // a detection is a property of the IMAGE and is found once, whereas whether
  // it is a no-light zone depends on which room is being lit. Keeping them
  // apart is what lets the detection run before a boundary exists.
  const [detectState, setDetectState] = useState({ status: 'idle' });
  // THE TWO ANSWERS, KEPT APART. The ordinary path walks the whole `both`
  // response at once so that dedupe() collapses two boxes over one bed into one
  // zone; the judge needs the opposite — the two claims side by side, because
  // they are what is being compared. Empty on any single-provider run.
  const [bedSets, setBedSets] = useState(null);   // {roboflow:[...], openai:[...]}
  // What the judge decided, per room, so the panel can say why a bed is where
  // it is. Keyed by outline id.
  const [detectNonce, setDetectNonce] = useState(0);         // bumping this re-runs detection
  // The room detector. Runs on upload, like the bed one, and for the same
  // reason: by the time there is anything to light the answer is already in.
  const [roomNonce, setRoomNonce] = useState(0);

  // The doors found on upload are in the document reducer — see usePlanDoc.js —
  // and the one the user picked as the ruler is `doorPick` below.
  const [doorState, setDoorState] = useState({ status: 'idle' });
  const [doorNonce, setDoorNonce] = useState(0);    // bumping this looks again

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(LS) || '{}');
      if (saved.provider) docActions.setProvider(saved.provider);
    } catch { /* first run */ }
  }, [docActions]);
  useEffect(() => {
    try { localStorage.setItem(LS, JSON.stringify({ provider })); } catch { /* private mode */ }
  }, [provider]);

  useRoomRecognition({ source, img, isVector, restoring, readOnly,
    roomNonce, wallLayerSet, docActions });
  useDoorRecognition({ source, img, isVector, projectId, restoring, readOnly,
    doorNonce, docActions, setDoorState });
  useFurnitureRecognition({ source, img, restoring, readOnly, detectNonce,
    provider, pxPerFt, wallLayerSet, docActions, setDetectState, setBedSets });
  const { refindBeds, absorbBedRows, lookAgainAtBeds, bedLook, computeBedFit } = useRoomBeds({
    source, img, wallLayerSet, pxPerFt, docActions, projectId, roomTypes, detections, useBoundingRect,
  });

  const rerunRooms = useCallback(() => setRoomNonce((n) => n + 1), []);
  const rerunDoors = useCallback(() => setDoorNonce((n) => n + 1), []);
  const rerunFurniture = useCallback(() => setDetectNonce((n) => n + 1), []);
  // Keep the original reset scope: nonces, bedSets and the admin result line
  // are not reset by loading a new file. Restored statuses also serve undo/redo.
  const reset = useMemo(() => ({
    furniture() { docActions.clearDetections(); setDetectState({ status: 'idle' }); },
    rooms() { docActions.setRoomState({ status: 'idle' }); },
    doors() {
      docActions.clearDoors(); docActions.setDoorPick(null);
      setDoorState({ status: 'idle' });
    },
    restoreDoorStatus: setDoorState,
    restoreFurnitureStatus: setDetectState,
  }), [docActions]);

  return {
    rooms: { state: roomState },
    doors: { state: doorState },
    furniture: { state: detectState, provider, bedSets, bedLook },
    status: { running: [roomState, doorState, detectState].some((s) => s.status === 'running') },
    commands: { rerunRooms, rerunDoors, rerunFurniture, setProvider: docActions.setProvider,
      refindBeds, absorbBedRows, lookAgainAtBeds, computeBedFit },
    reset,
  };
}
