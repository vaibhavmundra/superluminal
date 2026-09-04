import React from 'react';
import { BoardFrame, HeightField } from './SwitchboardCard.jsx';
import { tally } from '../lib/switchboards.js';

// ---------------------------------------------------------------------------
// SwitchboardSheet — every plate on the job, on one piece of paper.
//
// IT REPLACES THE CANVAS RATHER THAN SITTING BESIDE IT, exactly as BOQView does
// and for the same reason: this is not a second view of the drawing you are
// looking at, it is the other half of the deliverable. A switchboard schedule is
// what somebody takes to site, and what they need from it is not WHERE the
// plates are — the plan says that — but WHAT each one is, at what height, and
// how many of them there are. None of that is answerable by clicking eighteen
// rectangles one at a time, which is the only way it could be read before.
//
// PAPER, SO IT IS WHITE AND IT SETS ITS OWN INK. Literal `bg-white` and
// `text-ink`, both for the reason BOQView's own note gives: `bg-surface` is a
// glass token for panels floating over a black page, and at five percent white
// the page's black comes straight through it. The plates are therefore drawn in
// INK and not in the panel's white — see `BoardFrame`'s `ink`, which exists for
// this file.
//
// GROUPED BY SPACE, THEN ORDERED BY SIZE. Two orderings, and each answers a
// different question a person actually asks of this sheet.
//
//   BY SPACE, because a switchboard belongs to a room in the way a light does
//   not: it is on that room's wall, it switches that room's ceiling, and the
//   electrician wires a room at a time. A flat list of thirty plates sorted by
//   number is a list nobody can find anything in.
//
//   THEN BY MODULE COUNT, ASCENDING, within the space. Not by name, which would
//   be the obvious thing and is the wrong thing: SB1..SBn is an ordering by when
//   a plate came into existence, which is an accident of how somebody worked.
//   Size is a fact about the part, it is what the frames are ordered as, and it
//   puts the single sockets together at the top and the big boards at the bottom
//   — which is how a schedule of plates reads on every job.
//
// THE NAME IS THE HEADING AND THE HEIGHT IS UNDER IT, which is the pairing the
// sheet exists to make legible: "SB7, at 300" is a socket and "SB7, at 1200" is
// a switch, and nothing else on the plate says which.
//
// NOTHING HERE COMPUTES ANYTHING. The compositions arrive built — see
// composeSwitchboard and composeOutlet — for the reason BOQView's header gives
// about the schedule: one place works the numbers out, and this file is markup.
// ---------------------------------------------------------------------------

const NOTE = 'text-[11.5px] text-muted leading-[1.5]';

/** One plate: its name, its height, its picture and its parts. */
function Plate({ entry, onHeight }) {
  const board = entry.composition.boards[0];
  if (!board) return null;
  const frames = entry.composition.boards.length;

  return (
    <div className="border border-border rounded-[6px] px-3.5 pt-3 pb-3.5
      flex flex-col gap-2 break-inside-avoid">
      {/* THE NAME AND THE HEIGHT, SPACE-BETWEENED — the pairing this sheet is
          for. The name is what a drawing and a schedule refer to a plate by; the
          height is the one thing about it that a plan view cannot show. */}
      <div className="flex items-baseline justify-between gap-3">
        <b className="text-[13px] tracking-[-0.01em] font-normal">{entry.name}</b>
        {onHeight
          ? <HeightField mm={entry.heightMm} onChange={(mm) => onHeight(entry.id, mm)} />
          : (
            <span className="text-[11.5px] text-muted tabular-nums">
              {entry.heightMm} mm above FFL
            </span>
          )}
      </div>

      {/* WHAT IT IS, IN ONE LINE. A socket outlet and a twelve-module board are
          both "a plate" and the picture below does not name either — a reader
          scanning thirty of these needs the word. */}
      <div className="flex items-baseline justify-between gap-3 text-[10px]
        tracking-[0.08em] uppercase text-subtle">
        <span>{entry.composition.outlet ? 'Socket outlet' : 'Switchboard'}</span>
        <span className="tabular-nums">
          {board.size} {board.size === 1 ? board.unit : board.units}
          {/* SPLIT PLATES SAY SO. Past a country's largest frame a position is
              two plates on one wall — see packBoards — and a sheet showing the
              first of them and nothing else would under-count the job. */}
          {frames > 1 && <> · {frames} frames</>}
        </span>
      </div>

      {/* EVERY FRAME, NOT JUST THE FIRST. Drawn in ink, because this is paper. */}
      <div className="flex flex-col gap-1.5">
        {entry.composition.boards.map((b) => (
          <BoardFrame key={b.index} board={b} ink="#0A0A0A" />
        ))}
      </div>

      {/* THE PARTS, as one wrapped line rather than a table. A table per plate
          on a sheet of thirty is thirty tables; the counts are short and read
          perfectly well as "2 × 6A switch · 1 × Fan regulator". */}
      <p className="m-0 text-[11px] leading-[1.5] text-muted">
        {entry.composition.boards
          .flatMap((b) => tally(b))
          /* MERGED ACROSS THE FRAMES OF ONE POSITION, because two frames on one
             wall are one thing to order. Summed by label, which is by kind and
             rating together — see `tally` for why that is the unit. */
          .reduce((rows, row) => {
            const seen = rows.find((q) => q.label === row.label);
            if (seen) { seen.count += row.count; return rows; }
            return [...rows, { ...row }];
          }, [])
          .map((row) => `${row.count} × ${row.label}`)
          .join('  ·  ')}
      </p>

      {/* AND WHERE ITS SWITCH IS, for the one plate that has none of its own. */}
      {entry.composition.outlet && (
        <p className="m-0 text-[11px] leading-[1.5] text-subtle">
          Switched from {entry.composition.switchedFrom
            ? `the ${entry.composition.switchedFrom.toLowerCase()} board`
            : 'no board yet'}
        </p>
      )}
    </div>
  );
}

/**
 * `groups` is `[{ roomId, name, plates: [...] }]`, already grouped and ordered
 * by the caller — see `boardSheet` in App.jsx. `onHeight(id, mm)` is omitted on
 * the read-only sheet, where the number is printed rather than typed.
 */
export default function SwitchboardSheet({ groups = [], planName = null,
                                           country = null, onHeight = null }) {
  const total = groups.reduce((n, g) => n + g.plates.length, 0);

  if (!total) {
    return (
      <div className="w-full flex justify-center px-[18px] pb-[60px]
        max-[900px]:px-[10px] max-[900px]:pb-[40px]">
        <div className="my-20 mx-auto text-center max-w-[40ch]">
          <h2 className="text-[16px] mt-0 mx-0 mb-1.5">No switchboards yet</h2>
          <p className={NOTE}>
            Confirm the doors and light a space, and the plates will be listed here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full flex justify-center px-[18px] pb-[60px]
      max-[900px]:px-[10px] max-[900px]:pb-[40px]">
      <div className="w-[794px] max-w-full min-h-[1123px] bg-white text-ink
        border border-border rounded pt-[52px] px-[58px] pb-[64px]
        shadow-[0_1px_3px_rgba(10,10,10,0.07)] max-[900px]:pt-[28px]
        max-[900px]:px-[20px] max-[900px]:pb-[40px] max-[900px]:min-h-0">

        <header className="mb-8">
          <h1 className="m-0 text-[19px] tracking-[-0.02em]">Switchboards</h1>
          <p className="m-0 mt-1 text-[11.5px] text-muted">
            {total} plate{total === 1 ? '' : 's'}
            {country && <> · {country.name}</>}
            {planName && <> · {planName}</>}
          </p>
        </header>

        {groups.map((g) => (
          <section key={g.roomId} className="mb-8 last:mb-0">
            {/* THE SPACE'S NAME, RULED — the same weight the schedule gives a
                room, because it is the same division of the same job. */}
            <h2 className="m-0 mb-3 pb-1.5 border-b border-ink text-[10px]
              tracking-[0.11em] uppercase text-subtle
              flex items-baseline justify-between gap-3">
              <span>{g.name}</span>
              <span className="tabular-nums normal-case tracking-normal">
                {g.plates.length}
              </span>
            </h2>
            {/* TWO COLUMNS ON PAPER, ONE WHEN THERE IS NO ROOM FOR TWO. A plate
                is a wide, short picture, so two of them across a 794px sheet is
                the arrangement that wastes the least paper — and an eighteen
                module frame still shrinks to its column rather than overflowing,
                because BoardFrame scales down and not up. */}
            <div className="grid grid-cols-2 gap-3 max-[900px]:grid-cols-1">
              {g.plates.map((entry) => (
                <Plate key={entry.id} entry={entry} onHeight={onHeight} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
