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
 * Extract full transforms (position, quaternion, scale) from a bond InstancedMesh.
 * Stored at build time so we can recompose without decomposing zero-scale matrices.
 * @param {THREE.InstancedMesh} mesh
 * @param {number} count
 * @returns {{ scales: THREE.Vector3[], positions: THREE.Vector3[], quaternions: THREE.Quaternion[] }}
 */
export function extractBaseBondTransforms(mesh, count) {
  const scales = new Array(count);
  const positions = new Array(count);
  const quaternions = new Array(count);
  for (let i = 0; i < count; i++) {
    mesh.getMatrixAt(i, _mat);
    _mat.decompose(_pos, _quat, _scl);
    scales[i] = new THREE.Vector3().copy(_scl);
    positions[i] = new THREE.Vector3().copy(_pos);
    quaternions[i] = new THREE.Quaternion().copy(_quat);
  }
  return { scales, positions, quaternions };
}

/**
 * Apply atom visibility using scale-to-zero pattern.
 * Always reads positions from the canonical model positions array
 * (avoids reading stale positions from zero-scale matrices).
 * Hidden atoms are moved offscreen AND scaled to zero for robustness.
 *
 * @param {THREE.InstancedMesh} atomMesh
 * @param {Uint8Array} atomVisible
 * @param {Float32Array} baseScales
 * @param {Float32Array|null} [scaleMultipliers=null] - Per-atom scale multipliers (default 1.0)
 * @param {Float32Array|null} [modelPositions=null] - Flat xyz positions from model (canonical source of truth)
 */
export function applyAtomVisibility(atomMesh, atomVisible, baseScales, scaleMultipliers = null, modelPositions = null) {
  for (let i = 0; i < atomVisible.length; i++) {
    if (modelPositions) {
      _pos.set(modelPositions[i * 3], modelPositions[i * 3 + 1], modelPositions[i * 3 + 2]);
    } else {
      atomMesh.getMatrixAt(i, _mat);
      _pos.setFromMatrixPosition(_mat);
    }
    if (atomVisible[i]) {
      const s = baseScales[i] * (scaleMultipliers ? scaleMultipliers[i] : 1);
      _scl.set(s, s, s);
    } else {
      // Move offscreen AND scale to zero — prevents depth/rendering artifacts
      // when multiple InstancedMeshes share atom positions
      _pos.set(0, -99999, 0);
      _scl.set(0, 0, 0);
    }
    _quat.identity();
    _mat.compose(_pos, _quat, _scl);
    atomMesh.setMatrixAt(i, _mat);
  }
  atomMesh.instanceMatrix.needsUpdate = true;
}

/**
 * Apply bond visibility using scale-to-zero pattern.
 * Hides bonds where either atom endpoint is hidden.
 * Recomposes from stored base transforms to avoid decomposing zero-scale matrices.
 * @param {THREE.InstancedMesh} bondMesh
 * @param {Uint32Array} bonds - Flat pairs [a0,b0, a1,b1, ...]
 * @param {Uint8Array} atomVisible
 * @param {THREE.Vector3[]} baseBondScales
 * @param {THREE.Vector3[]} baseBondPositions
 * @param {THREE.Quaternion[]} baseBondQuats
 * @param {Float32Array|null} [scaleMultipliers=null] - Per-atom scale multipliers (default 1.0)
 */
export function applyBondVisibility(bondMesh, bonds, atomVisible, baseBondScales, baseBondPositions, baseBondQuats, scaleMultipliers = null) {
  const bondCount = bonds.length / 2;
  for (let bi = 0; bi < bondCount; bi++) {
    const ai = bonds[bi * 2];
    const aj = bonds[bi * 2 + 1];
    const visible = atomVisible[ai] && atomVisible[aj];

    // Average multiplier from both bond endpoints (radius scaling)
    const radMul = (visible && scaleMultipliers)
      ? (scaleMultipliers[ai] + scaleMultipliers[aj]) * 0.5
      : 1;

    for (let half = 0; half < 2; half++) {
      const idx = bi * 2 + half;
      if (visible) {
        _scl.set(
          baseBondScales[idx].x * radMul,
          baseBondScales[idx].y * radMul,
          baseBondScales[idx].z          // Z (length) unchanged
        );
      } else {
        _scl.set(0, 0, 0);
      }
      _mat.compose(baseBondPositions[idx], baseBondQuats[idx], _scl);
      bondMesh.setMatrixAt(idx, _mat);
    }
  }
  bondMesh.instanceMatrix.needsUpdate = true;
}
