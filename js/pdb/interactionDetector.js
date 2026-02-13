// ============================================================
// interactionDetector.js — Detect non-covalent interactions
// Pure detection logic, no Three.js. Returns { a, b, distance }[]
// for each interaction type.
// ============================================================

import { findBondsBetween } from './bondInference.js';

// Interaction type constants
export const INTERACTION_TYPES = {
  HBONDS:       'hbonds',
  SALT_BRIDGES: 'salt_bridges',
  COVALENT:     'covalent',
  DISTANCE:     'distance',
};

// Default cutoffs in Angstroms
const DEFAULT_CUTOFFS = {
  [INTERACTION_TYPES.HBONDS]:       3.5,
  [INTERACTION_TYPES.SALT_BRIDGES]: 4.0,
};

// Donor/acceptor elements for H-bonds (N, O)
const HBOND_ELEMENTS = new Set(['N', 'O']);

// Charged groups for salt bridges
const POSITIVE_GROUPS = {
  ARG: new Set(['NH1', 'NH2', 'NE']),
  LYS: new Set(['NZ']),
  HIS: new Set(['ND1', 'NE2']),
};

const NEGATIVE_GROUPS = {
  ASP: new Set(['OD1', 'OD2']),
  GLU: new Set(['OE1', 'OE2']),
};

// ---- Spatial hash helper ----

function buildSpatialHash(positions, indices, cellSize) {
  const invCell = 1 / cellSize;
  const cellMap = new Map();
  for (const j of indices) {
    const cx = Math.floor(positions[j * 3] * invCell);
    const cy = Math.floor(positions[j * 3 + 1] * invCell);
    const cz = Math.floor(positions[j * 3 + 2] * invCell);
    const key = `${cx},${cy},${cz}`;
    let cell = cellMap.get(key);
    if (!cell) { cell = []; cellMap.set(key, cell); }
    cell.push(j);
  }
  return { cellMap, invCell };
}

function queryNeighbors(positions, i, cellMap, invCell, callback) {
  const ix = positions[i * 3], iy = positions[i * 3 + 1], iz = positions[i * 3 + 2];
  const cx = Math.floor(ix * invCell);
  const cy = Math.floor(iy * invCell);
  const cz = Math.floor(iz * invCell);

  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const cell = cellMap.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!cell) continue;
        for (const j of cell) {
          if (i === j) continue;
          callback(j);
        }
      }
    }
  }
}

function atomDistSq(positions, i, j) {
  const dx = positions[j * 3] - positions[i * 3];
  const dy = positions[j * 3 + 1] - positions[i * 3 + 1];
  const dz = positions[j * 3 + 2] - positions[i * 3 + 2];
  return dx * dx + dy * dy + dz * dz;
}

// ---- Build adjacency map from bonds ----

function buildAdjacency(bonds) {
  const adj = new Map();
  for (let i = 0; i < bonds.length; i += 2) {
    const a = bonds[i], b = bonds[i + 1];
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b);
    adj.get(b).push(a);
  }
  return adj;
}

// ---- H-Bond detection ----

/**
 * Detect hydrogen bonds between two selections.
 * Looks for N/O donor-acceptor pairs within cutoff where donor has a bonded H.
 *
 * @param {Object} model - Parsed PDB model
 * @param {Uint32Array} bonds - Bond array
 * @param {Set<number>} sel1 - First selection
 * @param {Set<number>} sel2 - Second selection
 * @param {number} [cutoff=3.5] - Distance cutoff in Angstroms
 * @returns {{ a: number, b: number, distance: number }[]}
 */
export function detectHBonds(model, bonds, sel1, sel2, cutoff = DEFAULT_CUTOFFS[INTERACTION_TYPES.HBONDS]) {
  const { atoms, positions } = model;
  const results = [];
  const seen = new Set();

  // Check if model has hydrogens at all — many X-ray structures don't.
  // If no hydrogens, skip the bonded-H requirement and use pure
  // donor-acceptor geometry (N/O within cutoff), which is standard practice.
  let hasHydrogens = false;
  for (let i = 0, n = atoms.length; i < n; i++) {
    if (atoms[i].element === 'H') { hasHydrogens = true; break; }
  }

  // Build adjacency to check for bonded hydrogens (only if H present)
  let adj = null;
  if (hasHydrogens) {
    adj = buildAdjacency(bonds);
  }

  // Filter selections to N/O atoms
  const donors1 = [];
  for (const i of sel1) {
    if (HBOND_ELEMENTS.has(atoms[i].element)) donors1.push(i);
  }
  const donors2 = [];
  for (const j of sel2) {
    if (HBOND_ELEMENTS.has(atoms[j].element)) donors2.push(j);
  }

  if (donors1.length === 0 || donors2.length === 0) return results;

  // Check if atom has a bonded hydrogen
  function hasBondedH(idx) {
    if (!adj) return false;
    const neighbors = adj.get(idx);
    if (!neighbors) return false;
    for (const n of neighbors) {
      if (atoms[n].element === 'H') return true;
    }
    return false;
  }

  // Spatial hash from donors2
  const { cellMap, invCell } = buildSpatialHash(positions, donors2, cutoff);
  const cutoffSq = cutoff * cutoff;

  for (const i of donors1) {
    queryNeighbors(positions, i, cellMap, invCell, (j) => {
      const a = Math.min(i, j);
      const b = Math.max(i, j);
      const pairKey = a * atoms.length + b;
      if (seen.has(pairKey)) return;

      const d2 = atomDistSq(positions, i, j);
      if (d2 > cutoffSq || d2 < 0.01) return;

      // If model has hydrogens, require at least one to be a donor
      if (hasHydrogens && !hasBondedH(i) && !hasBondedH(j)) return;

      seen.add(pairKey);
      results.push({ a, b, distance: Math.sqrt(d2) });
    });
  }

  return results;
}

// ---- Salt bridge detection ----

/**
 * Detect salt bridges between two selections.
 * Matches positive charged groups (ARG, LYS, HIS) against
 * negative charged groups (ASP, GLU).
 *
 * @param {Object} model - Parsed PDB model
 * @param {Set<number>} sel1 - First selection
 * @param {Set<number>} sel2 - Second selection
 * @param {number} [cutoff=4.0] - Distance cutoff in Angstroms
 * @returns {{ a: number, b: number, distance: number }[]}
 */
export function detectSaltBridges(model, sel1, sel2, cutoff = DEFAULT_CUTOFFS[INTERACTION_TYPES.SALT_BRIDGES]) {
  const { atoms, positions } = model;
  const results = [];
  const seen = new Set();

  function isPositiveAtom(idx) {
    const atom = atoms[idx];
    const group = POSITIVE_GROUPS[atom.resName];
    return group && group.has(atom.name);
  }

  function isNegativeAtom(idx) {
    const atom = atoms[idx];
    const group = NEGATIVE_GROUPS[atom.resName];
    return group && group.has(atom.name);
  }

  // Collect positive atoms from sel1 and negative from sel2, and vice versa
  const pos1 = [], neg1 = [], pos2 = [], neg2 = [];
  for (const i of sel1) {
    if (isPositiveAtom(i)) pos1.push(i);
    if (isNegativeAtom(i)) neg1.push(i);
  }
  for (const j of sel2) {
    if (isPositiveAtom(j)) pos2.push(j);
    if (isNegativeAtom(j)) neg2.push(j);
  }

  const cutoffSq = cutoff * cutoff;

  function findPairs(posAtoms, negAtoms) {
    if (posAtoms.length === 0 || negAtoms.length === 0) return;
    const { cellMap, invCell } = buildSpatialHash(positions, negAtoms, cutoff);

    for (const i of posAtoms) {
      queryNeighbors(positions, i, cellMap, invCell, (j) => {
        const a = Math.min(i, j);
        const b = Math.max(i, j);
        const pairKey = a * atoms.length + b;
        if (seen.has(pairKey)) return;

        const d2 = atomDistSq(positions, i, j);
        if (d2 > cutoffSq || d2 < 0.01) return;

        seen.add(pairKey);
        results.push({ a, b, distance: Math.sqrt(d2) });
      });
    }
  }

  // Positive from sel1 vs negative from sel2
  findPairs(pos1, neg2);
  // Negative from sel1 vs positive from sel2
  findPairs(neg1, pos2);

  return results;
}

// ---- Covalent bond detection (delegates to findBondsBetween) ----

/**
 * Detect covalent bonds between two selections using covalent radii.
 *
 * @param {Object} model - Parsed PDB model
 * @param {Set<number>} sel1 - First selection
 * @param {Set<number>} sel2 - Second selection
 * @returns {{ a: number, b: number, distance: number }[]}
 */
export function detectCovalent(model, sel1, sel2) {
  const { positions } = model;
  const bondPairs = findBondsBetween(model, sel1, sel2, null);
  const results = [];
  for (let i = 0; i < bondPairs.length; i += 2) {
    const a = bondPairs[i], b = bondPairs[i + 1];
    results.push({ a, b, distance: Math.sqrt(atomDistSq(positions, a, b)) });
  }
  return results;
}

// ---- Distance-based detection (delegates to findBondsBetween) ----

/**
 * Detect all atom pairs between two selections within a distance cutoff.
 *
 * @param {Object} model - Parsed PDB model
 * @param {Set<number>} sel1 - First selection
 * @param {Set<number>} sel2 - Second selection
 * @param {number} cutoff - Distance cutoff in Angstroms
 * @returns {{ a: number, b: number, distance: number }[]}
 */
export function detectDistance(model, sel1, sel2, cutoff) {
  const { positions } = model;
  const bondPairs = findBondsBetween(model, sel1, sel2, cutoff);
  const results = [];
  for (let i = 0; i < bondPairs.length; i += 2) {
    const a = bondPairs[i], b = bondPairs[i + 1];
    results.push({ a, b, distance: Math.sqrt(atomDistSq(positions, a, b)) });
  }
  return results;
}
