import { useCallback, useState } from 'react';
import { roomSnapshot, requestAccents } from '../../lib/accentMask.js';
import { surfaceResultFrom } from './passResults.js';

/**
 * THE TASK-SURFACE PASS.
 *
 * Same shape as the accent pass and the same split: the surfaces the model
 * found are the document's (`surfaceResults`), the ones struck out are the
 * document's (`surfaceDismissed`), the ones drawn by hand are the document's
 * (`manualSurfaces`), and what is here is the sitting.
 */
export default function useSurfacePass({ source, img, wallLayerSet, pxPerFt, docActions }) {
  // --- task surfaces --------------------------------------------------------
  // The third layer. Ambient covers the ceiling, accent picks out a surface for
  // the look of it, and a TASK surface is a plane somebody works at. This pass
  // only FINDS them — same order the accent pass was built in, and the order
  // that made its one real failure obvious instead of mysterious.
  const [surfaceRoomId, setSurfaceRoomId] = useState(null);
  const [surfaceState, setSurfaceState] = useState({ status: 'idle', roomId: null });

  /** Task surfaces for one room, likewise. */
  const computeSurfaces = useCallback(async (r, { reuseShot = null } = {}) => {
    const shot = reuseShot ?? await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx,
      lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet,
    });
    const payload = await requestAccents({
      plan: shot, task: 'surfaces',
      room: {
        name: r.outline.name || null,
        widthFt: r.stats.widthFt, heightFt: r.stats.heightFt, areaSqft: r.stats.areaSqft,
      },
    });
    return {
      shot,
      meta: payload.meta,
      result: surfaceResultFrom({ res: payload.result, room: r, shot, pxPerFt }),
    };
  }, [source, img, wallLayerSet, pxPerFt]);

  /* ONE RESET AND FIVE STATEMENTS, in the order `resetForNewPlan` had them —
     including `clearArtDismissed`, which is here because a piece of art is a
     wall feature that got a spot and its dismissal is the same kind of decision
     as a surface's. */
  const resetSurfaces = useCallback(() => {
    setSurfaceRoomId(null); docActions.clearSurfaceResults();
    setSurfaceState({ status: 'idle', roomId: null }); docActions.clearSurfaceDismissed();
    docActions.clearArtDismissed();
  }, [docActions]);

  return {
    roomId: surfaceRoomId, setRoomId: setSurfaceRoomId,
    state: surfaceState, setState: setSurfaceState,
    computeSurfaces,
    resetSurfaces,
  };
}
