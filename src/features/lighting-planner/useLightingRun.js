import { useCallback, useRef, useState } from 'react';

/**
 * THE RUN'S OWN SCREEN, AND THE FLAG THAT STOPS IT — the feature's FIRST call
 * site, and it is here because `stepTool` is.
 *
 * Two values, and both are transient by construction: `prep` is the loading
 * screen's whole state while the pipeline runs and null the rest of the time,
 * and `cancelPrep` is the "somebody pressed Stop" flag every step of the
 * pipeline checks. Neither is saved and neither belongs in `usePlanDoc`: what
 * comes back next time is the DESIGN, and a progress dialog restored from a
 * database would be a screen for work that is not happening.
 *
 * IT IS ASKED FOR ON ITS OWN, EARLY, FOR THE REASON `useFixtureState`,
 * `useGeometryState` AND `useBoardStep` ARE. Half the controls on the editor
 * carry `!prep` — while the pipeline runs the layout is being replaced
 * underneath — and the first of those readers, `stepTool`, stands a thousand
 * lines above the point where the pipeline can be composed. A hook's arguments
 * are evaluated DURING RENDER, so the controller cannot be moved up to meet it;
 * the state can be, and is.
 *
 * `reset` IS MEMOISED AND IS CALLED BY `resetForNewPlan`. It is the two
 * statements that stood there, in the same order, so the same thing happens on
 * a fresh sheet: the screen comes down and the stop flag is cleared, because a
 * stale `true` left by an abandoned run would make the next run's first step
 * bail on a cancellation that never happened.
 */
export default function useLightingRun() {
  // The pipeline's own state while it runs. Null when it is not running, which
  // is also what the loader keys off.
  const [prep, setPrep] = useState(null);
  const cancelPrep = useRef(false);

  const reset = useCallback(() => {
    setPrep(null); cancelPrep.current = false;
  }, []);

  return { prep, setPrep, cancelPrep, reset };
}
