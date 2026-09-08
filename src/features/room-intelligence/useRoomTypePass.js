import { useCallback } from 'react';
import { roomSnapshot, requestAccents } from '../../lib/accentMask.js';

/**
 * ROOM-TYPE CLASSIFICATION.
 *
 * One crop, one small call, one word back — and everything conditional
 * downstream reads the answer: which spaces take accents, which take task
 * spots, which are expected to hold a bed, which are outdoors. See
 * lib/roomTypes.js for why the kind of BUILDING is asked rather than guessed,
 * and why the kind of ROOM is then read off the drawing.
 *
 * NO STATE OF ITS OWN. The classification is the document's (`roomTypes`) and
 * the per-run progress belongs to whatever is driving the loop; this is the
 * call and the crop it reuses, and nothing else.
 */
export default function useRoomTypePass({ source, img, wallLayerSet, projectId }) {
  /** What kind of space is it? One small call, one word back. */
  const computeRoomType = useCallback(async (r, { reuseShot = null } = {}) => {
    const shot = reuseShot ?? await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx,
      lightsPx: r.plan.lightsPx, wallLayers: wallLayerSet,
    });
    const payload = await requestAccents({
      plan: shot, task: 'roomtype', projectId,
      room: {
        name: r.outline.name || null,
        widthFt: r.stats.widthFt, heightFt: r.stats.heightFt, areaSqft: r.stats.areaSqft,
      },
    });
    return { shot, ...payload.result };
  }, [source, img, wallLayerSet, projectId]);

  return { computeRoomType };
}
