// ---------------------------------------------------------------------------
// profiles.js — HOW EACH FAMILY OF FITTING ACTUALLY EMITS. ONE TABLE.
//
// THIS IS THE EXTENSION POINT AND IT IS THE ONLY ONE. A new fitting joins the
// heatmap by naming a SOURCE SHAPE and a set of LOBES here; it does not get an
// algorithm. The solver reads nothing but `shape`, `mount` and `lobes`, so a
// family added to this table is lit by the same code every existing one is.
//
// WHAT A PROFILE SAYS, AND WHY EACH FIELD IS SEPARATE:
//
//   shape    WHERE THE LIGHT COMES FROM AS A PIECE OF GEOMETRY — a point, a
//            line, a rectangle, or a ring of elements. It decides how the
//            source is SAMPLED, and sampling is the one thing that must not
//            change the answer: a line's lumens are divided among its samples
//            (see `expandSource` in photometry.js), so cutting it into twice as
//            many pieces makes each piece half as bright and the room exactly
//            as bright. Nothing here is a coverage radius.
//
//   mount    HOW HIGH IT IS AND WHAT IT IS FIXED TO. The app records ceiling
//            heights per space and records no fixture heights at all, so every
//            figure below is a DOCUMENTED FAMILY DEFAULT — stated here, in one
//            place, rather than assumed in the solver. `ceiling` means at the
//            slab; `pendant`, `wall` and `standing` carry their own figure.
//
//   lobes    WHERE THE LIGHT GOES. A list, because most real fittings throw in
//            more than one direction and a single vector cannot say so: a
//            sconce throws up AND down AND along the wall, and a reverse cove
//            washes a wall AND spills past the lip. Each lobe takes a `share`
//            of the source's lumens and the shares sum to 1 — a family claiming
//            less than all of its own output is a family losing light nowhere.
//
//   loss     WHAT THE INSTALLATION EATS THAT lib/lumens.js HAS NOT ALREADY
//            TAKEN. Almost always 0, and that is deliberate: `unitOutput` there
//            already applies each family's own `loss` (20% on everything made of
//            tape — see STRIP_LOSS), and this feature is handed the figure AFTER
//            it. A second deduction of the same fifth would be the pocket eating
//            the run twice.
//
// WHAT IS NOT HERE, ON PURPOSE:
//
//   THE SPLITS FROM lumens.js ARE NOT COPIED IN. `FIXTURE_FAMILIES[i].split` is
//   a three-way ceiling/walls/floor share, and it is an accounting bucket rather
//   than a distribution: it says a cove gives 80% of its light to the ceiling
//   without saying WHICH ceiling, which is the whole question a heatmap asks.
//   The splits were used as the STARTING ASSUMPTION for the lobe shares below —
//   a cove's `up` lobe, a reverse cove's 0.8/0.2, a lamp's 0.25/0.5/0.25 — and
//   then given directions, which the splits do not have. They are read for their
//   argument, not imported for their arithmetic.
//
//   `bounceOf` IS NEVER APPLIED. That coefficient is the lumen model's stand-in
//   for the reflections this feature computes explicitly, patch by patch. Using
//   both would count the same bounced light twice. See reflection.js.
//
// PURE. No React, no canvas, no document. Angles in degrees here because that is
// how a human writes one down; the solver converts once.
// ---------------------------------------------------------------------------

/** Floor-to-slab, in millimetres, when a space has not been asked. The same
 *  figure lib/materials.js uses, imported rather than repeated. */
export { DEFAULT_CEILING_MM } from '../../lib/materials.js';

/* --- THE MOUNTING HEIGHTS NOTHING IN THE APP RECORDS -----------------------
   EVERY ONE OF THESE IS A DEFAULT AND IS MEANT TO BE EDITED. The data model
   holds a ceiling height per space (`ceilingMm`) and holds no height for any
   fitting, so a heatmap has to assume one for anything that is not at the slab.
   They are named constants rather than literals in the table so that the day a
   fitting carries its own height, the table's `mount` is what changes and these
   become the fallback. */

/** How far a concealed cove strip sits below the slab it throws at. A pocket
 *  detail is built with the tape on the shelf and the slab a hand's width above
 *  it; 150 mm is the ordinary figure and it is what puts the hot patch of a
 *  cove immediately over the run rather than spread across the ceiling. */
export const COVE_POCKET_DROP_MM = 150;

/** A reverse cove's tape sits at the lip of an 8-inch slot in the ceiling — see
 *  REVERSE_COVE.widthIn in lib/reverseCove.js — so it is effectively AT the
 *  slab. 40 mm is the depth of the shadow gap in front of it. */
export const REVERSE_COVE_DROP_MM = 40;

/** How far below the slab a pendant or chandelier hangs. 600 mm over a 2700
 *  ceiling puts it at 2100, which is where one is hung over a table. */
export const PENDANT_DROP_MM = 600;

/** A wall sconce's centre above the floor. 1800 is eye height and the figure a
 *  bedside or corridor sconce is set out at. */
export const SCONCE_MM = 1800;

/** A floor or table lamp's light centre above the floor. 1500 splits the
 *  difference between a table lamp on a side table and a standard lamp. */
export const LAMP_MM = 1500;

/** A shelf strip's tape above the floor. It is inside joinery — see
 *  lib/shelfStrip.js — and 1200 is the middle shelf of a run of shelving. */
export const SHELF_STRIP_MM = 1200;

/** Where an art spot is aimed on the wall it faces, above the floor. A picture
 *  is hung with its centre at about this height, and the spot's aim is what
 *  decides which wall patches take its beam. */
export const ART_AIM_MM = 1500;

/* --- THE LOBE VOCABULARY ---------------------------------------------------
   `dir` NAMES A DIRECTION THE SOLVER CAN RESOLVE FROM THE FITTING'S OWN
   GEOMETRY, and there are only five of them:

     'down'     straight at the floor
     'up'       straight at the slab
     'aim'      the fitting's own aim vector, in three dimensions — a
                directional spot's arrow. Falls back to 'down' where a fitting
                of an aimed family has not been aimed.
     'inward'   the horizontal normal of the wall it is on, pointing INTO the
                room, tilted by `elevDeg`
     'outward'  the same normal pointing AT the wall, tilted by `elevDeg`

   `elevDeg` IS ELEVATION FROM HORIZONTAL and applies to the two wall
   directions only: +90 is straight up, -90 straight down, 0 level. It is what
   lets one vocabulary describe a sconce throwing up the wall and a reverse cove
   washing down it.

   `kind` IS THE ANGULAR SHAPE:
     'beam'     a cosine power derived from the fitting's own beam angle, so
                that intensity falls to half at half the beam angle. SMOOTH: it
                has no edge, which is the point — a real optic does not stop at
                the rim of its nominal cone, and drawing a hard disc was the
                thing to avoid.
     'cosine'   a cosine power stated here. `power: 1` is Lambertian, which is
                what a diffusing face does.
     'uniform'  equal in every direction, for a bare lamp with no optic.

   `clip: 'inward'` FORBIDS EMISSION THROUGH THE WALL. A wall-mounted fitting's
   lobes are shaped about the wall's normal and a broad one would otherwise put
   light into the room next door; this is the half-space test that stops it, and
   it is stated per lobe rather than assumed per mount so that a fitting standing
   OFF a wall can still be broad. */

/**
 * THE REGISTRY. Keyed by PROFILE id, which is not always a family id.
 *
 * WHY NOT KEY IT BY FAMILY. Two fittings in this app share a family and do not
 * share a distribution. A chandelier is counted as `lamp` in lib/lumens.js —
 * see `fixtureGroups`, which routes it there because a pendant is the one thing
 * in that family's split that throws in every direction — and it hangs from a
 * ceiling where a floor lamp stands on the floor. An art spot and a task spot
 * are both `cob` and are aimed at a wall and at the floor respectively. So the
 * table is keyed by what a thing IS, and PROFILE_FOR_FAMILY below says which
 * profile a family takes when the caller knows nothing more specific.
 */
export const DISTRIBUTION_PROFILES = {
  /* --- DIRECT: THE AIMED AND THE DOWNWARD -------------------------------- */

  /** A recessed COB or downlight. Its beam angle is the whole of its optic. */
  cob: {
    id: 'cob', label: 'Recessed downlight', shape: 'point', mount: 'ceiling',
    lobes: [{ share: 1, dir: 'down', kind: 'beam' }],
    /** What to use when the fitting states no beam. 36° is the ambient grid's
     *  own lamp — see FIXTURES in lib/boq.js. */
    defaultBeam: 36, loss: 0,
  },

  /** A track head. Same lamp, same cone, clipped to a busbar rather than cut
   *  into plasterboard — which is a fact about fixing and not about light, so
   *  the lobes are the COB's. Aimed where it has been aimed. */
  track_spot: {
    id: 'track_spot', label: 'Track spot', shape: 'point', mount: 'ceiling',
    lobes: [{ share: 1, dir: 'aim', kind: 'beam' }],
    defaultBeam: 30, loss: 0,
  },

  /** A directional spot aimed at a work surface. The COB's cone, pointed at the
   *  aim point the placer already worked out. */
  spot: {
    id: 'spot', label: 'Directional spot', shape: 'point', mount: 'ceiling',
    lobes: [{ share: 1, dir: 'aim', kind: 'beam' }],
    defaultBeam: 30, loss: 0,
  },

  /** A spot aimed at a picture. The same fitting with a tighter optic and an aim
   *  point on a WALL rather than on the floor — see ART_AIM_MM. Its own profile
   *  because the aim height is part of the specification. */
  art_spot: {
    id: 'art_spot', label: 'Art spot', shape: 'point', mount: 'ceiling',
    lobes: [{ share: 1, dir: 'aim', kind: 'beam' }],
    defaultBeam: 24, loss: 0, aimHeightMm: ART_AIM_MM,
  },

  /** A recessed flat panel. A rectangular EMITTING SURFACE, sampled across its
   *  area rather than collapsed to a point, and Lambertian because that is what
   *  a diffusing face does. */
  panel: {
    id: 'panel', label: 'Diffuser / panel', shape: 'area', mount: 'ceiling',
    lobes: [{ share: 1, dir: 'down', kind: 'cosine', power: 1 }],
    /** The ordinary 600 x 600 tile, in millimetres, where nothing states a
     *  size. Sampled 3 x 3 across it — see AREA_SAMPLES. */
    sizeMm: [600, 600], loss: 0,
  },

  /** A magnetic-track diffuser. A narrow rectangle lying ALONG the run, so it
   *  is a line source at the run's own position, length and orientation — the
   *  body length comes off the module's wattage (see `moduleLenIn`). Lambertian,
   *  for the panel's reason: the light leaves a face fixed flat to the ceiling. */
  track_diffuser: {
    id: 'track_diffuser', label: 'Track diffuser', shape: 'line', mount: 'ceiling',
    lobes: [{ share: 1, dir: 'down', kind: 'cosine', power: 1 }],
    loss: 0,
  },

  /** An exposed strip on the slab. A distributed line source with a broad
   *  emission profile, following the run as drawn. Nothing goes up, because the
   *  face it leaves is already the ceiling. */
  ceiling_strip: {
    id: 'ceiling_strip', label: 'Ceiling LED strip', shape: 'line', mount: 'ceiling',
    lobes: [{ share: 1, dir: 'down', kind: 'cosine', power: 1 }],
    loss: 0,
  },

  /** A floor or table lamp. Up, down and sideways, and the three shares are the
   *  `lamp` family's own split read as directions: a quarter at the ceiling, a
   *  quarter at the floor, half out through the shade. Only the downward and
   *  sideways light reaches the plane directly; the upward share arrives through
   *  the ceiling, which the reflection engine handles like any other. */
  floor_lamp: {
    id: 'floor_lamp', label: 'Floor / table lamp', shape: 'point',
    mount: 'standing', heightMm: LAMP_MM,
    lobes: [
      { share: 0.25, dir: 'up', kind: 'cosine', power: 1 },
      { share: 0.25, dir: 'down', kind: 'cosine', power: 1 },
      { share: 0.5, dir: 'omni', kind: 'uniform' },
    ],
    loss: 0,
  },

  /** A chandelier or pendant. SEVERAL EMITTING ELEMENTS where their positions
   *  are known, and they are not: the app records a chandelier as one ceiling
   *  object with a diameter (see CEILING_TYPES in lib/ceilingObjects.js). So
   *  this is the documented broad-source approximation — a ring of `elements`
   *  bare lamps at the object's own radius, hung PENDANT_DROP_MM below the slab,
   *  each isotropic and each carrying its share of the output. It is a ring
   *  rather than a point because a metre-wide fitting collapsed to its centre
   *  reads as a spotlight on the drawing. */
  chandelier: {
    id: 'chandelier', label: 'Chandelier / pendant', shape: 'ring',
    mount: 'pendant', dropMm: PENDANT_DROP_MM,
    lobes: [{ share: 1, dir: 'omni', kind: 'uniform' }],
    elements: 6, loss: 0,
  },

  /** A wall sconce. Up, down and diffusely along the wall — the shares are the
   *  `sconce` family's borrowed split, given the three directions it implies —
   *  and every lobe is clipped to the room side of the wall it is fixed to, so
   *  no sconce lights the room behind it. */
  sconce: {
    id: 'sconce', label: 'Wall sconce', shape: 'point',
    mount: 'wall', heightMm: SCONCE_MM,
    lobes: [
      { share: 0.3, dir: 'inward', elevDeg: 70, kind: 'cosine', power: 1.5, clip: 'inward' },
      { share: 0.3, dir: 'inward', elevDeg: -70, kind: 'cosine', power: 1.5, clip: 'inward' },
      { share: 0.4, dir: 'inward', elevDeg: 0, kind: 'uniform', clip: 'inward' },
    ],
    loss: 0,
  },

  /* --- COVES AND THE REST OF THE CONCEALED WORK -------------------------- */

  /**
   * A COVE — CONCEALED TAPE THROWING AT THE SLAB.
   *
   * NO DIRECT CONTRIBUTION TO THE MEASUREMENT PLANE, and it needs no flag to
   * say so: a Lambertian lobe about `up` has zero intensity at and below the
   * horizon, so the geometry refuses the floor on its own. What the run does is
   * light the ceiling and the top of the walls near it — brightest immediately
   * over the tape, because it sits COVE_POCKET_DROP_MM under the slab — and
   * those patches then reflect into the room. That is the whole of a cove.
   *
   * THE LIP IS WHY THE POWER IS ABOVE 1. A pocket is a shelf with a return on
   * it, so the very low angles that would skim out over the room are the ones
   * the return takes; 1.6 tightens the lobe towards the slab by about that much
   * without pretending the detail is a reflector.
   */
  cove: {
    id: 'cove', label: 'Cove (concealed uplight)', shape: 'line',
    mount: 'ceiling', dropMm: COVE_POCKET_DROP_MM, concealed: true,
    lobes: [{ share: 1, dir: 'up', kind: 'cosine', power: 1.6 }],
    loss: 0,
  },

  /**
   * A REVERSE COVE — TAPE AT THE LIP OF A SLOT, WASHING THE WALL BESIDE IT.
   *
   * NOT ENTIRELY INDIRECT, WHICH IS THE POINT OF THE SECOND LOBE. The wash is
   * four fifths of it and arrives at the plane only after the wall has handed it
   * back; the remaining fifth goes straight down out of the slot and lands on
   * the floor within a foot or two of the wall. Both are what the family's own
   * split says — walls 0.8, floor 0.2 — given the directions the split has not
   * got.
   *
   * -60 DEGREES IS THE WASH. Level would put the whole run on the opposite wall
   * and straight down would make it a downlight; sixty below horizontal, aimed
   * at the wall, is a slot grazing the surface it is built to show.
   */
  reverse_cove: {
    id: 'reverse_cove', label: 'Reverse cove (wall wash)', shape: 'line',
    mount: 'ceiling', dropMm: REVERSE_COVE_DROP_MM,
    lobes: [
      { share: 0.8, dir: 'outward', elevDeg: -60, kind: 'cosine', power: 2 },
      { share: 0.2, dir: 'down', kind: 'cosine', power: 1 },
    ],
    loss: 0,
  },

  /**
   * A SHELF STRIP — tape inside joinery standing against a wall.
   *
   * THE REVERSE COVE'S DISTRIBUTION FROM LOWER DOWN, which is exactly what
   * lib/lumens.js says of it: `shelf_strip` borrows `reverse_cove`'s split. The
   * two differences are the height (it is in a bookcase, not the ceiling) and
   * the angle — a shelf strip is under a shelf and throws down the face of the
   * unit rather than grazing a wall from above.
   */
  shelf_strip: {
    id: 'shelf_strip', label: 'Shelf LED strip', shape: 'line',
    mount: 'wall', heightMm: SHELF_STRIP_MM,
    lobes: [
      { share: 0.8, dir: 'outward', elevDeg: -45, kind: 'cosine', power: 2 },
      { share: 0.2, dir: 'inward', elevDeg: -30, kind: 'cosine', power: 1, clip: 'inward' },
    ],
    loss: 0,
  },

  /**
   * THE WALL WASHER THIS BUILD DOES NOT HAVE YET.
   *
   * IN THE TABLE AND CONTRIBUTING NOTHING, and both halves are deliberate. The
   * track's washer module carries `family: null` in lib/magTrack.js — its output
   * has never been specified, and inventing one here is how a number nobody
   * chose ends up on a report — so no emitter is ever built for it and the
   * heatmap is silent about it. The PROFILE is written because that is the thing
   * this table is for: the day the product is specified, it has a distribution
   * already, and nothing else has to change.
   *
   * ASYMMETRIC AND AIMED AT THE WALL, with the unobstructed spill as its own
   * lobe: light landing on the wall is calculated first and comes back through
   * the reflection engine, and what misses the wall carries on to the floor.
   */
  wall_washer: {
    id: 'wall_washer', label: 'Wall washer', shape: 'line', mount: 'ceiling',
    lobes: [
      { share: 0.85, dir: 'outward', elevDeg: -35, kind: 'cosine', power: 3 },
      { share: 0.15, dir: 'down', kind: 'cosine', power: 1 },
    ],
    loss: 0, unspecified: true,
  },
};

/**
 * WHICH PROFILE A FAMILY TAKES WHEN NOTHING MORE IS KNOWN.
 *
 * EVERY ID IN `FIXTURE_FAMILIES` IS HERE — see lib/lumens.js — so a fitting
 * counted by the lumen model always has a distribution, and a family added there
 * without one shows up as a missing key rather than as light that quietly went
 * nowhere. `PROFILE_IDS_BY_FAMILY` is checked against that table by
 * tools/test-heatmap.mjs.
 *
 * `lamp` MAPS TO THE FLOOR LAMP AND NOT TO THE CHANDELIER, though a chandelier
 * is the only thing this app currently routes into that family. The family is
 * called "Floor / table lamp" and that is what its split describes; the adapter
 * names `chandelier` explicitly for a ceiling object, which is the case where
 * more IS known. See emitters.js.
 */
export const PROFILE_FOR_FAMILY = {
  cove: 'cove',
  reverse_cove: 'reverse_cove',
  ceiling_strip: 'ceiling_strip',
  panel: 'panel',
  track_diffuser: 'track_diffuser',
  cob: 'cob',
  track_spot: 'track_spot',
  lamp: 'floor_lamp',
  sconce: 'sconce',
  shelf_strip: 'shelf_strip',
};

/** A profile by id, or null. Null is a fitting this table has never heard of,
 *  and the solver drops it rather than lighting it as a bare point — see the
 *  brief's rule against modelling everything non-COB as an omnidirectional
 *  point source. */
export const profileFor = (id) => DISTRIBUTION_PROFILES[id] ?? null;

/** ...and by family, for a caller that knows only what the lumen model knows. */
export const profileForFamily = (familyId) =>
  profileFor(PROFILE_FOR_FAMILY[familyId]);

/* --- HOW FINELY A DISTRIBUTED SOURCE IS CUT UP ----------------------------
   THESE CHANGE THE COST AND NOT THE ANSWER, which is the property the whole
   design turns on: a source's lumens are divided among its samples, so more
   samples make each one dimmer in exact proportion. See `expandSource`.

   `LINE_SEGMENT_M` is a target length rather than a count, so a 1 m strip and a
   12 m cove are cut at the same resolution instead of the long one being coarse.
   0.3 m is about a foot, which is finer than any patch the reflection engine
   uses and therefore finer than anything the answer can resolve. */
export const LINE_SEGMENT_M = 0.3;
/** ...with a floor and a ceiling on the count, so a hairline run is not cut into
 *  nothing and a forty-metre one does not cost four hundred samples for a figure
 *  that stopped moving at forty. */
export const LINE_SEGMENTS_MIN = 2;
export const LINE_SEGMENTS_MAX = 60;
/** A rectangular emitter is sampled on this grid across its face. 3 x 3 is
 *  enough for a 600 tile seen from 2 m — the difference between it and 5 x 5 is
 *  under a percent at the plane — and it is nine samples rather than
 *  twenty-five. */
export const AREA_SAMPLES = 3;
