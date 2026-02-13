// ============================================================
// bondInference.js — Infer bonds from PDB atom positions
// 1. Intra-residue: template lookup from residueTemplates.js
// 2. Peptide bonds: C→N between consecutive residues (< 2.0 A)
// 3. Disulfide bonds: SG-SG between CYS (< 2.5 A)
// 4. HETATM fallback: distance-based using covalent radii
// ============================================================

import { getTemplateBonds, isStandardAA } from './residueTemplates.js';

// Covalent radii in Angstroms (for distance-based bond detection)
const COVALENT_RADII = {
  H: 0.31, C: 0.76, N: 0.71, O: 0.66, S: 1.05, P: 1.07,
  SE: 1.20, FE: 1.32, ZN: 1.22, MG: 1.41, CA: 1.76,
  CL: 1.02, BR: 1.20, F: 0.57, NA: 1.66, K: 2.03,
  MN: 1.39, CO: 1.26, NI: 1.24, CU: 1.32,
};

const DEFAULT_RADIUS = 0.77;
const BOND_TOLERANCE = 0.4;  // Angstroms tolerance on top of sum of covalent radii

// Maximum possible bond distance for spatial hashing
const MAX_BOND_DIST = 2.5;

/**
 * Infer all bonds for a parsed protein model.
 *
 * @param {Object} model - Output from parsePDB()
 * @returns {Uint32Array} Flat pairs [a0,b0, a1,b1, ...] of atom indices
 */
export function inferBonds(model) {
  const { atoms, residues, chains, conectBonds, positions } = model;
  const bondSet = new Set();
  const bonds = [];

  function addBond(i, j) {
    const a = Math.min(i, j);
    const b = Math.max(i, j);
    const key = a * atoms.length + b;
    if (!bondSet.has(key)) {
      bondSet.add(key);
      bonds.push(a, b);
    }
  }

  // 1. Intra-residue bonds from templates
  for (const res of residues) {
    const template = getTemplateBonds(res.name);
    if (template) {
      // Build name → atom index map for this residue
      const nameToIdx = new Map();
      for (let j = res.atomStart; j < res.atomEnd; j++) {
        nameToIdx.set(atoms[j].name, j);
      }
      for (const [n1, n2] of template) {
        const i1 = nameToIdx.get(n1);
        const i2 = nameToIdx.get(n2);
        if (i1 !== undefined && i2 !== undefined) {
          addBond(i1, i2);
        }
      }
    } else if (!res.isStandard) {
      // Non-standard residue: use distance-based for intra-residue
      inferDistanceBonds(atoms, positions, res.atomStart, res.atomEnd, addBond);
    }
  }

  // 1b. Bond unbonded hydrogens to nearest heavy atom in same residue
  // Templates only have heavy atoms, so H atoms need distance-based bonding.
  for (const res of residues) {
    if (!res.isStandard) continue;
    for (let j = res.atomStart; j < res.atomEnd; j++) {
      if (atoms[j].element !== 'H') continue;
      // Check if already bonded (e.g. from CONECT or template)
      const key1 = j * atoms.length;
      let bonded = false;
      for (let k = res.atomStart; k < res.atomEnd; k++) {
        if (k === j) continue;
        const a = Math.min(j, k), b = Math.max(j, k);
        if (bondSet.has(a * atoms.length + b)) { bonded = true; break; }
      }
      if (bonded) continue;
      // Find closest heavy atom within covalent bond distance
      const rH = COVALENT_RADII.H;
      let bestK = -1, bestD2 = Infinity;
      for (let k = res.atomStart; k < res.atomEnd; k++) {
        if (k === j || atoms[k].element === 'H') continue;
        const dx = positions[k * 3] - positions[j * 3];
        const dy = positions[k * 3 + 1] - positions[j * 3 + 1];
        const dz = positions[k * 3 + 2] - positions[j * 3 + 2];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bestD2) { bestD2 = d2; bestK = k; }
      }
      if (bestK >= 0) {
        const rK = COVALENT_RADII[atoms[bestK].element] || DEFAULT_RADIUS;
        const maxDist = rH + rK + BOND_TOLERANCE;
        if (bestD2 < maxDist * maxDist && bestD2 > 0.16) {
          addBond(j, bestK);
        }
      }
    }
  }

  // 2. Peptide bonds: C of residue i → N of residue i+1 (same chain)
  for (const chain of chains) {
    for (let ri = chain.residueStart; ri < chain.residueEnd - 1; ri++) {
      const res1 = residues[ri];
      const res2 = residues[ri + 1];
      if (res1.cIndex >= 0 && res2.nIndex >= 0) {
        const d = atomDist(positions, res1.cIndex, res2.nIndex);
        if (d < 2.0) {
          addBond(res1.cIndex, res2.nIndex);
        }
      }
    }
  }

  // 3. Disulfide bonds: SG-SG between CYS residues
  const sgAtoms = [];
  for (const res of residues) {
    if (res.name !== 'CYS') continue;
    for (let j = res.atomStart; j < res.atomEnd; j++) {
      if (atoms[j].name === 'SG') {
        sgAtoms.push(j);
        break;
      }
    }
  }
  for (let i = 0; i < sgAtoms.length; i++) {
    for (let j = i + 1; j < sgAtoms.length; j++) {
      const d = atomDist(positions, sgAtoms[i], sgAtoms[j]);
      if (d < 2.5) {
        addBond(sgAtoms[i], sgAtoms[j]);
      }
    }
  }

  // 4. CONECT records (explicit bonds, typically for ligands)
  for (const [i, j] of conectBonds) {
    addBond(i, j);
  }

  return new Uint32Array(bonds);
}

/**
 * Find bonds between two atom selections using distance criteria.
 * Uses spatial hashing for efficiency.
 *
 * @param {Object} model - Parsed PDB model
 * @param {Set<number>} sel1 - First atom selection
 * @param {Set<number>} sel2 - Second atom selection
 * @param {number|null} cutoff - Distance cutoff in Angstroms (null = covalent radii)
 * @returns {Uint32Array} Flat pairs [a0,b0, a1,b1, ...] of new bonds found
 */
export function findBondsBetween(model, sel1, sel2, cutoff) {
  const { atoms, positions } = model;
  const useCovalent = cutoff == null;
  const maxDist = useCovalent ? MAX_BOND_DIST : cutoff;
  const bonds = [];
  const seen = new Set();

  // Build spatial hash from sel2 atoms
  const cellSize = maxDist;
  const invCell = 1 / cellSize;
  const cellMap = new Map();

  for (const j of sel2) {
    const cx = Math.floor(positions[j * 3] * invCell);
    const cy = Math.floor(positions[j * 3 + 1] * invCell);
    const cz = Math.floor(positions[j * 3 + 2] * invCell);
    const key = `${cx},${cy},${cz}`;
    let cell = cellMap.get(key);
    if (!cell) { cell = []; cellMap.set(key, cell); }
    cell.push(j);
  }

  // For each atom in sel1, check neighboring cells in sel2
  for (const i of sel1) {
    const ix = positions[i * 3], iy = positions[i * 3 + 1], iz = positions[i * 3 + 2];
    const ri = useCovalent ? (COVALENT_RADII[atoms[i].element] || DEFAULT_RADIUS) : 0;

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
            const a = Math.min(i, j);
            const b = Math.max(i, j);
            const pairKey = a * atoms.length + b;
            if (seen.has(pairKey)) continue;

            const ddx = positions[j * 3] - ix;
            const ddy = positions[j * 3 + 1] - iy;
            const ddz = positions[j * 3 + 2] - iz;
            const d2 = ddx * ddx + ddy * ddy + ddz * ddz;

            let threshold;
            if (useCovalent) {
              const rj = COVALENT_RADII[atoms[j].element] || DEFAULT_RADIUS;
              threshold = ri + rj + BOND_TOLERANCE;
            } else {
              threshold = cutoff;
            }

            if (d2 < threshold * threshold && d2 > 0.16) {
              seen.add(pairKey);
              bonds.push(a, b);
            }
          }
        }
      }
    }
  }

  return new Uint32Array(bonds);
}

/**
 * Distance-based bond inference for a subset of atoms (HETATM / non-standard).
 * Uses sum of covalent radii + tolerance.
 */
function inferDistanceBonds(atoms, positions, start, end, addBond) {
  for (let i = start; i < end; i++) {
    const ri = COVALENT_RADII[atoms[i].element] || DEFAULT_RADIUS;
    const ix = positions[i * 3], iy = positions[i * 3 + 1], iz = positions[i * 3 + 2];
    for (let j = i + 1; j < end; j++) {
      const rj = COVALENT_RADII[atoms[j].element] || DEFAULT_RADIUS;
      const maxDist = ri + rj + BOND_TOLERANCE;
      const dx = positions[j * 3] - ix;
      const dy = positions[j * 3 + 1] - iy;
      const dz = positions[j * 3 + 2] - iz;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < maxDist * maxDist && d2 > 0.16) { // min 0.4 A to avoid bonding overlapping atoms
        addBond(i, j);
      }
    }
  }
}

function atomDist(positions, i, j) {
  const dx = positions[j * 3] - positions[i * 3];
  const dy = positions[j * 3 + 1] - positions[i * 3 + 1];
  const dz = positions[j * 3 + 2] - positions[i * 3 + 2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
