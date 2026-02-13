// ============================================================
// BaseRepresentation.js — Abstract base for molecular representations
// Each subclass implements build(), applyColors(), applyVisibility().
// ============================================================

/**
 * Base class for molecular representations.
 * Subclasses must override build(), applyColors(), applyVisibility().
 */
export class BaseRepresentation {
  /**
   * @param {Object} model - Parsed PDB model
   * @param {Uint32Array} bonds - Flat bond pairs
   * @param {{ atom: THREE.Material, bond: THREE.Material }} materials
   * @param {THREE.Group} viewerGroup - Group to add meshes to
   */
  constructor(model, bonds, materials, viewerGroup) {
    this.model = model;
    this.bonds = bonds;
    this.materials = materials;
    this.viewerGroup = viewerGroup;
    this.meshes = [];     // All meshes owned by this rep
    this.atomMesh = null; // Primary atom InstancedMesh (if any)
    this.bondMesh = null; // Primary bond InstancedMesh (if any)
    this.baseScales = null;
    this.baseBondScales = null;
    this.baseBondPositions = null;
    this.baseBondQuats = null;
  }

  /** Build meshes and add to viewerGroup. */
  build() {
    throw new Error('build() must be implemented by subclass');
  }

  /**
   * Apply per-atom colors.
   * @param {THREE.Color[]} atomColors
   */
  applyColors(atomColors) {
    throw new Error('applyColors() must be implemented by subclass');
  }

  /**
   * Apply per-atom visibility.
   * @param {Uint8Array} atomVisible
   * @param {Float32Array|null} [scaleMultipliers=null] - Per-atom scale multipliers
   */
  applyVisibility(atomVisible, scaleMultipliers = null) {
    throw new Error('applyVisibility() must be implemented by subclass');
  }

  /** @returns {THREE.InstancedMesh|null} */
  getAtomMesh() { return this.atomMesh; }

  /** @returns {THREE.InstancedMesh|null} */
  getBondMesh() { return this.bondMesh; }

  /** @returns {Float32Array|null} */
  getBaseScales() { return this.baseScales; }

  /** @returns {THREE.Vector3[]|null} */
  getBaseBondScales() { return this.baseBondScales; }

  /** @returns {THREE.Vector3[]|null} */
  getBaseBondPositions() { return this.baseBondPositions; }

  /** @returns {THREE.Quaternion[]|null} */
  getBaseBondQuats() { return this.baseBondQuats; }

  /** Dispose all meshes and remove from viewerGroup. */
  dispose() {
    for (const mesh of this.meshes) {
      this.viewerGroup.remove(mesh);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.dispose) mesh.dispose();
    }
    this.meshes = [];
    this.atomMesh = null;
    this.bondMesh = null;
    this.baseScales = null;
    this.baseBondScales = null;
    this.baseBondPositions = null;
    this.baseBondQuats = null;
  }
}
