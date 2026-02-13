// ============================================================
// StickRepresentation.js — Thick bonds (0.2 A) + junction spheres
// Junction spheres are uniform-sized atom spheres at each atom position.
// ============================================================

import { BaseRepresentation } from './BaseRepresentation.js';
import { createAtomInstances, createBondInstances, updateAtomColors, updateBondColors } from '../atomRenderer.js';
import { extractBaseScales, extractBaseBondTransforms, applyAtomVisibility, applyBondVisibility } from './visibilityHelpers.js';

import * as THREE from 'three';

const STICK_RADIUS = 0.2;

export class StickRepresentation extends BaseRepresentation {
  build() {
    const { model, bonds, materials, viewerGroup } = this;

    // Junction spheres: atom InstancedMesh with uniform radius (matching stick thickness)
    // We use createAtomInstances with a tiny scale, then override all scales to uniform STICK_RADIUS
    this.atomMesh = createAtomInstances(model, materials.atom, 0.3); // temp scale
    this._overrideAtomScales(model);
    viewerGroup.add(this.atomMesh);
    this.meshes.push(this.atomMesh);

    // Bonds at STICK_RADIUS
    this.bondMesh = createBondInstances(model, bonds, materials.bond, STICK_RADIUS);
    if (this.bondMesh) {
      viewerGroup.add(this.bondMesh);
      this.meshes.push(this.bondMesh);
    }

    // Extract base scales for visibility
    this.baseScales = extractBaseScales(this.atomMesh, model.atomCount);
    if (this.bondMesh) {
      const bt = extractBaseBondTransforms(this.bondMesh, this.bondMesh.count);
      this.baseBondScales = bt.scales;
      this.baseBondPositions = bt.positions;
      this.baseBondQuats = bt.quaternions;
    }
  }

  /**
   * Override all atom instance scales to uniform STICK_RADIUS.
   */
  _overrideAtomScales(model) {
    const _mat = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scl = new THREE.Vector3();

    for (let i = 0; i < model.atomCount; i++) {
      this.atomMesh.getMatrixAt(i, _mat);
      _mat.decompose(_pos, _quat, _scl);
      _scl.set(STICK_RADIUS, STICK_RADIUS, STICK_RADIUS);
      _mat.compose(_pos, _quat, _scl);
      this.atomMesh.setMatrixAt(i, _mat);
    }
    this.atomMesh.instanceMatrix.needsUpdate = true;
  }

  applyColors(atomColors) {
    updateAtomColors(this.atomMesh, atomColors);
    if (this.bondMesh && this.bonds) {
      updateBondColors(this.bondMesh, this.bonds, atomColors);
    }
  }

  applyVisibility(atomVisible, scaleMultipliers = null) {
    applyAtomVisibility(this.atomMesh, atomVisible, this.baseScales, scaleMultipliers, this.model.positions);
    if (this.bondMesh && this.bonds && this.baseBondScales) {
      applyBondVisibility(this.bondMesh, this.bonds, atomVisible, this.baseBondScales, this.baseBondPositions, this.baseBondQuats, scaleMultipliers);
    }
  }
}
