import { useMemo } from 'react';
import { projectOutlinesPx } from '../../lib/planProjection.js';
import { buildWallLayerSet, buildLitOutlines, enclosedZones } from './roomGeometry.js';

// Wall classification is needed before recognition; outlines before layout.
export function useSceneArchitecture({ isVector, source }) {
  const wallLayerSet = useMemo(() => buildWallLayerSet({ isVector, source }), [isVector, source]);
  return { architecture: { wallLayerSet } };
}

export function useSceneOutlines({ source, outlines, litIds }) {
  const outlinesPx = useMemo(() => projectOutlinesPx(source, outlines), [source, outlines]);
  const litOutlines = useMemo(() => buildLitOutlines({ outlinesPx, litIds }), [outlinesPx, litIds]);
  return { rooms: { outlinesPx, litOutlines, enclosedZones } };
}
