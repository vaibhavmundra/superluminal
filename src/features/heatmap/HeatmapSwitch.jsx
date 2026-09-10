import { SceneSwitch } from '../../components/StageBar.jsx';

// ---------------------------------------------------------------------------
// HeatmapSwitch — the capsule in the bar at the foot of the drawing.
//
// IT IS `SceneSwitch` AND NOTHING ELSE, which is the whole of the design. The
// bar's left-hand slot holds the switches that say what the DRAWING SHOWS rather
// than what the next press does — the Suggested Grid is the other one — and they
// take one shape on purpose: a capsule with ON or OFF written in its own track.
// Wrapping it here rather than calling `SceneSwitch` from App keeps the feature's
// UI inside the feature, and keeps App's addition to one element.
//
// NO TITLE AND NO CAPTION. A control is its label — the two switches beside it
// carry a `title` because each is doing something a word cannot say ("draw the
// planner's answer as dotted suggestions"), and "Heatmap" needs no gloss. What
// the colours mean is the legend's job, and the legend is on screen whenever
// this is on.
// ---------------------------------------------------------------------------

export default function HeatmapSwitch({ on = false, onClick }) {
  return <SceneSwitch label="Heatmap" on={on} onClick={onClick} />;
}
