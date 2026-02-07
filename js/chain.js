// ============================================================
// chain.js — Chain state, placement, peptide bonds
// ============================================================

import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BIOME_BY_LETTER, CAT_COLORS, CELL_SIZE, GRID_W, GRID_H } from './constants.js';
import { FULL, STRUCT_SCALE, ARAD, BB_ATOMS } from './structures.js';
import { scene, SCALE } from './renderer3d.js';
import { buildStructureGroup, removeStructureRef } from './structures3d.js';
import { cellToWorld, addCellMarker, removeCellMarker, moveCellMarker } from './grid3d.js';
import { repositionWaters } from './water3d.js';

const S = STRUCT_SCALE * SCALE;

// --- State ---
const chain = [];        // { letter, col, row, group, label, spotlight, refKey }
const occupied = {};     // "col,row" → true
const bonds = [];        // { mesh, i, j } — adjacency-based peptide bonds

function isAdjacent(c1, r1, c2, r2) {
  return (Math.abs(c1 - c2) + Math.abs(r1 - r2)) === 1;
}

function removeBondsFor(idx) {
  for (let b = bonds.length - 1; b >= 0; b--) {
    if (bonds[b].i === idx || bonds[b].j === idx) {
      scene.remove(bonds[b].mesh);
      bonds[b].mesh.geometry?.dispose();
      bonds[b].mesh.material?.dispose();
      bonds.splice(b, 1);
    }
  }
}

function createAdjacentBonds(idx) {
  const e = chain[idx];
  for (let k = 0; k < chain.length; k++) {
    if (k === idx) continue;
    if (!isAdjacent(e.col, e.row, chain[k].col, chain[k].row)) continue;
    if (bonds.some(b => (b.i === idx && b.j === k) || (b.i === k && b.j === idx))) continue;
    const mesh = makePeptideBond(e, chain[k]);
    if (mesh) bonds.push({ mesh, i: idx, j: k });
  }
}

// Orient an entry so its backbone N faces a neighbor (C points away)
function orientTowardNeighbor(entry, neighborCol, neighborRow) {
  const atomN = FULL[entry.letter].atoms[0];
  const atomC = FULL[entry.letter].atoms[2];
  // Backbone N→C angle in local XZ plane (≈ 0 since aligned to +x)
  const bbAngle = Math.atan2((atomC.z || 0) - (atomN.z || 0), atomC.x - atomN.x);
  // Direction away from neighbor in world XZ
  const awayAngle = Math.atan2(entry.row - neighborRow, entry.col - neighborCol);
  entry.group.rotation.set(0, bbAngle - awayAngle, 0);
}

// --- Shared geometries ---
const bondGeo = new THREE.CylinderGeometry(0.05, 0.05, 1, 6);
const bondMat = new THREE.MeshStandardMaterial({
  color: 0x66aaff, emissive: 0x223355, emissiveIntensity: 0.4, roughness: 0.3,
});

// ============================================================
// Peptide bond: cylinder between backbone C of one and N of the other
// Picks the shorter C→N pair (respects group rotation)
// ============================================================
const _bv = new THREE.Vector3();

function atomWorld(entry, atomIdx) {
  const pos = cellToWorld(entry.col, entry.row);
  const atom = FULL[entry.letter].atoms[atomIdx];
  _bv.set(atom.x * S, atom.y * S, (atom.z || 0) * S);
  _bv.applyEuler(entry.group.rotation);
  return new THREE.Vector3(pos.x + _bv.x, 0.3 + _bv.y, pos.z + _bv.z);
}

function makePeptideBond(entryA, entryB) {
  // Try both C→N directions, pick the shorter (correct) one
  const ac = atomWorld(entryA, 2); // A's backbone C
  const bn = atomWorld(entryB, 0); // B's backbone N
  const bc = atomWorld(entryB, 2); // B's backbone C
  const an = atomWorld(entryA, 0); // A's backbone N

  const [pw, nw] = ac.distanceTo(bn) <= bc.distanceTo(an) ? [ac, bn] : [bc, an];

  const dir = new THREE.Vector3().subVectors(nw, pw);
  const len = dir.length();
  if (len < 0.001) return null;

  const mesh = new THREE.Mesh(bondGeo, bondMat.clone());
  mesh.scale.y = len;
  mesh.position.copy(new THREE.Vector3().addVectors(pw, nw).multiplyScalar(0.5));
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  mesh.quaternion.copy(quat);

  scene.add(mesh);
  return mesh;
}

// ============================================================
// Place amino acid
// ============================================================
export function placeAminoAcid(letter, col, row) {
  const key = `${col},${row}`;
  if (occupied[key]) return null;

  const pos = cellToWorld(col, row);
  const refKey = `chain_${chain.length}`;

  // Structure group
  const group = buildStructureGroup(letter, {
    x3d: pos.x, y3d: 0.3, z3d: pos.z, refKey,
  });
  scene.add(group);

  // Spotlight
  const spotlight = new THREE.PointLight(0xffe8cc, 1.5, 12);
  spotlight.position.set(pos.x, 4, pos.z);
  scene.add(spotlight);

  // CSS2D label
  const biome = BIOME_BY_LETTER[letter];
  const div = document.createElement('div');
  div.className = 'exhibit-label';
  div.innerHTML =
    `<div class="exhibit-name" style="color:${CAT_COLORS[biome.category] || '#ddaa33'}">${biome.name}</div>` +
    `<div class="exhibit-codes">${biome.code3} (${letter})</div>`;
  const label = new CSS2DObject(div);
  label.position.set(pos.x, 2.5, pos.z);
  scene.add(label);

  const entry = { letter, col, row, group, label, spotlight, refKey };
  chain.push(entry);
  occupied[key] = true;

  // Colored cell marker
  addCellMarker(col, row, CAT_COLORS[biome.category] || '#ddaa33');

  // Orient + bond if placed adjacent to another AA
  const idx = chain.length - 1;
  for (let k = 0; k < chain.length; k++) {
    if (k === idx) continue;
    if (isAdjacent(col, row, chain[k].col, chain[k].row)) {
      orientTowardNeighbor(entry, chain[k].col, chain[k].row);
      break;
    }
  }
  createAdjacentBonds(idx);

  return entry;
}

// ============================================================
// Remove last amino acid (undo)
// ============================================================
export function removeLastAminoAcid() {
  if (chain.length === 0) return null;

  const removedIdx = chain.length - 1;
  removeBondsFor(removedIdx);

  const entry = chain.pop();
  if (entry.gridCol != null) {
    // Scene-placed entry: occupancy and marker use integer gridCol/gridRow
    delete occupied[`${entry.gridCol},${entry.gridRow}`];
    removeCellMarker(entry.gridCol, entry.gridRow);
  } else {
    // User-placed entry: col/row are integers
    delete occupied[`${entry.col},${entry.row}`];
    removeCellMarker(entry.col, entry.row);
  }

  // Remove from scene
  scene.remove(entry.group);
  scene.remove(entry.spotlight);
  scene.remove(entry.label);

  // Dispose structure ref
  removeStructureRef(entry.refKey);

  // Dispose geometries/materials
  entry.group.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (child.material.dispose) child.material.dispose();
    }
  });

  return entry;
}

// ============================================================
// Remove a specific amino acid by chain index
// ============================================================
export function removeAminoAcid(idx) {
  if (idx < 0 || idx >= chain.length) return null;

  removeBondsFor(idx);

  const entry = chain.splice(idx, 1)[0];
  if (entry.gridCol != null) {
    delete occupied[`${entry.gridCol},${entry.gridRow}`];
    removeCellMarker(entry.gridCol, entry.gridRow);
  } else {
    delete occupied[`${entry.col},${entry.row}`];
    removeCellMarker(entry.col, entry.row);
  }

  // Remove from scene
  scene.remove(entry.group);
  scene.remove(entry.spotlight);
  scene.remove(entry.label);

  // Dispose structure ref
  removeStructureRef(entry.refKey);

  // Dispose geometries/materials
  entry.group.traverse(child => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (child.material.dispose) child.material.dispose();
    }
  });

  // Fix bond indices that shifted after splice
  for (const b of bonds) {
    if (b.i > idx) b.i--;
    if (b.j > idx) b.j--;
  }

  return entry;
}

// ============================================================
// Move an existing amino acid to a new cell
// ============================================================
export function moveAminoAcid(chainIndex, newCol, newRow) {
  const newKey = `${newCol},${newRow}`;
  if (occupied[newKey]) return false;
  if (chainIndex < 0 || chainIndex >= chain.length) return false;

  const entry = chain[chainIndex];
  // Scene entries use gridCol/gridRow for occupancy; user entries use col/row
  const oldGridCol = entry.gridCol != null ? entry.gridCol : entry.col;
  const oldGridRow = entry.gridRow != null ? entry.gridRow : entry.row;
  const oldKey = `${oldGridCol},${oldGridRow}`;

  // Update occupancy
  delete occupied[oldKey];
  occupied[newKey] = true;
  entry.col = newCol;
  entry.row = newRow;
  // After move, entry is on an integer grid cell — clear scene-specific fields
  delete entry.gridCol;
  delete entry.gridRow;

  // Move cell marker
  moveCellMarker(oldGridCol, oldGridRow, newCol, newRow);

  // Move visuals to new position
  const pos = cellToWorld(newCol, newRow);
  entry.group.position.set(pos.x, 0.3, pos.z);
  entry.spotlight.position.set(pos.x, 4, pos.z);
  entry.label.position.set(pos.x, 2.5, pos.z);

  // Move waters to follow
  repositionWaters(entry.refKey, newCol, newRow);

  // Orient toward first adjacent neighbor so backbone bond is correct
  removeBondsFor(chainIndex);
  for (let k = 0; k < chain.length; k++) {
    if (k === chainIndex) continue;
    if (isAdjacent(newCol, newRow, chain[k].col, chain[k].row)) {
      orientTowardNeighbor(entry, chain[k].col, chain[k].row);
      break;
    }
  }
  createAdjacentBonds(chainIndex);

  return true;
}

// ============================================================
// Find chain entry at a grid cell
// ============================================================
export function getEntryAt(col, row) {
  const key = `${col},${row}`;
  if (!occupied[key]) return null;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    // Match integer col/row (user placement) or gridCol/gridRow (scene placement)
    if ((e.col === col && e.row === row) ||
        (e.gridCol === col && e.gridRow === row)) return i;
  }
  return null;
}

// ============================================================
// Queries
// ============================================================
export function getSequence() {
  return chain.map(e => e.letter).join('');
}

export function getChainLength() {
  return chain.length;
}

export function isOccupied(col, row) {
  return !!occupied[`${col},${row}`];
}

export function getChain() {
  return chain;
}

export function clearChain() {
  while (chain.length > 0) {
    removeLastAminoAcid();
  }
}

// ============================================================
// Rebuild all adjacency bonds (after reorienting entries)
// ============================================================
function rebuildAllBonds() {
  for (const b of bonds) {
    scene.remove(b.mesh);
    b.mesh.geometry?.dispose();
    b.mesh.material?.dispose();
  }
  bonds.length = 0;
  for (let i = 0; i < chain.length; i++) {
    createAdjacentBonds(i);
  }
}

// ============================================================
// Orient all placed AAs toward their geometric center
// so pairs face each other and clusters radiate inward
// ============================================================
export function orientChainToCenter() {
  if (chain.length === 0) return;

  // Geometric center
  let cx = 0, cz = 0;
  for (const e of chain) { cx += e.col; cz += e.row; }
  cx /= chain.length;
  cz /= chain.length;

  for (const entry of chain) {
    const dx = cx - entry.col;
    const dz = cz - entry.row;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const atomN = FULL[entry.letter].atoms[0];
    const atomC = FULL[entry.letter].atoms[2];
    const bbAngle = Math.atan2((atomC.z || 0) - (atomN.z || 0), atomC.x - atomN.x);

    if (dist < 0.01) {
      // Single AA or exactly at center — face viewer (+z)
      entry.group.rotation.set(0, bbAngle - Math.PI / 2, 0);
    } else {
      // Backbone points away from center so sidechains face inward
      const awayAngle = Math.atan2(-dz, -dx);
      entry.group.rotation.set(0, bbAngle - awayAngle, 0);
    }
  }

  rebuildAllBonds();
}

// ============================================================
// Orient scene entries so sidechain functional groups face center
// Uses XZ centroid of sidechain atoms instead of backbone direction
// ============================================================
export function orientSceneToCenter() {
  if (chain.length === 0) return;

  const bbLen = BB_ATOMS.length;

  // Geometric center in world coords
  let cx = 0, cz = 0;
  for (const e of chain) {
    const pos = cellToWorld(e.col, e.row);
    cx += pos.x;
    cz += pos.z;
  }
  cx /= chain.length;
  cz /= chain.length;

  for (const entry of chain) {
    const pos = cellToWorld(entry.col, entry.row);
    const dx = cx - pos.x;
    const dz = cz - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    const atoms = FULL[entry.letter].atoms;

    // Compute sidechain XZ centroid in local coords
    let scx = 0, scz = 0, scCount = 0;
    for (let i = bbLen; i < atoms.length; i++) {
      scx += atoms[i].x * S;
      scz += (atoms[i].z || 0) * S;
      scCount++;
    }

    if (scCount === 0 || (Math.abs(scx / scCount) < 0.001 && Math.abs(scz / scCount) < 0.001)) {
      // No sidechain (GLY) or sidechain is centered in XZ — use backbone orientation
      const atomN = atoms[0];
      const atomC = atoms[2];
      const bbAngle = Math.atan2((atomC.z || 0) - (atomN.z || 0), atomC.x - atomN.x);
      if (dist < 0.01) {
        entry.group.rotation.set(0, bbAngle - Math.PI / 2, 0);
      } else {
        const awayAngle = Math.atan2(-dz, -dx);
        entry.group.rotation.set(0, bbAngle - awayAngle, 0);
      }
      continue;
    }

    scx /= scCount;
    scz /= scCount;
    const scAngle = Math.atan2(scz, scx);

    if (dist < 0.01) {
      // Single AA at center — face sidechain toward viewer (+z)
      entry.group.rotation.set(0, scAngle - Math.PI / 2, 0);
    } else {
      // Rotate so sidechain XZ centroid points toward group center
      const towardAngle = Math.atan2(dz, dx);
      entry.group.rotation.set(0, scAngle - towardAngle, 0);
    }
  }

  rebuildAllBonds();
}

// ============================================================
// Compute bounding radius of a structure (worst-case any rotation)
// ============================================================
function getStructureRadius(letter) {
  const atoms = FULL[letter].atoms;
  let maxR = 0;
  for (const a of atoms) {
    const r = Math.sqrt((a.x * S) ** 2 + (a.y * S) ** 2 + ((a.z || 0) * S) ** 2);
    if (r > maxR) maxR = r;
  }
  return maxR;
}

// ============================================================
// Lateral radius: max XZ-plane distance from center to atom edge
// (ignores Y/sidechain height for tighter lateral spacing)
// ============================================================
export function getStructureLateralRadius(letter) {
  const atoms = FULL[letter].atoms;
  let maxR = 0;
  for (const a of atoms) {
    const lx = a.x * S;
    const lz = (a.z || 0) * S;
    const atomVisR = ARAD[a.el] * S * 0.8;
    const r = Math.sqrt(lx * lx + lz * lz) + atomVisR;
    if (r > maxR) maxR = r;
  }
  return maxR;
}

// ============================================================
// Compute scene placements in exact world coordinates
// layout: array of rows, each row is array of letters (null = gap)
// Returns [{ letter, worldX, worldZ, lateralRadius }, ...]
// ============================================================
const SCENE_PADDING = 0.8; // world units of clear space between structures
const GAP_SPACING = 2.0;   // world units for a null gap

export function computeScenePlacements(layout) {
  const numRows = layout.length;
  const numCols = Math.max(...layout.map(r => r.length));

  // Lateral radius per column and per row
  const colRadii = new Array(numCols).fill(0);
  const rowRadii = new Array(numRows).fill(0);

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < layout[r].length; c++) {
      const letter = layout[r][c];
      if (!letter) continue;
      const radius = getStructureLateralRadius(letter);
      colRadii[c] = Math.max(colRadii[c], radius);
      rowRadii[r] = Math.max(rowRadii[r], radius);
    }
  }

  // Column positions in exact world units
  const colWorldPos = [0];
  for (let c = 1; c < numCols; c++) {
    if (colRadii[c] === 0 && colRadii[c - 1] === 0) {
      // Both are gaps
      colWorldPos.push(colWorldPos[c - 1] + GAP_SPACING);
    } else if (colRadii[c - 1] === 0) {
      // Previous was a gap
      colWorldPos.push(colWorldPos[c - 1] + GAP_SPACING + colRadii[c]);
    } else if (colRadii[c] === 0) {
      // Current is a gap
      colWorldPos.push(colWorldPos[c - 1] + colRadii[c - 1] + GAP_SPACING);
    } else {
      colWorldPos.push(colWorldPos[c - 1] + colRadii[c - 1] + colRadii[c] + SCENE_PADDING);
    }
  }

  // Row positions in exact world units
  const rowWorldPos = [0];
  for (let r = 1; r < numRows; r++) {
    if (rowRadii[r] === 0 && rowRadii[r - 1] === 0) {
      rowWorldPos.push(rowWorldPos[r - 1] + GAP_SPACING);
    } else if (rowRadii[r - 1] === 0) {
      rowWorldPos.push(rowWorldPos[r - 1] + GAP_SPACING + rowRadii[r]);
    } else if (rowRadii[r] === 0) {
      rowWorldPos.push(rowWorldPos[r - 1] + rowRadii[r - 1] + GAP_SPACING);
    } else {
      rowWorldPos.push(rowWorldPos[r - 1] + rowRadii[r - 1] + rowRadii[r] + SCENE_PADDING);
    }
  }

  // Center on grid (grid center is GRID_W/2, GRID_H/2)
  const colSpan = colWorldPos[numCols - 1] || 0;
  const rowSpan = rowWorldPos[numRows - 1] || 0;
  const colOffset = GRID_W / 2 - colSpan / 2;
  const rowOffset = GRID_H / 2 - rowSpan / 2;

  const placements = [];
  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < layout[r].length; c++) {
      const letter = layout[r][c];
      if (!letter) continue;
      placements.push({
        letter,
        worldX: colWorldPos[c] + colOffset,
        worldZ: rowWorldPos[r] + rowOffset,
        lateralRadius: getStructureLateralRadius(letter),
      });
    }
  }

  return placements;
}

// ============================================================
// Place amino acid at exact world coordinates (for scenes only)
// Bypasses grid occupancy and cell markers
// ============================================================
export function placeSceneAminoAcid(letter, worldX, worldZ) {
  const refKey = `chain_${chain.length}`;

  // Structure group at exact world position
  const group = buildStructureGroup(letter, {
    x3d: worldX, y3d: 0.3, z3d: worldZ, refKey,
  });
  scene.add(group);

  // Spotlight
  const spotlight = new THREE.PointLight(0xffe8cc, 1.5, 12);
  spotlight.position.set(worldX, 4, worldZ);
  scene.add(spotlight);

  // CSS2D label
  const biome = BIOME_BY_LETTER[letter];
  const div = document.createElement('div');
  div.className = 'exhibit-label';
  div.innerHTML =
    `<div class="exhibit-name" style="color:${CAT_COLORS[biome.category] || '#ddaa33'}">${biome.name}</div>` +
    `<div class="exhibit-codes">${biome.code3} (${letter})</div>`;
  const label = new CSS2DObject(div);
  label.position.set(worldX, 2.5, worldZ);
  scene.add(label);

  // Compute float col/row for orientChainToCenter compatibility
  const col = (worldX - CELL_SIZE / 2) / CELL_SIZE;
  const row = (worldZ - CELL_SIZE / 2) / CELL_SIZE;

  // Integer grid cell for occupancy, selection, and cell marker
  const gridCol = Math.round(col);
  const gridRow = Math.round(row);
  const gridKey = `${gridCol},${gridRow}`;
  occupied[gridKey] = true;

  // Colored cell marker
  addCellMarker(gridCol, gridRow, CAT_COLORS[biome.category] || '#ddaa33');

  const entry = { letter, col, row, gridCol, gridRow, group, label, spotlight, refKey };
  chain.push(entry);

  return entry;
}
