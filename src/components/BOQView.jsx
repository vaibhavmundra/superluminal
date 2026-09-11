import React from 'react';
import { fmtWatts, fmtBeam } from '../lib/boq.js';

// ---------------------------------------------------------------------------
// BOQView — the drawing, counted.
//
// IT REPLACES THE CANVAS RATHER THAN SITTING BESIDE IT. A schedule is not a
// second view of the same thing you are looking at; it is the other half of the
// deliverable, read at a different moment and by a different person. Squeezing
// it into a corner of the drawing screen would make both worse, and the tab pair
// in the top bar says plainly that these are two ways of looking at one job.
//
// NOTHING HERE COMPUTES ANYTHING. buildBOQ() did that, and the same numbers go
// into the three files — see boq.js for why the table is built once. This file
// is markup.
// ---------------------------------------------------------------------------

// Shared cell styling, resolved by hand from the old `table.boq` rules so the
// computed style survives losing the `boq` class (see the class-removal note
// at the end of this file for the cascade this replaces).
const TH_BASE = 'text-left text-[9.5px] tracking-[.04em] uppercase text-subtle pt-[7px] px-[6px] pb-[5px] border-b border-ink tabular-nums';
const TH = `${TH_BASE} whitespace-nowrap`;
/**
 * THE SAME HEADER, ALLOWED TO WRAP — and the space-breakdown table needs it.
 *
 * `nowrap` is right for the schedule above, whose eight columns are wide and
 * whose labels are one short word. The breakdown runs to TEN columns on a plan
 * with a wet room and a track, which leaves each of them 8.4% of a 794px sheet —
 * about 64px — and "Track heads" is 76px of text. A `nowrap` cell cannot shrink
 * below its content, so the table grew past its container and the last column
 * hung off the right margin. Correcting the percentages (they used to total
 * 124.8%) was necessary and did not fix this on its own.
 *
 * Wrapping is the fix rather than shortening the label: "Heads" on its own does
 * not say heads of WHAT, and the column has to survive the next one being added
 * beside it. Two lines of header costs nothing — the row is already two lines
 * tall wherever a room name wraps.
 *
 * NOT `whitespace-normal` ON TOP OF `TH`. Both set the same property, and which
 * one wins is decided by the order Tailwind emits them in the stylesheet rather
 * than the order they appear in the attribute — the trap documented at the top
 * of App.jsx. Composing from a base that never says `nowrap` cannot lose that
 * fight.
 */
const TH_WRAP = TH_BASE;
const TD = 'py-[6px] px-[6px] border-b border-border align-baseline break-words tabular-nums';
const TD_I = TD + ' text-subtle text-[10px]';
const TD_R = TD + ' text-right whitespace-nowrap';
const TD_U = TD + ' text-[10px] text-muted whitespace-nowrap';
const TD_NOTE = TD + ' text-muted text-[10px] leading-[1.4]';
const TFOOT = 'pt-[9px] px-[6px] pb-[6px] border-t border-ink border-b-0 align-baseline break-words tabular-nums';
const TFOOT_R = TFOOT + ' text-right whitespace-nowrap';
const TFOOT_U = TFOOT + ' text-[10px] text-muted whitespace-nowrap';
const TFOOT_NOTE = TFOOT + ' text-muted text-[10px] leading-[1.4]';
const CAVEAT_TD = TFOOT + ' text-[10.5px] text-subtle leading-[1.4]';
const ROW_HOVER = 'hover:bg-accent-soft';
/**
 * `text-ink` ON THE TABLE, AND IT IS NOT BELT-AND-BRACES.
 *
 * The sheet sets `text-ink`, and most cells declare no colour of their own — so
 * on paper they should simply inherit black. They did not: measured in the
 * browser, the sheet computed `rgb(0,0,0)` and the `<table>` inside it computed
 * `rgb(225,220,205)`, the page's off-white body colour. Something between the
 * two re-asserts it (a reset rule reachable only through nested CSS, which is
 * why searching `selectorText` for it comes up empty), and inheritance from an
 * ancestor CLASS loses to any rule that names the element.
 *
 * So the table says what colour it is. Every explicit grey below —
 * `text-subtle` on a header, `text-muted` on a note — still wins where it is
 * set, because those are classes on the cell itself.
 */
const TABLE = 'w-full border-collapse text-[11px] table-fixed text-ink';
const NOTE = 'text-[11.5px] text-muted leading-[1.5] mt-2';

// A number, rounded, in the mono face. `dp` DEFAULTS TO ZERO AND IS HONOURED AT
// ZERO — the obvious `dp ? v.toFixed(dp) : v` treats 0 as "no rounding" and
// printed a space area as 125.53257067756813.
const N = ({ v, dp = 0 }) => (
  <span className="tabular-nums">{v == null ? '—' : Number(v).toFixed(dp)}</span>
);

export default function BOQView({ boq, planName }) {
  if (!boq || (!boq.lines.length && !boq.rooms.length)) {
    return (
      <div className="w-full flex justify-center px-[18px] pb-[60px] max-[900px]:px-[10px] max-[900px]:pb-[40px]">
        <div className="my-20 mx-auto text-center max-w-[40ch]">
          <h2 className="text-[16px] mt-0 mx-0 mb-1.5">Nothing to schedule yet</h2>
          <p className={NOTE}>
            Light at least one space and the fittings will be counted here.
          </p>
        </div>
      </div>
    );
  }

  const t = boq.totals;

  return (
    <div className="w-full flex justify-center px-[18px] pb-[60px] max-[900px]:px-[10px] max-[900px]:pb-[40px]">
      {/* THE SHEET IS PAPER, SO IT IS WHITE AND IT SETS ITS OWN INK.
          `bg-surface` was here, and `--color-surface` is `rgba(255,255,255,0.05)`
          — a glass token for panels floating over the black page. A schedule is
          not a panel: it is an A4 sheet, it is what somebody prints, and at five
          percent white the page's black came straight through it. Literal
          `bg-white` rather than a token, for the same reason the plan's own paper
          card is literal — its whole job is to be an opaque sheet the colour of
          paper, and a token that can be retuned into glass is what broke it.

          `text-ink` IS THE OTHER HALF AND IS NOT OPTIONAL. The page's body
          colour is `--color-text: #e1dccd`, a warm off-white for the dark
          ground, and most cells in here declare no colour of their own — they
          inherited it. Turning the sheet white without this would have swapped
          an invisible background for invisible text. The greys that DO declare
          themselves (`text-subtle`, `text-muted`) are mid-tones that read on
          white already, so they still win where they are set. */}
      <div className="w-[794px] max-w-full min-h-[1123px] bg-white text-ink border border-border rounded pt-[52px] px-[58px] pb-[64px] shadow-[0_1px_3px_rgba(10,10,10,0.07)] max-[900px]:pt-[28px] max-[900px]:px-[20px] max-[900px]:pb-[40px] max-[900px]:min-h-0">
        <header className="flex gap-5 items-start justify-between flex-wrap pb-4 mb-1.5 border-b border-border">
          <div>
            <h1 className="m-0 mb-1 text-[18px] tracking-[-0.02em]">Lighting schedule</h1>
            <p className={NOTE}>
              {planName ? <><b>{planName}</b> · </> : null}
              {boq.rooms.length} space{boq.rooms.length === 1 ? '' : 's'} ·{' '}
              {t.areaSqft ?? '—'} sqft
              {boq.scaled ? null : <> · <b>no scale set</b></>}
            </p>
          </div>
          {/* THE THREE NUMBERS SOMEBODY ACTUALLY WANTS, before the table. A
              schedule is skimmed for the count and the load long before anyone
              reads a row of it. */}
          <div className="flex gap-[7px]">
            <div className="min-w-[82px] py-2 px-[11px] border border-border rounded-[8px] bg-surface-2">
              <b className="block text-[17px] tracking-[-0.02em] leading-[1.15] tabular-nums">{t.fittings}</b>
              <span className="block text-[9.5px] text-subtle mt-[2px]">fittings</span>
            </div>
            {/* Only when there is any. A tile reading "0.00 m of strip" spends a
                third of the summary saying that a thing is absent. */}
            {t.stripMetres > 0 && (
              <div className="min-w-[82px] py-2 px-[11px] border border-border rounded-[8px] bg-surface-2">
                <b className="block text-[17px] tracking-[-0.02em] leading-[1.15] tabular-nums">{t.stripMetres.toFixed(2)}</b>
                <span className="block text-[9.5px] text-subtle mt-[2px]">m of strip</span>
              </div>
            )}
            {/* WHOLE METRES, because that is how the figure is made — see
                trackMetres in boq.js. Two decimals here would claim a precision
                the rounding has already deliberately spent. */}
            {t.trackMetres > 0 && (
              <div className="min-w-[82px] py-2 px-[11px] border border-border rounded-[8px] bg-surface-2">
                <b className="block text-[17px] tracking-[-0.02em] leading-[1.15] tabular-nums">{t.trackMetres}</b>
                <span className="block text-[9.5px] text-subtle mt-[2px]">m of track</span>
              </div>
            )}
            <div className="min-w-[82px] py-2 px-[11px] border border-border rounded-[8px] bg-surface-2">
              <b className="block text-[17px] tracking-[-0.02em] leading-[1.15] tabular-nums">{t.watts}</b>
              <span className="block text-[9.5px] text-subtle mt-[2px]">watts connected</span>
            </div>
          </div>
        </header>

        <div className="max-[900px]:overflow-x-auto">
        <table className={TABLE}>
          <colgroup>
            <col className="w-[22px]" /><col className="w-[25%]" /><col className="w-[9%]" />
            <col className="w-[7%]" /><col className="w-[10%]" /><col className="w-[7%]" />
            <col className="w-[10%]" /><col className="w-[29%]" />
          </colgroup>
          <thead>
            <tr>
              <th className={TH}>#</th>
              <th className={TH}>Description</th>
              <th className={TH}>Qty</th>
              <th className={TH}>Unit</th>
              <th className={TH}>Wattage</th>
              <th className={TH}>Beam</th>
              <th className={TH}>Load</th>
              <th className={TH}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {boq.lines.map((l, i) => (
              <tr key={l.id} className={ROW_HOVER}>
                <td className={TD_I}>{i + 1}</td>
                <td className={TD}><b>{l.label}</b></td>
                <td className={TD_R}>{l.unit === 'm' ? l.qty.toFixed(2) : l.qty}</td>
                <td className={TD_U}>{l.unit}</td>
                <td className={TD_U}>{fmtWatts(l)}</td>
                <td className={TD_U}>{fmtBeam(l)}</td>
                <td className={TD_R}>{l.load == null ? '—' : `${l.load} W`}</td>
                <td className={TD_NOTE}>
                  {(l.id === 'strip' || l.id === 'track-profile') && l.pieces
                    ? <><b>{l.pieces} run{l.pieces === 1 ? '' : 's'}</b> · {l.note}</>
                    : l.note}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={TFOOT} />
              <td className={TFOOT}><b>Total</b></td>
              <td className={TFOOT_R}><b>{t.fittings}</b></td>
              <td className={TFOOT_U}>nos</td>
              <td className={TFOOT} colSpan={2} />
              <td className={TFOOT_R}><b>{t.watts} W</b></td>
              <td className={TFOOT_NOTE}>
                {t.wattsPerSqft != null && <>{t.wattsPerSqft} W/sqft</>}
              </td>
            </tr>
            {/* WHAT THE LOAD LEAVES OUT, on the face of the table. A connected
                load that quietly omits eight sconces is worse than no load at
                all, because the reader cannot tell it is incomplete. */}
            {t.unstated.length > 0 && (
              <tr>
                <td className={CAVEAT_TD} />
                <td className={CAVEAT_TD} colSpan={7}>
                  Load excludes {t.unstated.map((u) => `${u.qty} × ${u.label.toLowerCase()}`).join(', ')}
                  {' '}— wattage is set when the fitting is chosen.
                </td>
              </tr>
            )}
          </tfoot>
        </table>
        </div>

        {/* --- WHAT IS ON THE DRAWING AND IS NOT A LIGHT THIS APP SELLS ----
            IT WAS "CEILING ITEMS", AND THAT NAME STOPPED BEING TRUE — the same
            rename, for the same reason, that the rail's own row went through.
            Three of the seven are not on a ceiling: a split AC's indoor unit is
            on a wall at 2100mm, a geyser is over a door, and a standing lamp is
            on the floor. Two more are LIGHTS — a chandelier and a standard lamp
            — which is the other half of why "ceiling" was the wrong word for
            the group; what these seven share is not where they are, it is that
            somebody else supplies them and this schedule coordinates with them
            rather than pricing them. See COORDINATION in lib/boq.js. */}
        {boq.coordination.length > 0 && (<>
          <h2 className="mt-[26px] mb-[2px] text-[11.5px] tracking-[.06em] uppercase text-subtle">Other items</h2>
          <p className={NOTE + ' mt-0 mx-0 mb-[9px] max-w-[60ch]'}>
            On the drawing because the electrical work has to allow for them —
            and, where they take ceiling, because they are why the lights are
            where they are. Counted, and deliberately not billed.
          </p>
          <table className={TABLE + ' max-w-[430px]'}>
            <colgroup>
              <col className="w-[22px]" /><col /><col className="w-[9%]" /><col className="w-[7%]" />
            </colgroup>
            <thead><tr><th className={TH}>#</th><th className={TH}>Description</th>
              <th className={TH}>Qty</th><th className={TH}>Unit</th></tr></thead>
            <tbody>
              {boq.coordination.map((c, i) => (
                <tr key={c.id} className={ROW_HOVER}>
                  <td className={TD_I}>{i + 1}</td>
                  <td className={TD}><b>{c.label}</b></td>
                  <td className={TD_R}>{c.qty}</td>
                  <td className={TD_U}>nos</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>)}

        {/* --- THE SPACE BREAKDOWN WAS HERE, AND IT IS GONE FROM THE SCREEN --
            A ROOM-BY-ROOM GRID OF FITTING COUNTS, under the order it adds up
            to. It was asked for and removed (2026-09-11): on screen the
            schedule is read as ONE order — what to buy for this plan — and a
            second table restating the same totals split eleven ways is the
            page's longest section answering a question nobody had while
            reading it. Where a space's fittings ARE the question, the drawing
            answers it better than a grid can: press the space and the Analysis
            panel lists them with their wattages, their optics and what each
            contributes.

            IT IS STILL IN EVERY EXPORT, deliberately, and that is not an
            inconsistency. A schedule sent to a contractor is read away from the
            drawing, by somebody who cannot press a space to find out what is in
            it — so the CSV, the PDF and the spreadsheet all keep their
            per-space block, and the workbook keeps its second sheet. See
            `boqTable`'s `perRoom` and SHEET_ROOMS in lib/boq.js; nothing there
            was touched.

            WHAT WENT WITH IT: the `narrow` and `tracked` column gates, which
            existed only to decide which of its optional columns had earned a
            place. */}
      </div>
    </div>
  );
}
