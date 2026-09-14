import React, { useEffect, useState } from 'react';
import App from '../App.jsx';

const restore = {
  v: 9,
  projectType: 'residential',
  outlines: [{ id: 'preview-room', name: 'Living room', rectify: false,
    detected: true, reviewed: true,
    pointsDu: [{ x: 125, y: 155 }, { x: 915, y: 155 },
      { x: 915, y: 1450 }, { x: 125, y: 1450 }] }],
  litIds: ['preview-room'], focusId: 'preview-room', dirtyIds: [],
  segmentation: { count: 1 }, roomTypes: { 'preview-room': { type: 'living' } },
  scale: { mode: 'ref', customFt: 10,
    measure: { a: { x: 125, y: 155 }, b: { x: 525, y: 155 } } },
  doors: [], doorsOk: true, ceilingMm: {}, materials: {}, fixtureWatts: {},
  ui: { layers: { invert: true, lights: true, autoLights: true }, zoom: .32, view: 'spaces' },
};

export default function VerticalPreview() {
  const [file, setFile] = useState(null);
  useEffect(() => {
    fetch('/samples/FLOOR_PLAN_03.png').then((r) => r.blob()).then((blob) =>
      setFile(new File([blob], 'FLOOR_PLAN_03.png', { type: blob.type })));
  }, []);
  return file ? <App initialFile={file} initialProjectType="residential"
    restore={restore} planName="Apartment in Lodha NCP" isAdmin /> : null;
}
