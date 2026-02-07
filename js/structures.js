// ============================================================
// structures.js — Molecular structure definitions + data
// Uses real PDB Chemical Component Dictionary ideal coordinates
// ============================================================

import { BIOMES } from './constants.js';
import { AMINO_ACIDS, getAllAtoms, getAllBonds } from './atomic_coords.js';

// --- Atom visuals ---
export const ACOL = { C: '#555555', N: '#5588ff', O: '#ff4444', S: '#ddcc22', H: '#aaaaaa' };
export const ARAD = { C: 2, N: 2, O: 2, S: 3, H: 1 };

const SCALE = 1.5;
export { SCALE as STRUCT_SCALE };
const STRUCT_Y_OFF = -10; // Cα placed slightly above biome center

// Scale from Angstroms to game coordinate units (~matching old pixel scale)
const ANG_SCALE = 10;

// BB_ATOMS exported for .length (sidechain index offset in structures3d.js)
export const BB_ATOMS = [
  { name: 'N', el: 'N' },
  { name: 'CA', el: 'C' },
  { name: 'C', el: 'C' },
  { name: 'O', el: 'O' },
  { name: 'OXT', el: 'O' },
];

// --- Align structure to canonical orientation ---
// Centers on CA, backbone N→C along x, sidechain toward +y,
// then shifts so backbone bottom sits at y=0
function alignAndScale(letter) {
  const aa = AMINO_ACIDS[letter];
  if (!aa) return [];

  const allAtoms = getAllAtoms(letter);
  const bbLen = aa.bb.length;

  // 1) Center on CA (index 1) and scale from Angstroms
  const ca = allAtoms[1];
  const atoms = allAtoms.map(a => ({
    el: a.el, name: a.name,
    x: (a.x - ca.x) * ANG_SCALE,
    y: (a.y - ca.y) * ANG_SCALE,
    z: (a.z - ca.z) * ANG_SCALE,
  }));

  // 2) Compute backbone direction: N (idx 0) → C' (idx 2)
  const n = atoms[0], c = atoms[2];
  const dx = c.x - n.x, dy = c.y - n.y, dz = c.z - n.z;
  const dlen = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (dlen < 0.001) return atoms;
  const xA = { x: dx / dlen, y: dy / dlen, z: dz / dlen };

  // 3) Sidechain direction: first SC atom (CB) relative to CA (origin)
  let scDir;
  if (atoms.length > bbLen) {
    scDir = { x: atoms[bbLen].x, y: atoms[bbLen].y, z: atoms[bbLen].z };
  } else {
    // Glycine: pick a direction perpendicular to backbone
    scDir = Math.abs(xA.y) < 0.9
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 };
  }

  // 4) Gram-Schmidt: yAxis = normalize(scDir - projection onto xAxis)
  const dot = scDir.x * xA.x + scDir.y * xA.y + scDir.z * xA.z;
  const py = scDir.x - dot * xA.x;
  const pyy = scDir.y - dot * xA.y;
  const pyz = scDir.z - dot * xA.z;
  const plen = Math.sqrt(py * py + pyy * pyy + pyz * pyz);

  let yA;
  if (plen > 0.001) {
    yA = { x: py / plen, y: pyy / plen, z: pyz / plen };
  } else {
    yA = Math.abs(xA.y) < 0.9
      ? { x: 0, y: 1, z: 0 }
      : { x: 1, y: 0, z: 0 };
  }

  // 5) zA = cross(xA, yA)
  const zA = {
    x: xA.y * yA.z - xA.z * yA.y,
    y: xA.z * yA.x - xA.x * yA.z,
    z: xA.x * yA.y - xA.y * yA.x,
  };

  // 6) Apply rotation: project each atom onto the new basis
  const aligned = atoms.map(a => ({
    el: a.el, name: a.name,
    x: xA.x * a.x + xA.y * a.y + xA.z * a.z,
    y: yA.x * a.x + yA.y * a.y + yA.z * a.z,
    z: zA.x * a.x + zA.y * a.y + zA.z * a.z,
  }));

  // 7) Shift vertically so backbone bottom sits at y=0
  //    (sidechain extends upward)
  let bbMinY = Infinity;
  for (let i = 0; i < bbLen; i++) {
    if (aligned[i].y < bbMinY) bbMinY = aligned[i].y;
  }
  for (const a of aligned) a.y -= bbMinY;

  return aligned;
}

// --- Build full structure ---
function buildFull(letter) {
  const aa = AMINO_ACIDS[letter];
  if (!aa) return null;

  const atoms = alignAndScale(letter);
  const allBonds = getAllBonds(letter);
  const bonds = allBonds.map(b => [b.from, b.to, b.isDouble]);
  const bbLen = aa.bb.length;

  return {
    atoms,
    bonds,
    charge: aa.charge,
    chargeAtom: aa.chargeAtom >= 0 ? aa.chargeAtom + bbLen : -1,
    special: aa.special,
  };
}

export const FULL = {};
for (const b of BIOMES) {
  FULL[b.letter] = buildFull(b.letter);
}

