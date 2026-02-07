// ============================================================
// atomic_coords.js — Real 3D atomic coordinates for 20 amino acids
// Source: PDB Chemical Component Dictionary (CCD) ideal coordinates
// URL: https://files.rcsb.org/ligands/view/{CODE}.cif
// All coordinates in Angstroms, heavy atoms only (no hydrogens)
// ============================================================

// Each amino acid has BOTH backbone and sidechain atoms from the PDB CCD.
// The backbone atoms (N, CA, C, O, OXT) vary slightly per amino acid in
// the CCD ideal coordinates. For game rendering you may want to use a
// single canonical backbone and only vary the sidechain.
//
// Format per amino acid:
//   bb: backbone atoms [{name, el, x, y, z}, ...]
//   sc: sidechain atoms [{name, el, x, y, z}, ...]
//   bbBonds: [[fromIdx, toIdx, isDouble], ...]  (indices into bb array)
//   scBonds: [[fromIdx, toIdx], ...]  (indices into sc array)
//   scDouble: [[fromIdx, toIdx], ...]  (which scBonds are double)
//   bbToSc: [bbIdx, scIdx]  (which bb atom connects to first sc atom, usually CA->CB)
//   ringClose: [scIdx, bbIdx] | null  (for proline: CD bonds back to N)
//   charge: net charge at pH 7
//   chargeAtom: index in sc array of charged group center (-1 if none)
//   special: string | null  ('disulfide', 'phSwitch', etc.)

export const AMINO_ACIDS = {

  // ============================================================
  // GLYCINE (GLY) — G
  // No sidechain (simplest amino acid)
  // ============================================================
  G: {
    name: 'Glycine', code3: 'GLY',
    bb: [
      { name: 'N',   el: 'N', x:  1.931, y:  0.090, z: -0.034 },
      { name: 'CA',  el: 'C', x:  0.761, y: -0.799, z: -0.008 },
      { name: 'C',   el: 'C', x: -0.498, y:  0.029, z: -0.005 },
      { name: 'O',   el: 'O', x: -0.429, y:  1.235, z: -0.023 },
      { name: 'OXT', el: 'O', x: -1.697, y: -0.574, z:  0.018 },
    ],
    sc: [],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [], scDouble: [],
    bbToSc: null,
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // ALANINE (ALA) — A
  // Methyl sidechain
  // ============================================================
  A: {
    name: 'Alanine', code3: 'ALA',
    bb: [
      { name: 'N',   el: 'N', x: -0.966, y:  0.493, z:  1.500 },
      { name: 'CA',  el: 'C', x:  0.257, y:  0.418, z:  0.692 },
      { name: 'C',   el: 'C', x: -0.094, y:  0.017, z: -0.716 },
      { name: 'O',   el: 'O', x: -1.056, y: -0.682, z: -0.923 },
      { name: 'OXT', el: 'O', x:  0.661, y:  0.439, z: -1.742 },
    ],
    sc: [
      { name: 'CB', el: 'C', x:  1.204, y: -0.620, z:  1.296 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [], scDouble: [],
    bbToSc: [1, 0], // CA -> CB
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // VALINE (VAL) — V
  // Isopropyl sidechain
  // ============================================================
  V: {
    name: 'Valine', code3: 'VAL',
    bb: [
      { name: 'N',   el: 'N', x:  1.564, y: -0.642, z:  0.454 },
      { name: 'CA',  el: 'C', x:  0.145, y: -0.698, z:  0.079 },
      { name: 'C',   el: 'C', x: -0.037, y: -0.093, z: -1.288 },
      { name: 'O',   el: 'O', x:  0.703, y:  0.784, z: -1.664 },
      { name: 'OXT', el: 'O', x: -1.022, y: -0.529, z: -2.089 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x: -0.682, y:  0.086, z:  1.098 },
      { name: 'CG1', el: 'C', x: -0.497, y: -0.528, z:  2.487 },
      { name: 'CG2', el: 'C', x: -0.218, y:  1.543, z:  1.119 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[0,2]], scDouble: [],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // LEUCINE (LEU) — L
  // Isobutyl sidechain
  // ============================================================
  L: {
    name: 'Leucine', code3: 'LEU',
    bb: [
      { name: 'N',   el: 'N', x: -1.661, y:  0.627, z: -0.406 },
      { name: 'CA',  el: 'C', x: -0.205, y:  0.441, z: -0.467 },
      { name: 'C',   el: 'C', x:  0.180, y: -0.055, z: -1.836 },
      { name: 'O',   el: 'O', x: -0.591, y: -0.731, z: -2.474 },
      { name: 'OXT', el: 'O', x:  1.382, y:  0.254, z: -2.348 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x:  0.221, y: -0.583, z:  0.585 },
      { name: 'CG',  el: 'C', x: -0.170, y: -0.079, z:  1.976 },
      { name: 'CD1', el: 'C', x:  0.256, y: -1.104, z:  3.029 },
      { name: 'CD2', el: 'C', x:  0.526, y:  1.254, z:  2.250 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[1,3]], scDouble: [],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // ISOLEUCINE (ILE) — I
  // sec-Butyl sidechain
  // ============================================================
  I: {
    name: 'Isoleucine', code3: 'ILE',
    bb: [
      { name: 'N',   el: 'N', x: -1.944, y:  0.335, z: -0.343 },
      { name: 'CA',  el: 'C', x: -0.487, y:  0.519, z: -0.369 },
      { name: 'C',   el: 'C', x:  0.066, y: -0.032, z: -1.657 },
      { name: 'O',   el: 'O', x: -0.484, y: -0.958, z: -2.203 },
      { name: 'OXT', el: 'O', x:  1.171, y:  0.504, z: -2.197 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x:  0.140, y: -0.219, z:  0.814 },
      { name: 'CG1', el: 'C', x: -0.421, y:  0.341, z:  2.122 },
      { name: 'CG2', el: 'C', x:  1.658, y: -0.027, z:  0.788 },
      { name: 'CD1', el: 'C', x:  0.206, y: -0.397, z:  3.305 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[0,2],[1,3]], scDouble: [],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // PROLINE (PRO) — P
  // Pyrrolidine ring (sidechain bonds back to backbone N)
  // ============================================================
  P: {
    name: 'Proline', code3: 'PRO',
    bb: [
      { name: 'N',   el: 'N', x: -0.816, y:  1.108, z:  0.254 },
      { name: 'CA',  el: 'C', x:  0.001, y: -0.107, z:  0.509 },
      { name: 'C',   el: 'C', x:  1.408, y:  0.091, z:  0.005 },
      { name: 'O',   el: 'O', x:  1.650, y:  0.980, z: -0.777 },
      { name: 'OXT', el: 'O', x:  2.391, y: -0.721, z:  0.424 },
    ],
    sc: [
      { name: 'CB', el: 'C', x: -0.703, y: -1.227, z: -0.286 },
      { name: 'CG', el: 'C', x: -2.163, y: -0.753, z: -0.439 },
      { name: 'CD', el: 'C', x: -2.218, y:  0.614, z:  0.276 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2]], scDouble: [],
    bbToSc: [1, 0],
    ringClose: [2, 0], // CD (sc idx 2) bonds back to N (bb idx 0)
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // PHENYLALANINE (PHE) — F
  // Benzyl sidechain
  // ============================================================
  F: {
    name: 'Phenylalanine', code3: 'PHE',
    bb: [
      { name: 'N',   el: 'N', x:  1.317, y:  0.962, z:  1.014 },
      { name: 'CA',  el: 'C', x: -0.020, y:  0.426, z:  1.300 },
      { name: 'C',   el: 'C', x: -0.109, y:  0.047, z:  2.756 },
      { name: 'O',   el: 'O', x:  0.879, y: -0.317, z:  3.346 },
      { name: 'OXT', el: 'O', x: -1.286, y:  0.113, z:  3.396 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x: -0.270, y: -0.809, z:  0.434 },
      { name: 'CG',  el: 'C', x: -0.181, y: -0.430, z: -1.020 },
      { name: 'CD1', el: 'C', x:  1.031, y: -0.498, z: -1.680 },
      { name: 'CD2', el: 'C', x: -1.314, y: -0.018, z: -1.698 },
      { name: 'CE1', el: 'C', x:  1.112, y: -0.150, z: -3.015 },
      { name: 'CE2', el: 'C', x: -1.231, y:  0.333, z: -3.032 },
      { name: 'CZ',  el: 'C', x: -0.018, y:  0.265, z: -3.691 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[1,3],[2,4],[3,5],[4,6],[5,6]],
    scDouble: [[1,2],[3,5],[4,6]],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // TRYPTOPHAN (TRP) — W
  // Indole ring system (pyrrole fused with benzene)
  // ============================================================
  W: {
    name: 'Tryptophan', code3: 'TRP',
    bb: [
      { name: 'N',   el: 'N', x:  1.278, y:  1.121, z:  2.059 },
      { name: 'CA',  el: 'C', x: -0.008, y:  0.417, z:  1.970 },
      { name: 'C',   el: 'C', x: -0.490, y:  0.076, z:  3.357 },
      { name: 'O',   el: 'O', x:  0.308, y: -0.130, z:  4.240 },
      { name: 'OXT', el: 'O', x: -1.806, y:  0.001, z:  3.610 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x:  0.168, y: -0.868, z:  1.161 },
      { name: 'CG',  el: 'C', x:  0.650, y: -0.526, z: -0.225 },
      { name: 'CD1', el: 'C', x:  1.928, y: -0.418, z: -0.622 },
      { name: 'CD2', el: 'C', x: -0.186, y: -0.256, z: -1.396 },
      { name: 'NE1', el: 'N', x:  1.978, y: -0.095, z: -1.951 },
      { name: 'CE2', el: 'C', x:  0.701, y:  0.014, z: -2.454 },
      { name: 'CE3', el: 'C', x: -1.564, y: -0.210, z: -1.615 },
      { name: 'CZ2', el: 'C', x:  0.190, y:  0.314, z: -3.712 },
      { name: 'CZ3', el: 'C', x: -2.044, y:  0.086, z: -2.859 },
      { name: 'CH2', el: 'C', x: -1.173, y:  0.348, z: -3.907 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [
      [0,1],[1,2],[1,3],[2,4],[3,5],[3,6],
      [4,5],[5,7],[6,8],[7,9],[8,9],
    ],
    scDouble: [[1,2],[3,5],[6,8],[7,9]],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // TYROSINE (TYR) — Y
  // 4-Hydroxyphenyl sidechain
  // ============================================================
  Y: {
    name: 'Tyrosine', code3: 'TYR',
    bb: [
      { name: 'N',   el: 'N', x:  1.320, y:  0.952, z:  1.428 },
      { name: 'CA',  el: 'C', x: -0.018, y:  0.429, z:  1.734 },
      { name: 'C',   el: 'C', x: -0.103, y:  0.094, z:  3.201 },
      { name: 'O',   el: 'O', x:  0.886, y: -0.254, z:  3.799 },
      { name: 'OXT', el: 'O', x: -1.279, y:  0.184, z:  3.842 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x: -0.274, y: -0.831, z:  0.907 },
      { name: 'CG',  el: 'C', x: -0.189, y: -0.496, z: -0.559 },
      { name: 'CD1', el: 'C', x:  1.022, y: -0.589, z: -1.219 },
      { name: 'CD2', el: 'C', x: -1.324, y: -0.102, z: -1.244 },
      { name: 'CE1', el: 'C', x:  1.103, y: -0.282, z: -2.563 },
      { name: 'CE2', el: 'C', x: -1.247, y:  0.210, z: -2.587 },
      { name: 'CZ',  el: 'C', x: -0.032, y:  0.118, z: -3.252 },
      { name: 'OH',  el: 'O', x:  0.044, y:  0.420, z: -4.574 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[1,3],[2,4],[3,5],[4,6],[5,6],[6,7]],
    scDouble: [[1,2],[3,5],[4,6]],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // SERINE (SER) — S
  // Hydroxymethyl sidechain
  // ============================================================
  S: {
    name: 'Serine', code3: 'SER',
    bb: [
      { name: 'N',   el: 'N', x:  1.525, y:  0.493, z: -0.608 },
      { name: 'CA',  el: 'C', x:  0.100, y:  0.469, z: -0.252 },
      { name: 'C',   el: 'C', x: -0.053, y:  0.004, z:  1.173 },
      { name: 'O',   el: 'O', x:  0.751, y: -0.760, z:  1.649 },
      { name: 'OXT', el: 'O', x: -1.084, y:  0.440, z:  1.913 },
    ],
    sc: [
      { name: 'CB', el: 'C', x: -0.642, y: -0.489, z: -1.184 },
      { name: 'OG', el: 'O', x: -0.496, y: -0.049, z: -2.535 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1]], scDouble: [],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // THREONINE (THR) — T
  // Hydroxyl + methyl sidechain
  // ============================================================
  T: {
    name: 'Threonine', code3: 'THR',
    bb: [
      { name: 'N',   el: 'N', x:  1.543, y: -0.702, z:  0.430 },
      { name: 'CA',  el: 'C', x:  0.122, y: -0.706, z:  0.056 },
      { name: 'C',   el: 'C', x: -0.038, y: -0.090, z: -1.309 },
      { name: 'O',   el: 'O', x:  0.732, y:  0.761, z: -1.683 },
      { name: 'OXT', el: 'O', x: -1.039, y: -0.488, z: -2.110 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x: -0.675, y:  0.104, z:  1.079 },
      { name: 'OG1', el: 'O', x: -0.193, y:  1.448, z:  1.103 },
      { name: 'CG2', el: 'C', x: -0.511, y: -0.521, z:  2.466 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[0,2]], scDouble: [],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // CYSTEINE (CYS) — C
  // Thiol sidechain
  // ============================================================
  C: {
    name: 'Cysteine', code3: 'CYS',
    bb: [
      { name: 'N',   el: 'N', x:  1.585, y:  0.483, z: -0.081 },
      { name: 'CA',  el: 'C', x:  0.141, y:  0.450, z:  0.186 },
      { name: 'C',   el: 'C', x: -0.095, y:  0.006, z:  1.606 },
      { name: 'O',   el: 'O', x:  0.685, y: -0.742, z:  2.143 },
      { name: 'OXT', el: 'O', x: -1.174, y:  0.443, z:  2.275 },
    ],
    sc: [
      { name: 'CB', el: 'C', x: -0.533, y: -0.530, z: -0.774 },
      { name: 'SG', el: 'S', x: -0.247, y:  0.004, z: -2.484 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1]], scDouble: [],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: 'disulfide',
  },

  // ============================================================
  // METHIONINE (MET) — M
  // Thioether sidechain
  // ============================================================
  M: {
    name: 'Methionine', code3: 'MET',
    bb: [
      { name: 'N',   el: 'N', x: -1.816, y:  0.142, z: -1.166 },
      { name: 'CA',  el: 'C', x: -0.392, y:  0.499, z: -1.214 },
      { name: 'C',   el: 'C', x:  0.206, y:  0.002, z: -2.504 },
      { name: 'O',   el: 'O', x: -0.236, y: -0.989, z: -3.033 },
      { name: 'OXT', el: 'O', x:  1.232, y:  0.661, z: -3.066 },
    ],
    sc: [
      { name: 'CB', el: 'C', x:  0.334, y: -0.145, z: -0.032 },
      { name: 'CG', el: 'C', x: -0.273, y:  0.359, z:  1.277 },
      { name: 'SD', el: 'S', x:  0.589, y: -0.405, z:  2.678 },
      { name: 'CE', el: 'C', x: -0.314, y:  0.353, z:  4.056 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[2,3]], scDouble: [],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // ASPARTATE (ASP) — D
  // Carboxylate sidechain (negative charge at pH 7)
  // ============================================================
  D: {
    name: 'Aspartate', code3: 'ASP',
    bb: [
      { name: 'N',   el: 'N', x: -0.317, y:  1.688, z:  0.066 },
      { name: 'CA',  el: 'C', x: -0.470, y:  0.286, z: -0.344 },
      { name: 'C',   el: 'C', x: -1.868, y: -0.180, z: -0.029 },
      { name: 'O',   el: 'O', x: -2.534, y:  0.415, z:  0.786 },
      { name: 'OXT', el: 'O', x: -2.374, y: -1.256, z: -0.652 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x:  0.539, y: -0.580, z:  0.413 },
      { name: 'CG',  el: 'C', x:  1.938, y: -0.195, z:  0.004 },
      { name: 'OD1', el: 'O', x:  2.109, y:  0.681, z: -0.810 },
      { name: 'OD2', el: 'O', x:  2.992, y: -0.826, z:  0.543 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[1,3]],
    scDouble: [[1,2]],
    bbToSc: [1, 0],
    ringClose: null,
    charge: -1, chargeAtom: 3, special: null,
  },

  // ============================================================
  // GLUTAMATE (GLU) — E
  // Carboxylate sidechain, longer chain (negative charge at pH 7)
  // ============================================================
  E: {
    name: 'Glutamate', code3: 'GLU',
    bb: [
      { name: 'N',   el: 'N', x:  1.199, y:  1.867, z: -0.117 },
      { name: 'CA',  el: 'C', x:  1.138, y:  0.515, z:  0.453 },
      { name: 'C',   el: 'C', x:  2.364, y: -0.260, z:  0.041 },
      { name: 'O',   el: 'O', x:  3.010, y:  0.096, z: -0.916 },
      { name: 'OXT', el: 'O', x:  2.737, y: -1.345, z:  0.737 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x: -0.113, y: -0.200, z: -0.062 },
      { name: 'CG',  el: 'C', x: -1.360, y:  0.517, z:  0.461 },
      { name: 'CD',  el: 'C', x: -2.593, y: -0.187, z: -0.046 },
      { name: 'OE1', el: 'O', x: -2.485, y: -1.161, z: -0.753 },
      { name: 'OE2', el: 'O', x: -3.811, y:  0.269, z:  0.287 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[2,3],[2,4]],
    scDouble: [[2,3]],
    bbToSc: [1, 0],
    ringClose: null,
    charge: -1, chargeAtom: 4, special: null,
  },

  // ============================================================
  // ASPARAGINE (ASN) — N
  // Amide sidechain
  // ============================================================
  N: {
    name: 'Asparagine', code3: 'ASN',
    bb: [
      { name: 'N',   el: 'N', x: -0.293, y:  1.686, z:  0.094 },
      { name: 'CA',  el: 'C', x: -0.448, y:  0.292, z: -0.340 },
      { name: 'C',   el: 'C', x: -1.846, y: -0.179, z: -0.031 },
      { name: 'O',   el: 'O', x: -2.510, y:  0.402, z:  0.794 },
      { name: 'OXT', el: 'O', x: -2.353, y: -1.243, z: -0.673 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x:  0.562, y: -0.588, z:  0.401 },
      { name: 'CG',  el: 'C', x:  1.960, y: -0.197, z: -0.002 },
      { name: 'OD1', el: 'O', x:  2.132, y:  0.697, z: -0.804 },
      { name: 'ND2', el: 'N', x:  3.019, y: -0.841, z:  0.527 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[1,3]],
    scDouble: [[1,2]],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // GLUTAMINE (GLN) — Q
  // Amide sidechain, longer chain
  // ============================================================
  Q: {
    name: 'Glutamine', code3: 'GLN',
    bb: [
      { name: 'N',   el: 'N', x:  1.858, y: -0.148, z:  1.125 },
      { name: 'CA',  el: 'C', x:  0.517, y:  0.451, z:  1.112 },
      { name: 'C',   el: 'C', x: -0.236, y:  0.022, z:  2.344 },
      { name: 'O',   el: 'O', x: -0.005, y: -1.049, z:  2.851 },
      { name: 'OXT', el: 'O', x: -1.165, y:  0.831, z:  2.878 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x: -0.236, y: -0.013, z: -0.135 },
      { name: 'CG',  el: 'C', x:  0.529, y:  0.421, z: -1.385 },
      { name: 'CD',  el: 'C', x: -0.213, y: -0.036, z: -2.614 },
      { name: 'OE1', el: 'O', x: -1.252, y: -0.650, z: -2.500 },
      { name: 'NE2', el: 'N', x:  0.277, y:  0.236, z: -3.839 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[2,3],[2,4]],
    scDouble: [[2,3]],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: null,
  },

  // ============================================================
  // LYSINE (LYS) — K
  // Amino chain sidechain (positive charge at pH 7)
  // ============================================================
  K: {
    name: 'Lysine', code3: 'LYS',
    bb: [
      { name: 'N',   el: 'N', x:  1.422, y:  1.796, z:  0.198 },
      { name: 'CA',  el: 'C', x:  1.394, y:  0.355, z:  0.484 },
      { name: 'C',   el: 'C', x:  2.657, y: -0.284, z: -0.032 },
      { name: 'O',   el: 'O', x:  3.316, y:  0.275, z: -0.876 },
      { name: 'OXT', el: 'O', x:  3.050, y: -1.476, z:  0.446 },
    ],
    sc: [
      { name: 'CB', el: 'C', x:  0.184, y: -0.278, z: -0.206 },
      { name: 'CG', el: 'C', x: -1.102, y:  0.282, z:  0.407 },
      { name: 'CD', el: 'C', x: -2.313, y: -0.351, z: -0.283 },
      { name: 'CE', el: 'C', x: -3.598, y:  0.208, z:  0.329 },
      { name: 'NZ', el: 'N', x: -4.761, y: -0.400, z: -0.332 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[2,3],[3,4]],
    scDouble: [],
    bbToSc: [1, 0],
    ringClose: null,
    charge: +1, chargeAtom: 4, special: null,
  },

  // ============================================================
  // ARGININE (ARG) — R
  // Guanidinium sidechain (positive charge at pH 7)
  // ============================================================
  R: {
    name: 'Arginine', code3: 'ARG',
    bb: [
      { name: 'N',   el: 'N', x: -0.469, y:  1.110, z: -0.993 },
      { name: 'CA',  el: 'C', x:  0.004, y:  2.294, z: -1.708 },
      { name: 'C',   el: 'C', x: -0.907, y:  2.521, z: -2.901 },
      { name: 'O',   el: 'O', x: -1.827, y:  1.789, z: -3.242 },
      { name: 'OXT', el: 'O', x: -0.588, y:  3.659, z: -3.574 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x:  1.475, y:  2.150, z: -2.127 },
      { name: 'CG',  el: 'C', x:  1.745, y:  1.017, z: -3.130 },
      { name: 'CD',  el: 'C', x:  3.210, y:  0.954, z: -3.557 },
      { name: 'NE',  el: 'N', x:  4.071, y:  0.726, z: -2.421 },
      { name: 'CZ',  el: 'C', x:  5.469, y:  0.624, z: -2.528 },
      { name: 'NH1', el: 'N', x:  6.259, y:  0.404, z: -1.405 },
      { name: 'NH2', el: 'N', x:  6.078, y:  0.744, z: -3.773 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[2,3],[3,4],[4,5],[4,6]],
    scDouble: [[4,5]],
    bbToSc: [1, 0],
    ringClose: null,
    charge: +1, chargeAtom: 4, special: null,
  },

  // ============================================================
  // HISTIDINE (HIS) — H
  // Imidazole ring sidechain (pH-dependent charge)
  // ============================================================
  H: {
    name: 'Histidine', code3: 'HIS',
    bb: [
      { name: 'N',   el: 'N', x: -0.040, y: -1.210, z:  0.053 },
      { name: 'CA',  el: 'C', x:  1.172, y: -1.709, z:  0.652 },
      { name: 'C',   el: 'C', x:  1.083, y: -3.207, z:  0.905 },
      { name: 'O',   el: 'O', x:  0.040, y: -3.770, z:  1.222 },
      { name: 'OXT', el: 'O', x:  2.247, y: -3.882, z:  0.744 },
    ],
    sc: [
      { name: 'CB',  el: 'C', x:  1.484, y: -0.975, z:  1.962 },
      { name: 'CG',  el: 'C', x:  2.940, y: -1.060, z:  2.353 },
      { name: 'ND1', el: 'N', x:  3.380, y: -2.075, z:  3.129 },
      { name: 'CD2', el: 'C', x:  3.960, y: -0.251, z:  2.046 },
      { name: 'CE1', el: 'C', x:  4.693, y: -1.908, z:  3.317 },
      { name: 'NE2', el: 'N', x:  5.058, y: -0.801, z:  2.662 },
    ],
    bbBonds: [[0,1,false],[1,2,false],[2,3,true],[2,4,false]],
    scBonds: [[0,1],[1,2],[1,3],[2,4],[3,5],[4,5]],
    scDouble: [[1,2],[3,5]],
    bbToSc: [1, 0],
    ringClose: null,
    charge: 0, chargeAtom: -1, special: 'phSwitch',
  },
};

// ============================================================
// Convenience: extract just the 1-letter codes
// ============================================================
export const AA_LETTERS = Object.keys(AMINO_ACIDS);

// ============================================================
// Helper: get all heavy atoms (bb + sc) for an amino acid as flat array
// Each atom gets: {name, el, x, y, z, isBB: bool}
// ============================================================
export function getAllAtoms(letter) {
  const aa = AMINO_ACIDS[letter];
  if (!aa) return [];
  const atoms = [];
  for (const a of aa.bb) {
    atoms.push({ ...a, isBB: true });
  }
  for (const a of aa.sc) {
    atoms.push({ ...a, isBB: false });
  }
  return atoms;
}

// ============================================================
// Helper: get all bonds for an amino acid as flat array
// Each bond: {from: atomIdx, to: atomIdx, isDouble: bool}
// Indices are into the flat array from getAllAtoms()
// ============================================================
export function getAllBonds(letter) {
  const aa = AMINO_ACIDS[letter];
  if (!aa) return [];
  const bbLen = aa.bb.length;
  const bonds = [];

  // Backbone bonds
  for (const [a, b, dbl] of aa.bbBonds) {
    bonds.push({ from: a, to: b, isDouble: dbl });
  }

  // CA -> CB (backbone to sidechain)
  if (aa.bbToSc && aa.sc.length > 0) {
    bonds.push({ from: aa.bbToSc[0], to: bbLen + aa.bbToSc[1], isDouble: false });
  }

  // Sidechain bonds
  for (const [a, b] of aa.scBonds) {
    const isDouble = aa.scDouble.some(([da, db]) => da === a && db === b);
    bonds.push({ from: a + bbLen, to: b + bbLen, isDouble });
  }

  // Ring closure (Proline)
  if (aa.ringClose) {
    bonds.push({ from: aa.ringClose[0] + bbLen, to: aa.ringClose[1], isDouble: false });
  }

  return bonds;
}
