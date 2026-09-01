import React from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles.css';
import LightPalette from '../src/components/LightPalette.jsx';

const Panel = ({ tool, label }) => (
  <div style={{ width: 340, padding: '14px 20px', boxSizing: 'border-box' }}>
    <p style={{ font: '11px ui-monospace,monospace', color: '#999', margin: '0 0 6px' }}>{label}</p>
    <LightPalette tool={tool} onPick={() => {}} />
  </div>
);

createRoot(document.getElementById('root')).render(
  <div style={{ display: 'flex', alignItems: 'flex-start', background: '#fff' }}>
    <Panel tool="spot" label="spot armed — the new card" />
    <Panel tool="sconce" label="sconce armed — unchanged" />
    <Panel tool={null} label="nothing armed" />
  </div>
);
