import React, { useEffect, useRef, useState } from 'react';
import { TONES, TONE_LABEL, CEILING_MM_MIN, CEILING_MM_MAX } from '../lib/materials.js';
import SpaceAnalysis from './SpaceAnalysis.jsx';
import Lumens from './Lumens.jsx';

/* ---------------------------------------------------------------------------
   ONE SPACE, OPENED — AND IT IS WHAT THE FLOATING WINDOW IS FOR.

   The spaces list is a list and this is the room. Clicking a row REPLACES the
   list rather than expanding inside it, which is the one change that made the
   panel readable: a room's height, its finishes and its illuminance are four
   decisions deep, and an accordion row holding them puts every other room on the
   plan between this one and the bottom of the screen.

   --- TWO VIEWS NOW, AND THE SECOND ONE IS THE FITTINGS ---------------------
   THE READING IS WHAT SOMEBODY COMES BACK FOR. What the room is owed, what it
   has, and how that splits between the ambient layer and the task layer: four
   figures and a verdict, and the window is sized to hold exactly that (see
   Lumens). Under it, one line saying what the settings came to.

   THE FITTINGS ARE A LIST, AND A LIST DOES NOT BELONG IN A READOUT. A bedroom
   with a cove and nine placed COBs is a dozen rows, each of which opens four
   more lines of wattage chips and beam angles — so it was pushing the figures it
   explains off the top of a column somebody had to scroll. "Show all lights"
   swaps the window over to it, and the way back is the first thing in it.

   IT SWAPS RATHER THAN OPENING A SHEET, which is the whole reason it is worth
   having: the wattage chips move the number, and the number is on the other
   view. A sheet over the drawing would put the fitting you are specifying and
   the plan you are specifying it against on two different screens.

   ...AND CLICKING A FITTING ON THE DRAWING IS THE OTHER WAY IN. A press on a
   lamp is a question — "what is this, and what is it doing to the room" — and
   the answer is a row in that list. With the list behind a button the answer was
   being given on a view nobody was looking at: the row opened itself and
   scrolled into place under a readout. So a `highlight` arriving swaps the
   window over on its own, and the button is for the times nothing is selected.

   AND IT SWAPS BOTH WAYS, WHICH IS THE WHOLE OF THE RULE: THE VIEW FOLLOWS THE
   SELECTION. A fitting selected is a question about that fitting, so the window
   is the list with that row picked out. NOTHING selected is a question about the
   SPACE — which is what clicking a room is, and what clicking an empty patch of
   its ceiling is — and the answer to that is the figures. So the readout is not
   a place you have to navigate back to; it is where the window sits whenever
   nothing smaller than the room is in hand.

   IT WAS ONE-WAY FOR A REVISION, on the reasoning that deselecting is not a
   request to be sent anywhere and a window that jumped back would be taking
   something away. That is the right instinct about a ROW — see SpaceAnalysis,
   which still never closes one it did not open — and wrong about the view: a
   list of every fitting in the room, with none of them selected, is not an
   answer to anything, and the link back was a step you had to take to get to
   the figures you had asked for by clicking the room.

   --- AND THE SETTINGS ARE OPEN RATHER THAN BEHIND A DONE BUTTON -----------
   THEY WERE A SUMMARY LINE UNDER A DOTTED RULE, and opening them replaced the
   analysis — two jobs, one column, one at a time. That trade was made when this
   was a 340px track holding four tabs and a footer. It is a window now: the
   height and the three finishes are four short rows, they fit above the readout
   without pushing it anywhere, and every one of them MOVES that readout. Setting
   a ceiling to dark and watching the achieved figure drop is the argument for
   both being on screen at once, and it is the argument this file's own header
   used to make for putting the finishes first.

   THE NAME IS EDITED IN PLACE, for the reason the plan's name in the top bar is:
   a space auto-named "Space 6" is a name nobody chose, and this is where anybody
   who cares about it is looking.
   --------------------------------------------------------------------------- */

/* ONE CARD IN THIS VIEW AND IT IS THE READOUT'S. The settings were in a card
   of their own for a while, which gave the window three nested grounds — its
   own, the settings', and the readout's — for two subjects. The settings sit on
   the window's ground now and the readout is the only thing lifted off it, which
   is the right emphasis: the four rows are what you set, and the card is what
   they come to. See Lumens for its ground. */
/* THE SETTINGS ROWS ARE TIGHTER THAN THE PANEL'S USUAL, and deliberately: they
   are two lines standing between the room's name and the thing the panel is for.
   `min-h` rather than padding, so a row is the height of the control in it
   rather than a pad around one. */
const ROW = 'flex items-center justify-between gap-2 min-h-[24px]';
const LBL = 'text-[11.5px] text-muted leading-[1.4]';
const VAL = 'text-[11.5px] text-text leading-[1.4] tabular-nums';

/* A `BTN_DONE` WAS HERE, in the white every other Done on this screen wears. It
   closed the finishes and put the analysis back, and there is nothing to close:
   the finishes and the analysis are both on screen now. */
const BTN_BACK = 'border-0 bg-none text-[11.5px] text-subtle cursor-pointer p-0 '
  + 'inline-flex items-center gap-[6px] transition-colors duration-[120ms] '
  + 'hover:text-white';
/* THE WAY ON, AS TYPE. Same weight as the back link above — they are the two
   ends of one trip — and no ground, because this window already has one card in
   it and does not need a second block competing with it. */
const BTN_GO = 'border-0 bg-transparent text-[11.5px] text-faint cursor-pointer '
  + 'px-1 py-[3px] -mr-1 rounded inline-flex items-center gap-[5px] '
  + 'transition-colors duration-[120ms] hover:text-white '
  + 'focus-visible:outline-2 focus-visible:outline-accent '
  + 'focus-visible:outline-offset-1';

/* A TONE CHIP. The same tile the property chips elsewhere in the panel wear —
   no ground at rest, the panel's own glass when it is the answer. */
const CHIP = 'px-[7px] py-[3px] font-sans text-[10px] rounded border cursor-pointer '
  + 'transition-colors duration-[120ms] disabled:opacity-[.45] '
  + 'disabled:cursor-not-allowed focus-visible:outline-2 '
  + 'focus-visible:outline-accent focus-visible:outline-offset-1';
const CHIP_OFF = `${CHIP} text-muted border-transparent enabled:hover:bg-white/5 `
  + 'enabled:hover:border-border/10';
const CHIP_ON = `${CHIP} text-text bg-white/5 border-border/10 backdrop-blur-md`;

function ToneRow({ label, value, onPick, disabled }) {
  return (
    <div className={`${ROW} mb-1.5`}>
      <span className={LBL}>{label}</span>
      <div className="flex gap-0.5 flex-none">
        {TONES.map((t) => (
          <button key={t} type="button" disabled={disabled}
            aria-pressed={value === t}
            className={value === t ? CHIP_ON : CHIP_OFF}
            onClick={() => onPick(t)}>{TONE_LABEL[t]}</button>
        ))}
      </div>
    </div>
  );
}

/** The height. A row and not a section: one number with one unit needs no
 *  heading over it — the field's label is the field. */
function HeightRow({ ceilingMm, onCeilingMm, disabled }) {
  /* THE FIELD HOLDS A DRAFT WHILE IT IS BEING TYPED IN, and that is not a
     nicety: the store clamps to a sane range, so a controlled input reading
     straight off it cannot be retyped. Select 2700, press 3, and the clamp turns
     it into 1500 before the second digit arrives. So the string somebody is
     typing lives here until they leave the field or press Enter. */
  const [draft, setDraft] = useState(null);
  return (
    <div className={ROW}>
      <label className={LBL} htmlFor="lp-ceiling-mm">Avg Ceiling Height</label>
      <span className="flex items-center gap-1.5 flex-none">
        <input id="lp-ceiling-mm" type="number" inputMode="numeric"
          disabled={disabled}
          min={CEILING_MM_MIN} max={CEILING_MM_MAX} step={50}
          value={draft ?? ceilingMm}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => { onCeilingMm(draft ?? ceilingMm); setDraft(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          /* SHORT AND SHALLOW: a fixed height rather than vertical padding, and
             the spinner suppressed. The arrows are twenty pixels of chrome on a
             field four digits wide, stepping a value nobody nudges — you type a
             ceiling height, you do not arrive at it. */
          className="w-[58px] h-[22px] text-right text-[11.5px] leading-none tabular-nums
            px-1.5 py-0 rounded border border-border/10 bg-input-bg text-text
            disabled:opacity-[.45] [appearance:textfield]
            [&::-webkit-outer-spin-button]:appearance-none
            [&::-webkit-inner-spin-button]:appearance-none
            focus-visible:outline-2 focus-visible:outline-accent
            focus-visible:outline-offset-1" />
        <span className="text-[10.5px] text-subtle">mm</span>
      </span>
    </div>
  );
}

export default function SpaceDetail({
  name, meta, ceilingMm, onCeilingMm, materials, wallLabel,
  onTone, onConfigureWalls, onAllWallsTone = null, wallTone = null,
  onRename = null,
  analysis, onWatts, onBeam = null, onToggleOff = null,
  highlight = [], autoplace = null, onAutoplace = null,
  disabled = false, vertical = false,
}) {
  /* WHICH OF THE TWO VIEWS, AND IT IS LOCAL. Whether somebody is looking at the
     figures or at the fittings is a fact about the next few seconds — it must
     not be saved, must not be undoable, and must not survive clicking a
     different room. Keyed by nothing, because the window is remounted per space
     (`key={openRoom.id}` at the call site), which is what makes "a different
     room opens on its readout" true without an effect to enforce it.

     ITS INITIAL VALUE IS THE SELECTION, not `false`, and that is the mount case
     rather than a nicety: clicking a fitting in a room that is not open selects
     the room AND the fitting, so this component mounts with a `highlight`
     already in hand. Starting closed and letting the effect below open it would
     paint the readout for one frame and then replace it. */
  const answer = (highlight ?? []).join('|');
  const [lights, setLights] = useState(!!answer);
  const [materialSurface, setMaterialSurface] = useState('ceiling');

  /* --- AND THE VIEW FOLLOWS THE SELECTION FROM THEN ON -------------------
     A FITTING SELECTED IS THE LIST; NOTHING SELECTED IS THE FIGURES. One line
     each way, which is what makes it a rule rather than two behaviours.

     IT FIRES ON THE SELECTION CHANGING AND NOT ON EVERY RENDER, which is the
     one thing to be careful of: the rows re-render on every keystroke of a
     wattage slider, and `setLights` with the value it already holds is a no-op
     React still has to reconcile. Seeded with the mount value, so the state set
     above is not immediately set again.

     THE BUTTON IS STILL WORTH HAVING. It is how you read the list with nothing
     selected — every fitting in the room at once, which is a different question
     from "what is this one" — and pressing it does not select anything, so this
     effect leaves it alone until the next press on the drawing. */
  const answered = useRef(answer);
  useEffect(() => {
    if (answer === answered.current) return;
    answered.current = answer;
    setLights(!!answer);
  }, [answer]);

  /* THE NAME BEING TYPED, OR NULL. Held as a draft for the reason the height
     field holds one: the stored name is normalised — an empty string falls back
     to the old one — so a controlled input reading straight off it could not be
     cleared to retype. */
  const [draft, setDraft] = useState(null);
  const commit = () => {
    const next = (draft ?? '').trim();
    if (next && next !== name) onRename?.(next);
    setDraft(null);
  };

  if (vertical) {
    const tone = materialSurface === 'walls'
      ? wallTone
      : materials[materialSurface];
    const pickTone = (next) => {
      if (materialSurface === 'walls') onAllWallsTone?.(next);
      else onTone(materialSurface, next);
    };

    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex-none">
          <div className="flex items-center gap-2 min-h-[24px] mb-1.5">
            {/* --- `w-auto flex-none` IS WHY THIS IS THE WIDTH OF ITS WORDS --
                EVERY `select` IN THIS APP IS `width:100%` — see the text-entry
                rule in styles.css, written for the login and the project forms,
                where a full-width field is right. This one is a three-word
                picker in a row that also holds a caption and three tone chips,
                and at 100% it took every pixel the chips did not: a 148px box
                around the word "Ceiling" at 10.5px.
                A `w-*` UTILITY IS THE INTENDED WAY OUT, which that rule says of
                itself — a utility outranks `@layer base` — and `w-auto` is a
                select's shrink-to-fit width: the widest option, its arrow and
                the padding, and nothing else. `flex-none` is the other half,
                because a flex item with a definite width can still be stretched
                or shrunk by the line it is in. */}
            <select aria-label="Material surface" value={materialSurface}
              disabled={disabled}
              onChange={(e) => setMaterialSurface(e.target.value)}
              className="h-[22px] w-auto flex-none rounded border border-border/15
                bg-white/[0.08] px-1.5 text-[10.5px] text-text focus-visible:outline-2
                focus-visible:outline-accent focus-visible:outline-offset-1">
              <option value="ceiling">Ceiling</option>
              <option value="walls">Walls</option>
              <option value="floor">Floor</option>
            </select>
            <span className={LBL}>material</span>
            <div className="ml-auto flex gap-0.5">
              {TONES.map((t) => (
                <button key={t} type="button" disabled={disabled}
                  aria-pressed={tone === t}
                  className={tone === t ? CHIP_ON : CHIP_OFF}
                  onClick={() => pickTone(t)}>{TONE_LABEL[t]}</button>
              ))}
            </div>
          </div>
          {materialSurface === 'walls' && wallTone == null && (
            <p className="m-0 mb-1.5 text-[10px] leading-[1.35] text-subtle">
              Mixed walls · choosing a tone applies it to every wall.
            </p>
          )}
        </div>
        <div className="min-h-0 flex-1">
          <Lumens analysis={analysis} compact />
        </div>
      </div>
    );
  }

  return (
    /* NO PADDING OF ITS OWN. The window's scroller already sets the gutters; a
       second set here would indent this view a further 16px from everything else
       the window shows. */
    <div className="flex flex-col">
      {/* --- WHICH SPACE, AND HOW BIG IT IS ------------------------------
          THE NAME AND THE MEASUREMENTS ON ONE LINE, because they are one
          subject: "Space 6, a 22 by 25 living room" is how anybody would say
          it. The name is the only thing here that can be changed, so it is the
          only thing that looks like a control.

          THERE IS NO WAY BACK, BECAUSE THERE IS NOWHERE TO GO BACK TO. It had a
          ← to the list of spaces, and the list is gone: the rooms are on the
          drawing, labelled, and clicking one is how you pick one. Clicking off
          it is how you close this — the same gesture, in the same place, on the
          thing itself.

          THE NAME WEARS ITS CHIP AT REST rather than only on hover. Hover is
          not an affordance on a control somebody has to know is there before
          they point at it, and this one is worth knowing: a space auto-named
          "Space 6" is a name nobody chose. */}
      <div className="flex items-baseline justify-between gap-2 mb-3">
        {draft == null ? (
          <span className="flex items-baseline gap-1.5 min-w-0">
            {onRename && !disabled ? (
              <button type="button" title="Rename this space"
                className="border-0 text-[14px] leading-[1.3] tracking-[-0.02em]
                  text-white cursor-text px-2 py-[3px] rounded-md min-w-0
                  overflow-hidden text-ellipsis whitespace-nowrap
                  bg-white/[0.08] transition-colors duration-[120ms]
                  hover:bg-white/[0.14]
                  focus-visible:outline-2 focus-visible:outline-accent
                  focus-visible:outline-offset-1"
                onClick={() => setDraft(name)}>{name}</button>
            ) : (
              <h2 className="m-0 text-[14px] leading-[1.3] tracking-[-0.02em] text-white
                px-2 py-[3px] rounded-md bg-white/[0.08] min-w-0
                overflow-hidden text-ellipsis whitespace-nowrap">{name}</h2>
            )}
          </span>
        ) : (
          <input className="text-[15px] leading-[1.3] tracking-[-0.02em] min-w-0 flex-1
            px-1.5 py-[2px] rounded bg-surface backdrop-blur-md text-white
            border border-border/20 focus:outline-none"
            autoFocus value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setDraft(null);
            }} />
        )}
        {meta && (
          <p className="m-0 flex-none text-[10.5px] text-subtle tabular-nums
            whitespace-nowrap">{meta}</p>
        )}
      </div>

      {lights ? (
        /* --- THE FITTINGS, AND THE WAY BACK IS THE FIRST THING -----------
            A view that replaced a readout has to say what it replaced before it
            says anything about itself. */
        <>
          <button type="button" className={`${BTN_BACK} self-start mb-3`}
            onClick={() => setLights(false)}>
            <span aria-hidden="true">←</span> Analysis
          </button>
          <SpaceAnalysis analysis={analysis} onWatts={onWatts} onBeam={onBeam}
            onToggleOff={onToggleOff}
            highlight={highlight} autoplace={autoplace} onAutoplace={onAutoplace}
            disabled={disabled} />
        </>
      ) : (
        <>
          {/* --- WHAT THIS SPACE IS, AND EVERY ROW OF IT MOVES THE READOUT ---
              THE HEIGHT FIRST, because it is a measurement rather than a
              choice: a room is 3000mm whatever anybody wants, and the three
              finishes under it are decisions. It is also the one that changes
              the arithmetic most — halve the height and the walls halve with
              it. See surfaceAreas in lib/lumens.js.
              THE WALLS ARE A READING AND NOT A CHOICE. There are four to a
              dozen of them and they are picked on the DRAWING, one at a time,
              because this window cannot say WHICH wall — see WallTonePopup.
              What sits here is what those choices came to, and the way in. */}
          <div>
            <HeightRow ceilingMm={ceilingMm} onCeilingMm={onCeilingMm}
              disabled={disabled} />
            <ToneRow label="Ceiling material" value={materials.ceiling}
              disabled={disabled} onPick={(t) => onTone('ceiling', t)} />
            <ToneRow label="Floor material" value={materials.floor}
              disabled={disabled} onPick={(t) => onTone('floor', t)} />
            <div className={`${ROW} mb-0`}>
              <span className={LBL}>Wall material</span>
              <span className="flex items-baseline gap-2 flex-none">
                <span className={VAL}>{wallLabel}</span>
                {/* THE DOTTED RULE IS THE AFFORDANCE, and `border-current` is
                    what keeps it the text's own colour rather than a second one
                    to keep in step. It costs no height, which is why this is a
                    link on the row rather than a button under it. */}
                <button type="button" disabled={disabled}
                  className="border-0 border-b border-dotted border-current
                    bg-transparent p-0 pb-px text-[10.5px] leading-[1.4] text-subtle
                    cursor-pointer transition-colors duration-[120ms]
                    enabled:hover:text-white disabled:cursor-not-allowed
                    focus-visible:outline-2 focus-visible:outline-accent
                    focus-visible:outline-offset-2"
                  title="Set the tone of each wall, on the drawing"
                  onClick={onConfigureWalls}>Modify walls</button>
              </span>
            </div>
          </div>

          {/* THE SECOND CARD READS THE FIRST. Every tone set above moves the
              figure below it — that is the whole reason the finishes come first
              and the reason both are on one screen rather than in two views. */}
          <div className="mt-2.5">
            <Lumens analysis={analysis} />
          </div>

          {/* --- AND THE FITTINGS THAT MADE THAT FIGURE ------------------
              A LINK AND NOT A BUTTON, RIGHT-ALIGNED UNDER THE CARD. A
              full-width outlined slab is the weight of a decision, and this is
              navigation: the readout above it is the loud thing in this window
              and a second block under it competed with it.
              THE ARROW SAYS IT GOES SOMEWHERE, which is the honest mark — this
              is not a disclosure that grows the window, it swaps what the
              window is showing. */}
          <button type="button" className={`${BTN_GO} self-end mt-2.5`}
            onClick={() => setLights(true)}>
            Show all lights <span aria-hidden="true">→</span>
          </button>
        </>
      )}
    </div>
  );
}
