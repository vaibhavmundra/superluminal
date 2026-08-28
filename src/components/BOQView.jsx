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

// A number, rounded, in the mono face. `dp` DEFAULTS TO ZERO AND IS HONOURED AT
// ZERO — the obvious `dp ? v.toFixed(dp) : v` treats 0 as "no rounding" and
// printed a space area as 125.53257067756813.
const N = ({ v, dp = 0 }) => (
  <span className="boq-n">{v == null ? '—' : Number(v).toFixed(dp)}</span>
);

export default function BOQView({ boq, planName }) {
  if (!boq || (!boq.lines.length && !boq.rooms.length)) {
    return (
      <div className="boq-wrap">
        <div className="boq-empty">
          <h2>Nothing to schedule yet</h2>
          <p className="note">
            Light at least one space and the fittings will be counted here.
          </p>
        </div>
      </div>
    );
  }

  const t = boq.totals;
  // Whether the narrow-beam column earns its place on THIS plan.
  const narrow = boq.rooms.reduce((n, r) => n + (r.qty['small-narrow'] || 0), 0);

  return (
    <div className="boq-wrap">
      <div className="boq-sheet">
        <header className="boq-head">
          <div>
            <h1>Lighting schedule</h1>
            <p className="note">
              {planName ? <><b>{planName}</b> · </> : null}
              {boq.rooms.length} space{boq.rooms.length === 1 ? '' : 's'} ·{' '}
              {t.areaSqft ?? '—'} sqft
              {boq.scaled ? null : <> · <b>no scale set</b></>}
            </p>
          </div>
          {/* THE THREE NUMBERS SOMEBODY ACTUALLY WANTS, before the table. A
              schedule is skimmed for the count and the load long before anyone
              reads a row of it. */}
          <div className="boq-tiles">
            <div className="boq-tile"><b>{t.fittings}</b><span>fittings</span></div>
            {/* Only when there is any. A tile reading "0.00 m of strip" spends a
                third of the summary saying that a thing is absent. */}
            {t.stripMetres > 0 && (
              <div className="boq-tile"><b>{t.stripMetres.toFixed(2)}</b><span>m of strip</span></div>
            )}
            <div className="boq-tile"><b>{t.watts}</b><span>watts connected</span></div>
          </div>
        </header>

        <div className="boq-scroll">
        <table className="boq">
          <colgroup>
            <col className="boq-i" /><col className="c-desc" /><col className="c-qty" />
            <col className="c-unit" /><col className="c-watt" /><col className="c-beam" />
            <col className="c-load" /><col className="c-note" />
          </colgroup>
          <thead>
            <tr>
              <th className="boq-i">#</th>
              <th>Description</th>
              <th className="boq-r">Qty</th>
              <th>Unit</th>
              <th>Wattage</th>
              <th>Beam</th>
              <th className="boq-r">Load</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {boq.lines.map((l, i) => (
              <tr key={l.id}>
                <td className="boq-i">{i + 1}</td>
                <td><b>{l.label}</b></td>
                <td className="boq-r">{l.unit === 'm' ? l.qty.toFixed(2) : l.qty}</td>
                <td className="boq-u">{l.unit}</td>
                <td className="boq-u">{fmtWatts(l)}</td>
                <td className="boq-u">{fmtBeam(l)}</td>
                <td className="boq-r">{l.load == null ? '—' : `${l.load} W`}</td>
                <td className="boq-note">
                  {l.id === 'strip' && l.pieces
                    ? <><b>{l.pieces} run{l.pieces === 1 ? '' : 's'}</b> · {l.note}</>
                    : l.note}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td><b>Total</b></td>
              <td className="boq-r"><b>{t.fittings}</b></td>
              <td className="boq-u">nos</td>
              <td colSpan={2} />
              <td className="boq-r"><b>{t.watts} W</b></td>
              <td className="boq-note">
                {t.wattsPerSqft != null && <>{t.wattsPerSqft} W/sqft</>}
              </td>
            </tr>
            {/* WHAT THE LOAD LEAVES OUT, on the face of the table. A connected
                load that quietly omits eight sconces is worse than no load at
                all, because the reader cannot tell it is incomplete. */}
            {t.unstated.length > 0 && (
              <tr className="boq-caveat">
                <td />
                <td colSpan={7}>
                  Load excludes {t.unstated.map((u) => `${u.qty} × ${u.label.toLowerCase()}`).join(', ')}
                  {' '}— wattage is set when the fitting is chosen.
                </td>
              </tr>
            )}
          </tfoot>
        </table>
        </div>

        {boq.coordination.length > 0 && (<>
          <h2 className="boq-h2">Ceiling items</h2>
          <p className="note boq-sub">
            On the drawing because they occupy ceiling — they are why the lights
            are where they are. Counted, and deliberately not billed.
          </p>
          <table className="boq boq-narrow">
            <colgroup>
              <col className="boq-i" /><col /><col className="c-qty" /><col className="c-unit" />
            </colgroup>
            <thead><tr><th className="boq-i">#</th><th>Description</th>
              <th className="boq-r">Qty</th><th>Unit</th></tr></thead>
            <tbody>
              {boq.coordination.map((c, i) => (
                <tr key={c.id}>
                  <td className="boq-i">{i + 1}</td>
                  <td><b>{c.label}</b></td>
                  <td className="boq-r">{c.qty}</td>
                  <td className="boq-u">nos</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>)}

        {boq.rooms.length > 0 && (<>
          <h2 className="boq-h2">Space breakdown</h2>
          <p className="note boq-sub">
            How a site is wired and how a contractor prices it. These add up to
            the totals above.
          </p>
          <div className="boq-scroll">
          <table className="boq">
            <colgroup>
              <col className="c-room" /><col className="c-num" /><col className="c-num" />
              <col className="c-num" /><col className="c-num" /><col className="c-num" />
              <col className="c-num" />
            </colgroup>
            <thead>
              <tr>
                <th>Space</th>
                <th className="boq-r">Area</th>
                <th className="boq-r">Small</th>
                {/* ONLY WHERE THERE ARE ANY. A column of dashes on every
                    residential plan is a column nobody reads; a wet room's 5 W
                    narrow-beam lamp is a different product from the 7 W and has
                    to be countable separately when it exists. */}
                {narrow > 0 && <th className="boq-r">Small 5W</th>}
                <th className="boq-r">Large</th>
                <th className="boq-r">Spots</th>
                <th className="boq-r">Sconces</th>
                <th className="boq-r">Strip</th>
              </tr>
            </thead>
            <tbody>
              {boq.rooms.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b></td>
                  <td className="boq-r"><N v={r.areaSqft} dp={0} /></td>
                  <td className="boq-r">{r.qty.small || '—'}</td>
                  {narrow > 0 && <td className="boq-r">{r.qty['small-narrow'] || '—'}</td>}
                  <td className="boq-r">{r.qty.large || '—'}</td>
                  <td className="boq-r">{r.qty.spot || '—'}</td>
                  <td className="boq-r">{r.qty.sconce || '—'}</td>
                  <td className="boq-r">{r.qty.strip ? `${r.qty.strip.toFixed(2)} m` : '—'}</td>
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
