// ============================================================
// visibilityHelpers.js — Shared visibility/scale utilities
// Scale-to-zero pattern for InstancedMesh show/hide.
// ============================================================

import * as THREE from 'three';

const _mat = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _scl = new THREE.Vector3();

/**
 * Extract base scales (uniform) from an atom InstancedMesh.
 * @param {THREE.InstancedMesh} mesh
 * @param {number} count
 * @returns {Float32Array}
 */
export function extractBaseScales(mesh, count) {
  const scales = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    mesh.getMatrixAt(i, _mat);
    _mat.decompose(_pos, _quat, _scl);
    scales[i] = _scl.x; // uniform scale
  }
  return scales;
}

/**
 * Extract base scales (non-uniform Vector3) from a bond InstancedMesh.
 * @param {THREE.InstancedMesh} mesh
 * @param {number} count
 * @returns {THREE.Vector3[]}
 */
export function extractBaseBondScales(mesh, count) {
  const scales = new Array(count);
  for (let i = 0; i < count; i++) {
    mesh.getMatrixAt(i, _mat);
    _mat.decompose(_pos, _quat, _scl);
    scales[i] = new THREE.Vector3().copy(_scl);
  }
  return scales;
}

/**
 * Apply atom visibility using scale-to-zero pattern.
 * @param {THREE.InstancedMesh} atomMesh
 * @param {Uint8Array} atomVisible
 * @param {Float32Array} baseScales
 */
export function applyAtomVisibility(atomMesh, atomVisible, baseScales) {
  for (let i = 0; i < atomVisible.length; i++) {
    atomMesh.getMatrixAt(i, _mat);
    _mat.decompose(_pos, _quat, _scl);
    const s = atomVisible[i] ? baseScales[i] : 0;
    _scl.set(s, s, s);
    _mat.compose(_pos, _quat, _scl);
    atomMesh.setMatrixAt(i, _mat);
  }
  atomMesh.instanceMatrix.needsUpdate = true;
}

/**
 * Apply bond visibility using scale-to-zero pattern.
 * Hides bonds where either atom endpoint is hidden.
 * @param {THREE.InstancedMesh} bondMesh
 * @param {Uint32Array} bonds - Flat pairs [a0,b0, a1,b1, ...]
 * @param {Uint8Array} atomVisible
 * @param {THREE.Vector3[]} baseBondScales
 */
export function applyBondVisibility(bondMesh, bonds, atomVisible, baseBondScales) {
  const bondCount = bonds.length / 2;
  for (let bi = 0; bi < bondCount; bi++) {
    const ai = bonds[bi * 2];
    const aj = bonds[bi * 2 + 1];
    const visible = atomVisible[ai] && atomVisible[aj];

    for (let half = 0; half < 2; half++) {
      const idx = bi * 2 + half;
      bondMesh.getMatrixAt(idx, _mat);
      _mat.decompose(_pos, _quat, _scl);
      if (visible) {
        _scl.copy(baseBondScales[idx]);
      } else {
        _scl.set(0, 0, 0);
      }
      _mat.compose(_pos, _quat, _scl);
      bondMesh.setMatrixAt(idx, _mat);
    }
  }
  bondMesh.instanceMatrix.needsUpdate = true;
}
