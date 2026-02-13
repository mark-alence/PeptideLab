// ============================================================
// SpacefillRepresentation.js — Full VDW radius atoms, no bonds
// Looks great with SSAO post-processing.
// ============================================================

import { BaseRepresentation } from './BaseRepresentation.js';
import { createAtomInstances, updateAtomColors } from '../atomRenderer.js';
import { extractBaseScales, applyAtomVisibility } from './visibilityHelpers.js';

export class SpacefillRepresentation extends BaseRepresentation {
  build() {
    const { model, materials, viewerGroup } = this;

    // Atoms at full VDW radius (1.0x)
    this.atomMesh = createAtomInstances(model, materials.atom, 1.0);
    viewerGroup.add(this.atomMesh);
    this.meshes.push(this.atomMesh);

    // No bonds in spacefill mode
    this.bondMesh = null;

    // Extract base scales
    this.baseScales = extractBaseScales(this.atomMesh, model.atomCount);
  }

  applyColors(atomColors) {
    updateAtomColors(this.atomMesh, atomColors);
  }

  applyVisibility(atomVisible, scaleMultipliers = null) {
    applyAtomVisibility(this.atomMesh, atomVisible, this.baseScales, scaleMultipliers, this.model.positions);
  }
}
