// ============================================================
// residueTemplates.js — Standard amino acid intra-residue bond tables
// Used by bondInference.js to determine bonds within known residues
// without expensive distance calculations.
//
// Each entry maps atom name pairs that should be bonded.
// Derived from PDB Chemical Component Dictionary ideal geometries.
// ============================================================

// Backbone bonds (shared by all standard amino acids)
const BB_BONDS = [
  ['N', 'CA'],
  ['CA', 'C'],
  ['C', 'O'],
  ['C', 'OXT'],  // terminal oxygen — may not be present
];

// Sidechain bonds per residue type (atom name → atom name)
const SC_BONDS = {
  GLY: [],
  ALA: [['CA', 'CB']],
  VAL: [['CA', 'CB'], ['CB', 'CG1'], ['CB', 'CG2']],
  LEU: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD1'], ['CG', 'CD2']],
  ILE: [['CA', 'CB'], ['CB', 'CG1'], ['CB', 'CG2'], ['CG1', 'CD1']],
  PRO: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'N']],
  PHE: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD1'], ['CG', 'CD2'],
        ['CD1', 'CE1'], ['CD2', 'CE2'], ['CE1', 'CZ'], ['CE2', 'CZ']],
  TYR: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD1'], ['CG', 'CD2'],
        ['CD1', 'CE1'], ['CD2', 'CE2'], ['CE1', 'CZ'], ['CE2', 'CZ'], ['CZ', 'OH']],
  TRP: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD1'], ['CG', 'CD2'],
        ['CD1', 'NE1'], ['NE1', 'CE2'], ['CD2', 'CE2'], ['CD2', 'CE3'],
        ['CE2', 'CZ2'], ['CE3', 'CZ3'], ['CZ2', 'CH2'], ['CZ3', 'CH2']],
  SER: [['CA', 'CB'], ['CB', 'OG']],
  THR: [['CA', 'CB'], ['CB', 'OG1'], ['CB', 'CG2']],
  CYS: [['CA', 'CB'], ['CB', 'SG']],
  MET: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'SD'], ['SD', 'CE']],
  ASP: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'OD1'], ['CG', 'OD2']],
  GLU: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'OE1'], ['CD', 'OE2']],
  ASN: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'OD1'], ['CG', 'ND2']],
  GLN: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'OE1'], ['CD', 'NE2']],
  LYS: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'CE'], ['CE', 'NZ']],
  ARG: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'CD'], ['CD', 'NE'],
        ['NE', 'CZ'], ['CZ', 'NH1'], ['CZ', 'NH2']],
  HIS: [['CA', 'CB'], ['CB', 'CG'], ['CG', 'ND1'], ['CG', 'CD2'],
        ['ND1', 'CE1'], ['CD2', 'NE2'], ['CE1', 'NE2']],
};

// Common nucleotide names to skip (not amino acids)
const NUCLEOTIDES = new Set([
  'A', 'C', 'G', 'T', 'U', 'DA', 'DC', 'DG', 'DT', 'DU',
  'ADE', 'CYT', 'GUA', 'THY', 'URA',
]);

/**
 * Get all expected bonds for a standard amino acid residue.
 * Returns an array of [atomName1, atomName2] pairs, or null if not a standard AA.
 */
export function getTemplateBonds(resName) {
  const sc = SC_BONDS[resName];
  if (!sc) return null;
  return [...BB_BONDS, ...sc];
}

export function isStandardAA(resName) {
  return resName in SC_BONDS;
}

export function isNucleotide(resName) {
  return NUCLEOTIDES.has(resName);
}
