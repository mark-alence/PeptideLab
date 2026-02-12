// ============================================================
// constants.js — Shared constants for PDB viewer
// Element colors, VDW radii, secondary structure colors,
// and representation type enum.
// ============================================================

// PyMOL-inspired element colors — bright, saturated, visible on dark backgrounds
export const ELEMENT_COLORS = {
  C:  0x33FF33, // bright green (PyMOL default carbon)
  N:  0x3333FF, // vivid blue
  O:  0xFF4444, // bright red
  S:  0xFFFF33, // yellow
  H:  0xFFFFFF, // white
  P:  0xFF8C00, // orange
  FE: 0xFF8C00, // orange
  ZN: 0x7D80B0, // purple-gray
  MG: 0x55FF55, // light green
  CA: 0x55FF55, // light green
  CL: 0x33FF33, // green
  BR: 0xA62929, // dark red
  SE: 0xFFA100, // orange
  NA: 0xAB5CF2, // purple
  K:  0x8F40D4, // purple
  MN: 0x9C7AC7, // purple
  CO: 0xF090A0, // pink
  NI: 0x50D050, // green
  CU: 0xC88033, // copper
  F:  0x90E050, // green-yellow
};
export const DEFAULT_COLOR = 0xFF69B4;

// Van der Waals radii in Angstroms
export const VDW_RADII = {
  H: 1.20, C: 1.70, N: 1.55, O: 1.52, S: 1.80, P: 1.80,
  FE: 2.00, ZN: 1.39, MG: 1.73, CA: 2.31, CL: 1.75, BR: 1.85,
  SE: 1.90, F: 1.47, NA: 2.27, K: 2.75,
};
export const DEFAULT_VDW = 1.70;

// Secondary structure colors (for cartoon representation)
export const SS_COLORS = {
  0: 0xCCCCCC, // coil — gray
  1: 0xFF4466, // helix — red-pink
  2: 0xFFDD44, // sheet — yellow
};

// Representation types
export const REP_TYPES = {
  BALL_AND_STICK: 'ball_and_stick',
  SPACEFILL:      'spacefill',
  STICK:          'sticks',
  CARTOON:        'cartoon',
  LINES:          'lines',
};
