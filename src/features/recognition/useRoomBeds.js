import { useCallback, useState } from 'react';
import { roomSnapshot, toPlanRect, requestAccents } from '../../lib/accentMask.js';
import { detectFurniture, detectionsToZones, plausibleBed } from '../../lib/furniture.js';
import { label as labelBeds, judgeNote, BED_SOURCES } from '../../lib/bedFit.js';
import { regionFromOutline, outlineStats } from '../../lib/outline.js';
import { expectsBed } from '../../lib/roomTypes.js';
import { collectBedRows } from './bedResults.js';
import { mapLimit } from '../../lib/mapLimit.js';

export default function useRoomBeds({ source, img, wallLayerSet, pxPerFt, docActions, projectId, roomTypes, detections, useBoundingRect }) {
  /**
   * WHICH DETECTOR GOT THE BED RIGHT, for one room.
   *
   * Two crops of the same room, made by the same roomSnapshot() that feeds the
   * accent and task passes, differing in NOTHING but the rectangles drawn on
   * them. Same crop rectangle, same wash, same colour, same line weight — the
   * only thing the model can prefer is the geometry, which is the only thing it
   * is being asked about.
   *
   * NO LIGHTS ON THESE CROPS. Everywhere else the ambient layout is drawn onto
   * the picture so the model does not recommend a fitting where one already
   * hangs. Here it would be noise at best and misleading at worst: this runs
   * BEFORE the layout, precisely because the answer moves the layout.
   *
   * Takes the outline rather than a laid-out room for the same reason — there
   * is no `plan` yet when this runs.
   */
  const computeBedFit = useCallback(async (o, a, b, { signal = null } = {}) => {
    const region = regionFromOutline(o, pxPerFt);
    if (!region?.ok) throw new Error('That outline has no region.');
    const polygonPx = useBoundingRect ? region.boundingRect : region.polygon;
    const stats = outlineStats(o, pxPerFt);

    const shots = await Promise.all([a, b].map((boxes, i) => roomSnapshot({
      source, img, polygonPx, lightsPx: [], wallLayers: wallLayerSet,
      boxes: boxes.map((d) => d.rect),
      badge: BED_SOURCES[i].letter,
    })));

    const payload = await requestAccents({
      plans: shots, task: 'bedfit', signal,
      counts: { a: a.length, b: b.length },
      room: {
        name: o.name || null,
        widthFt: stats?.widthFt ?? null, heightFt: stats?.heightFt ?? null,
        areaSqft: stats?.areaSqft ?? null,
      },
    });
    return { shots, verdict: payload.result, meta: payload.meta };
  }, [source, img, wallLayerSet, pxPerFt, useBoundingRect]);

  /**
   * ASK CHATGPT ABOUT ONE ROOM — the fallback, and the ONLY thing GPT does
   * with beds now.
   *
   * WHEN IT RUNS, AND IT IS THE WHOLE RULE: the classifier called a space a
   * bedroom and the whole-plan `bed-filter` pass put no bed in it. That is a
   * contradiction between two answers already in hand, and it is the only
   * trigger. A bedroom that has its bed does not come here. A space that is not
   * a bedroom does not come here whatever the pass found.
   *
   * WHY IT IS WORTH A CALL. A bedroom with no bed is not an unusual bedroom, it
   * is a failed detection — see expectsBed in roomTypes.js — and it matters more
   * than any other miss because a bed is the one piece of furniture that CHANGES
   * THE CEILING: nothing goes over it, because whoever is lying there looks
   * straight up into the fitting. A missed bed is a downlight in somebody's eyes.
   *
   * WHY THE CROP HELPS. The whole plan is one image at roughly 17 pixels to the
   * foot on a large sheet, where a mattress is 45px across. This sends ONE room
   * at 700x700 — nearer 54 pixels to the foot for a 13ft room — reusing the crop
   * the classifier already built, so it costs no extra render. Same model, same
   * question, four times the resolution.
   *
   * ONE CALL. NO CONTEST. NO JUDGE.
   *
   * What was here before, in order: two vendors contested and arbitrated; then
   * two SAMPLES of GPT contested and arbitrated. Both were ways of buying
   * confidence in a bed outline nobody trusted. With `bed-filter` handling the
   * primary path, this is a narrow fallback on a room the primary pass already
   * missed — and a second opinion about a single fallback answer is a call spent
   * to choose between two guesses rather than to improve either. `contestFor`,
   * `applyVerdict` and `computeBedFit` all still exist, unused by this path.
   */
  const refindBeds = useCallback(async (r, { reuseShot = null, signal = null } = {}) => {
    const shot = reuseShot ?? await roomSnapshot({
      source, img, polygonPx: r.plan.polygonPx, lightsPx: [], wallLayers: wallLayerSet,
    });
    const who = r.outline.name || r.id;

    const payload = await detectFurniture({
      base64: shot.base64, mime: shot.mime,
      // ONLY BEDS. The whole-plan pass asks a bed-specific model; here the
      // question is precisely "is there a bed in this room", and a narrower
      // prompt is a better answer.
      classes: ['bed'],
      provider: 'openai',
      w: shot.w, h: shot.h, signal,
    });

    // The crop's own space first, then back onto the plan. detectionsToZones
    // resolves fractions and rescales against the image it was given; every
    // threshold in it (confidence, area fraction) is therefore relative to THE
    // ROOM, which is the right frame — a bed is a large share of a bedroom crop
    // and a tiny share of a floor plan.
    const image = { w: shot.w, h: shot.h };
    const read = detectionsToZones(payload, { image, polygon: null, classes: ['bed'] });

    // OUT OF THE CROP'S SPACE FIRST, THEN MEASURED. The crop is upscaled or
    // downscaled by roomSnapshot, so the plan's px-per-foot means nothing inside
    // it — a size gate applied to a crop-space rectangle would be measuring in
    // the wrong units. `toPlanRect` is the line where real feet become knowable
    // again, so the gate goes immediately after it.
    let rejected = 0;
    const beds = labelBeds(read.kept, 'openai')
      .map((d, i) => ({
        ...d,
        id: `det-refound-oa-${r.id}-${i}`,
        rect: toPlanRect(d.rect, shot.crop, image),
        refound: true,
      }))
      .filter((d) => {
        const fit = plausibleBed(d.rect, pxPerFt);
        if (!fit.ok) {
          rejected++;
          console.warn(`[beds] ${who}: GPT returned a box that is not a bed — ${fit.why}`);
        }
        return fit.ok;
      });

    // The record the panel and planState keep per space. `asked: false` because
    // nothing was arbitrated; `kind` describes what the one call came back with,
    // so the panel's per-space line still says something true.
    const rec = {
      kind: beds.length ? 'gpt' : 'none',
      pick: 'openai', asked: false, confidence: 0,
      why: beds.length
        ? `GPT found ${beds.length} bed(s) in the crop`
        : 'GPT found no bed in the crop either',
      winner: beds,
      counts: { openai: beds.length, roboflow: 0 },
      rejected,
    };
    console.log(`[beds] ${who}: ${judgeNote(rec)}`);

    // `a`/`b` are still in the returned shape because absorbBedRows reads
    // row.a.length and row.b.length for its own record. One call, so b is empty.
    return { a: beds, b: [], rec, shot };
  }, [source, img, wallLayerSet, pxPerFt]);

  const absorbBedRows = useCallback((rows, existing) => {
    const { found, verdicts } = collectBedRows(rows, existing);
    if (found.length) docActions.addDetections(found);
    docActions.mergeBedVerdicts(verdicts);
    return { found, verdicts };
  }, [docActions]);

  /**
   * LOOK AGAIN — the admin's manual version of the bedroom pass.
   *
   * The pipeline asks about a bedroom once, and on a plan where the first answer
   * was wrong there is otherwise no way to ask twice without re-running the whole
   * thing. This is that button: same crop, same two samples, same judge, same
   * gates.
   *
   * SCOPED TO THE ROOM IN FOCUS when there is one, because that is the room whose
   * beds the person is looking at and two calls is a cheap question. With no
   * focus it sweeps every space that ought to contain a bed.
   */
  const [bedLook, setBedLook] = useState(null);   // null | 'busy' | a result line

  const lookAgainAtBeds = useCallback(async ({ rooms, focus }) => {
    if (!source || !pxPerFt || !rooms.length) return;
    const targets = focus
      ? [focus]
      : rooms.filter((r) => expectsBed(projectId, roomTypes[r.id]?.type));
    if (!targets.length) { setBedLook('no bedrooms to look in'); return; }

    setBedLook('busy');
    try {
      const rows = await mapLimit(targets, 2, async (r) => {
        try {
          const out = await refindBeds(r);
          return { id: r.id, name: r.outline.name,
                   poly: r.plan?.polygonPx ?? r.geo?.polygonPx ?? null, ...out };
        } catch (err) {
          console.warn('[beds] look again failed for', r.outline.name, err);
          return null;
        }
      });
      const { found } = absorbBedRows(rows, detections);
      const asked = rows.filter(Boolean).length;
      setBedLook(`${found.length} bed${found.length === 1 ? '' : 's'} added`
        + ` from ${asked} space${asked === 1 ? '' : 's'}`);
      console.log('[beds] look again', { targets: targets.map((r) => r.outline.name), found });
    } catch (err) {
      console.error('[beds] look again failed', err);
      setBedLook('that did not work — see the console');
    }
  }, [source, pxPerFt, projectId, roomTypes, refindBeds, absorbBedRows, detections]);

  return { refindBeds, absorbBedRows, lookAgainAtBeds, bedLook, computeBedFit };
}
