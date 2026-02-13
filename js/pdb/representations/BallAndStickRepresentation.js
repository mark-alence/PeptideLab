// ============================================================
// BallAndStickRepresentation.js — Atoms at 0.3x VDW + bonds at 0.1 A
// Default representation, direct port of original _buildMeshes().
// ============================================================

import { BaseRepresentation } from './BaseRepresentation.js';
import { createAtomInstances, createBondInstances, updateAtomColors, updateBondColors } from '../atomRenderer.js';
import { extractBaseScales, extractBaseBondTransforms, applyAtomVisibility, applyBondVisibility } from './visibilityHelpers.js';

export class BallAndStickRepresentation extends BaseRepresentation {
  build() {
    const { model, bonds, materials, viewerGroup } = this;

    // Atoms at 0.3x VDW radius
    this.atomMesh = createAtomInstances(model, materials.atom, 0.3);
    viewerGroup.add(this.atomMesh);
    this.meshes.push(this.atomMesh);

    // Bonds at 0.1 A radius
    this.bondMesh = createBondInstances(model, bonds, materials.bond, 0.1);
    if (this.bondMesh) {
      viewerGroup.add(this.bondMesh);
      this.meshes.push(this.bondMesh);
    }

    // Extract base scales for visibility toggling
    this.baseScales = extractBaseScales(this.atomMesh, model.atomCount);
    if (this.bondMesh) {
      const bt = extractBaseBondTransforms(this.bondMesh, this.bondMesh.count);
      this.baseBondScales = bt.scales;
      this.baseBondPositions = bt.positions;
      this.baseBondQuats = bt.quaternions;
    }
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
