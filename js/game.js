// ============================================================
// game.js — Sandbox protein builder entry point
// ============================================================

import { startLoop } from './engine.js';
import { GameEvents, App } from './ui.js';

// 3D modules
import { updateControls, render3D, resize3D, updateParticles, controls } from './renderer3d.js';
import { createGrid } from './grid3d.js';
import { updateStructures3D } from './structures3d.js';
import { initInput, updateInput } from './input.js';
import { getChain, clearChain, placeAminoAcid, placeSceneAminoAcid, getSequence, getChainLength, orientChainToCenter, orientSceneToCenter, computeScenePlacements, getStructureLateralRadius } from './chain.js';
import { syncWaters, updateWaters3D } from './water3d.js';
import { SCENES } from './scenes.js';
import { cellToWorld } from './grid3d.js';
import { FULL, STRUCT_SCALE } from './structures.js';
import { SCALE } from './renderer3d.js';

// --- Dev: post game state to server ---
function postGameState() {
  const chain = getChain();
  const S = STRUCT_SCALE * SCALE;
  const entries = chain.map((e, i) => {
    const worldPos = cellToWorld(e.col, e.row);
    const atoms = FULL[e.letter].atoms;
    // Compute world-space bounding box of the structure
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const a of atoms) {
      const lx = a.x * S, ly = a.y * S, lz = (a.z || 0) * S;
      if (lx < minX) minX = lx; if (lx > maxX) maxX = lx;
      if (ly < minY) minY = ly; if (ly > maxY) maxY = ly;
      if (lz < minZ) minZ = lz; if (lz > maxZ) maxZ = lz;
    }
    return {
      index: i,
      letter: e.letter,
      col: e.col,
      row: e.row,
      refKey: e.refKey,
      worldCenter: { x: worldPos.x, y: 0.3, z: worldPos.z },
      groupRotationY: e.group.rotation.y,
      lateralRadius: getStructureLateralRadius(e.letter),
      localBounds: {
        min: { x: minX, y: minY, z: minZ },
        max: { x: maxX, y: maxY, z: maxZ },
      },
      structSize: {
        width: maxX - minX,
        height: maxY - minY,
        depth: maxZ - minZ,
      },
    };
  });

  const state = {
    timestamp: Date.now(),
    chainLength: chain.length,
    sequence: getSequence(),
    entries,
  };

  fetch('/api/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state),
  }).catch(() => {}); // silent fail if server doesn't support it
}


// Expose for automation (puppeteer capture)
window.__gameEvents = GameEvents;
window.__orbitControls = controls;

// --- React mount ---
const uiRoot = document.getElementById('ui-root');
ReactDOM.createRoot(uiRoot).render(React.createElement(App));

// --- Handle game start ---
GameEvents.on('gameStart', () => {
  createGrid();
  initInput();
  startLoop(update, render);
});

// --- Sync waters when chain changes ---
GameEvents.on('chainChanged', () => {
  syncWaters(getChain());
  postGameState();
});

// --- Clear the scene ---
GameEvents.on('clearScene', () => {
  clearChain();
  syncWaters(getChain());
  GameEvents.emit('chainChanged', {
    sequence: getSequence(),
    length: getChainLength(),
  });
});

// --- Load a preset scene ---
GameEvents.on('loadScene', (data) => {
  const scene = SCENES.find(s => s.id === data.id);
  if (!scene) return;

  clearChain();
  syncWaters(getChain());

  const placements = computeScenePlacements(scene.layout);
  for (const p of placements) {
    placeSceneAminoAcid(p.letter, p.worldX, p.worldZ);
  }

  // Orient all AAs so sidechain functional groups face each other
  orientSceneToCenter();

  GameEvents.emit('chainChanged', {
    sequence: getSequence(),
    length: getChainLength(),
  });
  GameEvents.emit('sceneLoaded', { scene });
});

// --- Update (fixed timestep) ---
function update(dt) {
  updateInput();
}

// --- Render ---
function render(alpha) {
  updateControls();
  updateParticles();
  updateStructures3D();
  updateWaters3D();
  render3D();
}

// --- Resize ---
resize3D();
window.addEventListener('resize', resize3D);
