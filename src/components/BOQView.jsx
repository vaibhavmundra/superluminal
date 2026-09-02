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
const TH = 'text-left text-[9.5px] tracking-[.04em] uppercase text-subtle pt-[7px] px-[6px] pb-[5px] border-b border-ink whitespace-nowrap tabular-nums';
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
const TABLE = 'w-full border-collapse text-[11px] table-fixed';
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
  // Whether the narrow-beam column earns its place on THIS plan.
  const narrow = boq.rooms.reduce((n, r) => n + (r.qty['small-narrow'] || 0), 0);
  // ...and whether the track columns do. Same rule and the same reason: a plan
  // with no track on it should not carry three columns of dashes explaining
  // that.
  const tracked = boq.rooms.reduce((n, r) => n + (r.qty['track-profile'] || 0), 0);

  return (
    <div className="w-full flex justify-center px-[18px] pb-[60px] max-[900px]:px-[10px] max-[900px]:pb-[40px]">
      <div className="w-[794px] max-w-full min-h-[1123px] bg-surface border border-border rounded pt-[52px] px-[58px] pb-[64px] shadow-[0_1px_3px_rgba(10,10,10,0.07)] max-[900px]:pt-[28px] max-[900px]:px-[20px] max-[900px]:pb-[40px] max-[900px]:min-h-0">
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

        {boq.coordination.length > 0 && (<>
          <h2 className="mt-[26px] mb-[2px] text-[11.5px] tracking-[.06em] uppercase text-subtle">Ceiling items</h2>
          <p className={NOTE + ' mt-0 mx-0 mb-[9px] max-w-[60ch]'}>
            On the drawing because they occupy ceiling — they are why the lights
            are where they are. Counted, and deliberately not billed.
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

        {boq.rooms.length > 0 && (<>
          <h2 className="mt-[26px] mb-[2px] text-[11.5px] tracking-[.06em] uppercase text-subtle">Space breakdown</h2>
          <p className={NOTE + ' mt-0 mx-0 mb-[9px] max-w-[60ch]'}>
            How a site is wired and how a contractor prices it. These add up to
            the totals above.
          </p>
          <div className="max-[900px]:overflow-x-auto">
          <table className={TABLE}>
            <colgroup>
              <col className="w-[24%]" /><col className="w-[12.6%]" /><col className="w-[12.6%]" />
              <col className="w-[12.6%]" /><col className="w-[12.6%]" /><col className="w-[12.6%]" />
              <col className="w-[12.6%]" />
              {tracked > 0 && <col className="w-[12.6%]" />}
              {tracked > 0 && <col className="w-[12.6%]" />}
            </colgroup>
            <thead>
              <tr>
                <th className={TH}>Space</th>
                <th className={TH}>Area</th>
                <th className={TH}>Small</th>
                {/* ONLY WHERE THERE ARE ANY. A column of dashes on every
                    residential plan is a column nobody reads; a wet room's 5 W
                    narrow-beam lamp is a different product from the 7 W and has
                    to be countable separately when it exists. */}
                {narrow > 0 && <th className={TH}>Small 5W</th>}
                <th className={TH}>Large</th>
                <th className={TH}>Spots</th>
                <th className={TH}>Sconces</th>
                <th className={TH}>Strip</th>
                {tracked > 0 && <th className={TH}>Track</th>}
                {tracked > 0 && <th className={TH}>Track heads</th>}
              </tr>
            </thead>
            <tbody>
              {boq.rooms.map((r) => (
                <tr key={r.id} className={ROW_HOVER}>
                  <td className={TD}><b>{r.name}</b></td>
                  <td className={TD_R}><N v={r.areaSqft} dp={0} /></td>
                  <td className={TD_R}>{r.qty.small || '—'}</td>
                  {narrow > 0 && <td className={TD_R}>{r.qty['small-narrow'] || '—'}</td>}
                  <td className={TD_R}>{r.qty.large || '—'}</td>
                  <td className={TD_R}>{r.qty.spot || '—'}</td>
                  <td className={TD_R}>{r.qty.sconce || '—'}</td>
                  <td className={TD_R}>{r.qty.strip ? `${r.qty.strip.toFixed(2)} m` : '—'}</td>
                  {tracked > 0 && (
                    <td className={TD_R}>
                      {r.qty['track-profile'] ? `${r.qty['track-profile']} m` : '—'}
                    </td>
                  )}
                  {/* THE HEADS AS ONE FIGURE, ambient and directional together.
                      The two are separate LINES on the order above, because they
                      are two products; per space the question being asked is
                      "how many things clip into this room's track", and splitting
                      it costs a column to answer half of it twice. */}
                  {tracked > 0 && (
                    <td className={TD_R}>
                      {(r.qty['track-ambient'] || 0) + (r.qty['track-spot'] || 0) || '—'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </>)}
      </div>
    </div>
  );
}
