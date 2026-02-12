// ============================================================
// materials.js — Enhanced PBR materials for PDB viewer
// MeshStandardMaterial with tuned roughness, low metalness,
// and environment map reflections for cinematic rendering.
// ============================================================

import * as THREE from 'three';

/**
 * Create the enhanced atom material.
 * MeshStandardMaterial with environment reflections.
 * Base color is white so InstancedMesh instance colors show through.
 *
 * @param {THREE.Texture|null} envMap - Pre-filtered environment map
 * @returns {THREE.MeshStandardMaterial}
 */
export function createAtomMaterial(envMap) {
  return new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.35,
    metalness: 0.05,
    envMap: envMap || null,
    envMapIntensity: 0.6,
  });
}

/**
 * Create the enhanced bond material.
 * Slightly darker than atoms with lower roughness for a sleek look.
 *
 * @param {THREE.Texture|null} envMap - Pre-filtered environment map
 * @returns {THREE.MeshStandardMaterial}
 */
export function createBondMaterial(envMap) {
  return new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.25,
    metalness: 0.05,
    envMap: envMap || null,
    envMapIntensity: 0.4,
  });
}
