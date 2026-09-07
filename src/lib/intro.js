/* --- SWITCHING THE OPTIONS CARD OFF, PER PLAN ------------------------------
   THE PILL OPENS ON EVERY LANDING; THE CARD OVER IT IS THE PART THAT CAN BE
   SILENCED, and it is silenced for ONE PLAN rather than for the person. A plan
   is a job somebody comes back to a dozen times — every landing on it would
   otherwise re-explain a control they have been using all afternoon — while the
   next plan is a fresh set of rooms and may well be somebody else's first look
   at the app on this machine.

   IN THE BROWSER AND NOT IN THE SAVED STATE, WHICH IS THE ONE DECISION HERE
   WORTH ARGUING. `editorState` is the undo stack's basis — see the note on the
   memo — so a tutorial flag living in it would make ticking a checkbox an
   undoable step, and, worse, an undo of something real would resurrect the card.
   It is a preference about being told things, not a fact about the drawing.

   ONE KEY HOLDING A LIST, CAPPED. A key per plan would grow without limit in a
   store nothing ever prunes; a list keeps the whole preference in one entry, and
   the cap means the oldest plans quietly start explaining themselves again
   rather than the entry growing forever. Losing the tail is the cheapest thing
   in this file to lose.

   A READ THAT THROWS SHOWS THE CARD. Private mode and blocked storage cannot
   remember a tick, so the choice is between a card that has to be dismissed once
   per landing and a control that is never explained — and here the dismissal is
   a single click on the card itself, so the nag is cheap and the silence is not
   worth faking. */
const COACH_LS = 'lightPlanner.optionsCoach.v1';
const COACH_CAP = 200;
const coachList = () => {
  try { const l = JSON.parse(localStorage.getItem(COACH_LS) || '[]'); return Array.isArray(l) ? l : []; }
  catch { return []; }
};
const coachOff = (planId) => !!planId && coachList().includes(planId);
const silenceCoach = (planId) => {
  if (!planId) return;
  // MOVED TO THE END RATHER THAN APPENDED BLINDLY, so re-ticking a plan that is
  // already in the list refreshes its place instead of adding a duplicate that
  // pushes something else off the front.
  const kept = coachList().filter((x) => x !== planId);
  try { localStorage.setItem(COACH_LS, JSON.stringify([...kept, planId].slice(-COACH_CAP))); }
  catch { /* private mode */ }
};

/**
 * WHICH SPACE INTRODUCES THE DESIGN SCREEN.
 *
 * THE ROOM PEOPLE CAME FOR, PER PROJECT TYPE. The point of the pill is that a
 * ceiling has alternatives, and the room where that lands hardest is the one the
 * project is actually about — the living room in a flat, the lobby in a hotel,
 * the dining area in a restaurant. Opening on a toilet would be technically
 * correct (it has a pill) and would teach the feature at its least interesting.
 *
 * ONLY CHUNKS WITH SOMETHING TO FLIP TO. A chunk with one option draws no
 * arrows, so a card pointing at them would point at nothing — this is the same
 * `many` test the pill itself uses, applied one step earlier to the choice of
 * where to park. Note this can pick a room's SECOND-biggest chunk, where
 * `optionPickFor` always takes the biggest: there the question is "which piece
 * of ceiling is this room", here it is "which piece of ceiling has a choice in
 * it", and they are not the same question.
 *
 * THEN THE BIGGEST OF THOSE, and area is the tie-break rather than the ranking,
 * so a large toilet never outranks a small living room.
 */
const INTRO_TYPES = {
  residential: ['living_space', 'bedroom'],
  office: ['conference_room', 'reception', 'office_chamber'],
  hotel: ['lobby', 'banquet', 'suite'],
  restaurant: ['dining_area', 'private_dining', 'bar'],
  educational: ['library', 'canteen', 'lecture_hall'],
};

function introSpace(rooms, roomTypes, projectId) {
  const pref = INTRO_TYPES[projectId] ?? [];
  let best = null;
  for (const r of rooms) {
    const many = (r.designChunksPx ?? []).filter((d) => (d.options?.length ?? 0) > 1);
    if (!many.length) continue;
    const chunk = many.reduce((m, d) => (d.wFt * d.hFt > m.wFt * m.hFt ? d : m));
    const at = pref.indexOf(roomTypes[r.id]?.type ?? '');
    const rank = at < 0 ? pref.length : at;
    const area = chunk.wFt * chunk.hFt;
    if (!best || rank < best.rank || (rank === best.rank && area > best.area)) {
      best = { roomId: r.id, key: chunk.key, rank, area };
    }
  }
  return best;
}

export {
  COACH_LS, COACH_CAP, coachList, coachOff, silenceCoach, INTRO_TYPES, introSpace,
};
