// ============================================================
// rotamers.js — Sidechain rotamer cycling (chi angle conformations)
// Chi angles from Dunbrack rotamer library (top 2-3 per amino acid)
// ============================================================

import { FULL, BB_ATOMS } from './structures.js';
import { BIOMES } from './constants.js';

const STRUCT_Y_OFF = -10; // same offset used in structures.js / structures3d.js

// Excluded amino acids: G (no sidechain), A (only CB), P (ring), C (disulfide)
const EXCLUDED = new Set(['G', 'A', 'P', 'C']);

// ============================================================
// Chi angle bond definitions
// axis: [scIdx_a, scIdx_b] where -1 = backbone CA (flat index 1)
// downstream: which sc indices rotate when this chi changes
// ============================================================
const CHI_DEFS = {
  // --- 1 chi ---
  V: [{ axis: [-1, 0], downstream: [1, 2] }],
  S: [{ axis: [-1, 0], downstream: [1] }],
  T: [{ axis: [-1, 0], downstream: [1, 2] }],

  // --- 2 chi ---
  L: [
    { axis: [-1, 0], downstream: [1, 2, 3] },
    { axis: [0, 1], downstream: [2, 3] },
  ],
  I: [
    { axis: [-1, 0], downstream: [1, 2, 3] },
    { axis: [0, 1], downstream: [3] },
  ],
  D: [
    { axis: [-1, 0], downstream: [1, 2, 3] },
    { axis: [0, 1], downstream: [2, 3] },
  ],
  N: [
    { axis: [-1, 0], downstream: [1, 2, 3] },
    { axis: [0, 1], downstream: [2, 3] },
  ],
  F: [
    { axis: [-1, 0], downstream: [1, 2, 3, 4, 5, 6] },
    { axis: [0, 1], downstream: [2, 3, 4, 5, 6] },
  ],
  Y: [
    { axis: [-1, 0], downstream: [1, 2, 3, 4, 5, 6, 7] },
    { axis: [0, 1], downstream: [2, 3, 4, 5, 6, 7] },
  ],
  H: [
    { axis: [-1, 0], downstream: [1, 2, 3, 4, 5] },
    { axis: [0, 1], downstream: [2, 3, 4, 5] },
  ],
  W: [
    { axis: [-1, 0], downstream: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
    { axis: [0, 1], downstream: [2, 3, 4, 5, 6, 7, 8, 9] },
  ],

  // --- 3 chi ---
  M: [
    { axis: [-1, 0], downstream: [1, 2, 3] },
    { axis: [0, 1], downstream: [2, 3] },
    { axis: [1, 2], downstream: [3] },
  ],
  E: [
    { axis: [-1, 0], downstream: [1, 2, 3, 4] },
    { axis: [0, 1], downstream: [2, 3, 4] },
    { axis: [1, 2], downstream: [3, 4] },
  ],
  Q: [
    { axis: [-1, 0], downstream: [1, 2, 3, 4] },
    { axis: [0, 1], downstream: [2, 3, 4] },
    { axis: [1, 2], downstream: [3, 4] },
  ],
  K: [
    { axis: [-1, 0], downstream: [1, 2, 3, 4] },
    { axis: [0, 1], downstream: [2, 3, 4] },
    { axis: [1, 2], downstream: [3, 4] },
  ],
  R: [
    { axis: [-1, 0], downstream: [1, 2, 3, 4, 5, 6] },
    { axis: [0, 1], downstream: [2, 3, 4, 5, 6] },
    { axis: [1, 2], downstream: [3, 4, 5, 6] },
  ],
};

// ============================================================
// Rotamer states: absolute chi angles (degrees) from Dunbrack library
// Index 0 is always the CCD ideal conformation (measured from coords)
// Indices 1+ are common rotamers
// ============================================================
const ROTAMER_STATES = {
  V: [
    [177],        // t (ideal)
    [63],         // g+
    [-60],        // g-
  ],
  L: [
    [-65, 175],   // g-,t (most common)
    [-177, 65],   // t,g+
    [-65, -60],   // g-,g-
  ],
  I: [
    [-60, 170],   // g-,t (most common)
    [-60, -60],   // g-,g-
    [60, 170],    // g+,t
  ],
  S: [
    [64],         // g+ (ideal)
    [-60],        // g-
    [180],        // t
  ],
  T: [
    [63],         // g+ (ideal)
    [-60],        // g-
    [180],        // t
  ],
  D: [
    [-70, -15],   // most common
    [-70, 30],
    [-170, 0],
  ],
  N: [
    [-65, -40],   // most common
    [-65, 120],
    [-170, -20],
  ],
  F: [
    [-65, 90],    // g-,90 (most common)
    [-177, 80],   // t,80
    [62, 90],     // g+,90
  ],
  Y: [
    [-65, 90],    // g-,90
    [-177, 80],   // t,80
    [62, 90],     // g+,90
  ],
  H: [
    [-65, -70],   // g-,-70
    [-177, 80],   // t,80
    [62, -75],    // g+,-75
  ],
  W: [
    [-65, 90],    // g-,90
    [-177, -105], // t,-105
    [62, -90],    // g+,-90
  ],
  M: [
    [-65, -65, 180], // g-,g-,t
    [-65, 180, 180], // g-,t,t
    [-177, 65, 180], // t,g+,t
  ],
  E: [
    [-65, -60, -10], // most common
    [-177, 65, 10],
    [-65, -60, 150],
  ],
  Q: [
    [-65, -60, -40], // most common
    [-177, 65, 0],
    [-65, -60, 120],
  ],
  K: [
    [-65, -65, 180], // g-,g-,t
    [-177, 65, 180], // t,g+,t
    [-65, 180, 180], // g-,t,t
  ],
  R: [
    [-65, -65, 180], // g-,g-,t
    [-177, 65, 180], // t,g+,t
    [-65, 180, 180], // g-,t,t
  ],
};

// ============================================================
// Dihedral angle math
// ============================================================

function measureDihedral(a, b, c, d) {
  // Vectors b->a, b->c, c->d
  const ba = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
  const bc = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
  const cd = { x: d.x - c.x, y: d.y - c.y, z: d.z - c.z };

  // Normal to plane ABC: n1 = ba x bc
  const n1 = cross(ba, bc);
  // Normal to plane BCD: n2 = bc x cd
  const n2 = cross(bc, cd);

  const n1len = vecLen(n1);
  const n2len = vecLen(n2);
  if (n1len < 1e-10 || n2len < 1e-10) return 0;

  // cos(angle) = n1.n2 / (|n1|*|n2|)
  let cosA = dot(n1, n2) / (n1len * n2len);
  cosA = Math.max(-1, Math.min(1, cosA));

  // sign from bc.(n1 x n2)
  const crossN = cross(n1, n2);
  const sign = dot(crossN, bc) < 0 ? -1 : 1;

  return sign * Math.acos(cosA) * (180 / Math.PI);
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function vecLen(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

// Rodrigues' rotation: rotate point around axis through origin by angle (radians)
function rodriguesRotate(point, origin, axisDir, angleRad) {
  // Translate to origin
  const px = point.x - origin.x;
  const py = point.y - origin.y;
  const pz = point.z - origin.z;

  // Normalize axis
  const len = Math.sqrt(axisDir.x * axisDir.x + axisDir.y * axisDir.y + axisDir.z * axisDir.z);
  const kx = axisDir.x / len;
  const ky = axisDir.y / len;
  const kz = axisDir.z / len;

  const cosA = Math.cos(angleRad);
  const sinA = Math.sin(angleRad);

  // k x p
  const cx = ky * pz - kz * py;
  const cy = kz * px - kx * pz;
  const cz = kx * py - ky * px;

  // k . p
  const d = kx * px + ky * py + kz * pz;

  return {
    x: origin.x + px * cosA + cx * sinA + kx * d * (1 - cosA),
    y: origin.y + py * cosA + cy * sinA + ky * d * (1 - cosA),
    z: origin.z + pz * cosA + cz * sinA + kz * d * (1 - cosA),
  };
}

// ============================================================
// Measure reference chi angles from the aligned FULL atoms
// ============================================================
function measureReferenceChi(letter) {
  const defs = CHI_DEFS[letter];
  if (!defs) return [];
  const struct = FULL[letter];
  const bbLen = BB_ATOMS.length;
  const atoms = struct.atoms;

  const chis = [];
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const [aIdx, bIdx] = def.axis;

    // The 4 atoms for the dihedral: prev-a-b-first_downstream
    // "prev" of the axis start:
    //   if axis[0] == -1 (CA), prev is backbone N (flat index 0)
    //   otherwise prev is the atom before axis[0] in the chain
    let prevAtom, atomA, atomB, nextAtom;

    if (aIdx === -1) {
      // axis start is CA (flat 1), prev is N (flat 0)
      prevAtom = atoms[0]; // N
      atomA = atoms[1];    // CA
    } else {
      // prev is CA if aIdx===0, otherwise the parent in CHI_DEFS chain
      if (aIdx === 0) {
        prevAtom = atoms[1]; // CA
      } else {
        // For chi2+, prev is the axis[0] of the previous chi def
        prevAtom = atoms[bbLen + defs[i - 1].axis[0]];
      }
      atomA = atoms[bbLen + aIdx];
    }
    atomB = atoms[bbLen + bIdx];
    // next is the first downstream atom
    nextAtom = atoms[bbLen + def.downstream[0]];

    chis.push(measureDihedral(prevAtom, atomA, atomB, nextAtom));
  }
  return chis;
}

// Cache reference chi angles and prepend as rotamer 0 (original CCD pose)
const refChis = {};
for (const letter of Object.keys(CHI_DEFS)) {
  const measured = measureReferenceChi(letter);
  refChis[letter] = measured;
  // Insert exact measured reference as index 0 so cycling always returns to original
  ROTAMER_STATES[letter].unshift([...measured]);
}

// ============================================================
// Compute rotamer positions: deep-copy atoms, apply chi deltas
// ============================================================
export function computeRotamerPositions(letter, rotamerIdx) {
  const struct = FULL[letter];
  const defs = CHI_DEFS[letter];
  const targetChis = ROTAMER_STATES[letter][rotamerIdx];
  const reference = refChis[letter];
  const bbLen = BB_ATOMS.length;

  // Deep copy all atoms
  const atoms = struct.atoms.map(a => ({ ...a }));

  // Apply each chi rotation sequentially
  for (let i = 0; i < defs.length; i++) {
    const def = defs[i];
    const delta = (targetChis[i] - reference[i]) * (Math.PI / 180);
    if (Math.abs(delta) < 0.001) continue;

    const [aIdx, bIdx] = def.axis;
    const originAtom = aIdx === -1 ? atoms[1] : atoms[bbLen + aIdx];
    const endAtom = atoms[bbLen + bIdx];

    const axisDir = {
      x: endAtom.x - originAtom.x,
      y: endAtom.y - originAtom.y,
      z: endAtom.z - originAtom.z,
    };

    const origin = { x: originAtom.x, y: originAtom.y, z: originAtom.z };

    for (const dsIdx of def.downstream) {
      const atom = atoms[bbLen + dsIdx];
      const rotated = rodriguesRotate(atom, origin, axisDir, delta);
      atom.x = rotated.x;
      atom.y = rotated.y;
      atom.z = rotated.z;
    }
  }

  return atoms;
}

// ============================================================
// Proximity detection: find nearby rotatable structure
// ============================================================
const INTERACT_DIST = 30; // pixels, matching infostones scale

export function getNearbyStructure(px, py) {
  for (const biome of BIOMES) {
    if (EXCLUDED.has(biome.letter)) continue;
    if (!CHI_DEFS[biome.letter]) continue;

    const sx = biome.x;
    const sy = biome.y + STRUCT_Y_OFF;
    const dx = px - sx;
    const dy = py - sy;
    if (dx * dx + dy * dy < INTERACT_DIST * INTERACT_DIST) {
      return biome.letter;
    }
  }
  return null;
}

// ============================================================
// Rotamer state management
// ============================================================
const currentRotamer = {}; // letter -> index

export function cycleRotamer(letter) {
  if (!ROTAMER_STATES[letter]) return 0;
  const count = ROTAMER_STATES[letter].length;
  const cur = currentRotamer[letter] || 0;
  const next = (cur + 1) % count;
  currentRotamer[letter] = next;
  return next;
}

export function getRotamerIndex(letter) {
  return currentRotamer[letter] || 0;
}

export function getRotamerCount(letter) {
  if (!ROTAMER_STATES[letter]) return 0;
  return ROTAMER_STATES[letter].length;
}
