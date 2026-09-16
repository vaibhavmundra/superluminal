import { SceneSwitch } from '../../components/StageBar.jsx';

// ---------------------------------------------------------------------------
// HeatmapSwitch — the capsule in the bar at the foot of the drawing.
//
// IT IS `SceneSwitch` AND NOTHING ELSE, which is the whole of the design. It is
// the bar's LEAD — the slot for what the DRAWING SHOWS rather than what the next
// press does — and it is the only switch in it: the Suggested Grid stood here
// once and has gone to the View menu, so the two standing ends of the bar are
// now this and the wiring. Both take one shape on purpose: a compact capsule
// whose knob shows its state. Wrapping it here rather than calling `SceneSwitch`
// from App keeps the feature's UI inside the feature, and keeps App's addition
// to one element.
//
// NO TITLE AND NO CAPTION. A control is its label — the wiring switch at the far
// end carries a `title` because it is doing something a word cannot say (it is a
// master over two layers), and "Heatmap" needs no gloss. What the colours mean is
// the legend's job, and the legend is on screen whenever this is on.
// ---------------------------------------------------------------------------

export default function HeatmapSwitch({ on = false, onClick }) {
  return <SceneSwitch label="Heatmap" on={on} onClick={onClick} />;
}
