import os from 'node:os';
import path from 'node:path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
const vite = await createServer({
  server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent',
  cacheDir: path.join(os.tmpdir(), 'sl-render-test-cache'),
  optimizeDeps: { noDiscovery: true, include: [] },
});
const { default: PlanCanvas } = await vite.ssrLoadModule('/src/components/PlanCanvas.jsx');
console.log('PlanCanvas:', typeof PlanCanvas);
const html = renderToStaticMarkup(React.createElement(PlanCanvas, {
  width: 1000, height: 800, pxPerFt: 40, zoom: 1, plans: [],
  layers: { lights: true, labels: false }, toPx: (p) => p,
}));
console.log('rendered', html.length, 'chars;', html.slice(0, 60));
await vite.close();
