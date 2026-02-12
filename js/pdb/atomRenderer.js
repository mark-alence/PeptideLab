// ============================================================
// atomRenderer.js — InstancedMesh rendering for PDB structures
// Single draw call for all atoms, single draw call for all bonds.
// Handles 10K+ atoms at 60 FPS.
// ============================================================

import * as THREE from 'three';

// PyMOL-inspired element colors — bright, saturated, visible on dark backgrounds
const ELEMENT_COLORS = {
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
const DEFAULT_COLOR = 0xFF69B4;

// Van der Waals radii in Angstroms
const VDW_RADII = {
  H: 1.20, C: 1.70, N: 1.55, O: 1.52, S: 1.80, P: 1.80,
  FE: 2.00, ZN: 1.39, MG: 1.73, CA: 2.31, CL: 1.75, BR: 1.85,
  SE: 1.90, F: 1.47, NA: 2.27, K: 2.75,
};
const DEFAULT_VDW = 1.70;

// Shared geometry instances
const atomGeometry = new THREE.IcosahedronGeometry(1, 2);
const bondGeometry = new THREE.CylinderGeometry(1, 1, 1, 6);
// Shift cylinder so bottom is at origin, extends along +Y
bondGeometry.translate(0, 0.5, 0);

// Temp objects for matrix calculations
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _scale = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _color = new THREE.Color();

/**
 * Create the standard atom material.
 * InstancedMesh colors multiply against the material color,
 * so we set it to white to let instance colors show through.
 */
export function createAtomMaterial() {
  return new THREE.MeshPhongMaterial({
    color: 0xffffff,
    shininess: 80,
    specular: 0x444444,
  });
}

/**
 * Create the standard bond material.
 */
export function createBondMaterial() {
  return new THREE.MeshPhongMaterial({
    color: 0xffffff,
    shininess: 40,
    specular: 0x222222,
  });
}

/**
 * Create InstancedMesh for atoms.
 *
 * @param {Object} model - Parsed PDB model
 * @param {THREE.Material} material - Shared material
 * @param {number} [radiusScale=0.3] - Multiplier on VDW radius (0.3 for ball-and-stick)
 * @returns {THREE.InstancedMesh}
 */
export function createAtomInstances(model, material, radiusScale = 0.3) {
  const { atoms, positions } = model;
  const count = atoms.length;
  const mesh = new THREE.InstancedMesh(atomGeometry, material, count);
  mesh.name = 'pdb-atoms';

  for (let i = 0; i < count; i++) {
    const r = (VDW_RADII[atoms[i].element] || DEFAULT_VDW) * radiusScale;
    _pos.set(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    _scale.set(r, r, r);
    _mat4.compose(_pos, _quat.identity(), _scale);
    mesh.setMatrixAt(i, _mat4);

    const hex = ELEMENT_COLORS[atoms[i].element] || DEFAULT_COLOR;
    _color.setHex(hex);
    mesh.setColorAt(i, _color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Create InstancedMesh for bonds.
 *
 * @param {Object} model - Parsed PDB model
 * @param {Uint32Array} bonds - Flat pairs [a0,b0, a1,b1, ...]
 * @param {THREE.Material} material - Shared material
 * @param {number} [bondRadius=0.1] - Cylinder radius in Angstroms
 * @returns {THREE.InstancedMesh}
 */
export function createBondInstances(model, bonds, material, bondRadius = 0.1) {
  const { positions, atoms } = model;
  const bondCount = bonds.length / 2;
  if (bondCount === 0) return null;

  // Each bond gets two half-cylinders (one per atom color)
  const totalInstances = bondCount * 2;
  const mesh = new THREE.InstancedMesh(bondGeometry, material, totalInstances);
  mesh.name = 'pdb-bonds';

  for (let bi = 0; bi < bondCount; bi++) {
    const ai = bonds[bi * 2];
    const aj = bonds[bi * 2 + 1];

    const ax = positions[ai * 3], ay = positions[ai * 3 + 1], az = positions[ai * 3 + 2];
    const bx = positions[aj * 3], by = positions[aj * 3 + 1], bz = positions[aj * 3 + 2];

    const mx = (ax + bx) * 0.5;
    const my = (ay + by) * 0.5;
    const mz = (az + bz) * 0.5;

    _dir.set(bx - ax, by - ay, bz - az);
    const fullLen = _dir.length();
    if (fullLen < 0.001) continue;
    _dir.normalize();

    const halfLen = fullLen * 0.5;
    _quat.setFromUnitVectors(_up, _dir);

    // First half: from atom A to midpoint (colored by atom A)
    _pos.set(ax, ay, az);
    _scale.set(bondRadius, halfLen, bondRadius);
    _mat4.compose(_pos, _quat, _scale);
    const idx1 = bi * 2;
    mesh.setMatrixAt(idx1, _mat4);
    _color.setHex(ELEMENT_COLORS[atoms[ai].element] || DEFAULT_COLOR);
    mesh.setColorAt(idx1, _color);

    // Second half: from midpoint to atom B (colored by atom B)
    _pos.set(mx, my, mz);
    _scale.set(bondRadius, halfLen, bondRadius);
    _mat4.compose(_pos, _quat, _scale);
    const idx2 = bi * 2 + 1;
    mesh.setMatrixAt(idx2, _mat4);
    _color.setHex(ELEMENT_COLORS[atoms[aj].element] || DEFAULT_COLOR);
    mesh.setColorAt(idx2, _color);
  }

  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.frustumCulled = false;
  return mesh;
}

/**
 * Update atom instance colors from an array of THREE.Color values.
 * Used by color scheme switching.
 */
export function updateAtomColors(mesh, colors) {
  for (let i = 0; i < colors.length; i++) {
    mesh.setColorAt(i, colors[i]);
  }
  mesh.instanceColor.needsUpdate = true;
}

/**
 * Update bond instance colors to match atom colors (split coloring).
 */
export function updateBondColors(mesh, bonds, atomColors) {
  const bondCount = bonds.length / 2;
  for (let bi = 0; bi < bondCount; bi++) {
    mesh.setColorAt(bi * 2, atomColors[bonds[bi * 2]]);
    mesh.setColorAt(bi * 2 + 1, atomColors[bonds[bi * 2 + 1]]);
  }
  mesh.instanceColor.needsUpdate = true;
}

// Re-export for use by color schemes
export { ELEMENT_COLORS, VDW_RADII };
