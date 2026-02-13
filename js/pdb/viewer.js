// ============================================================
// viewer.js — PDB Viewer mode controller
// Manages parsed protein model, representation rendering,
// camera setup, cinematic lighting, post-processing, and
// cleanup for mode switching.
// Supports loading multiple structures via StructureManager.
// ============================================================

import * as THREE from 'three';
import { parsePDB } from './parser.js';
import { inferBonds } from './bondInference.js';
import { ELEMENT_COLORS, DEFAULT_COLOR, REP_TYPES } from './constants.js';
import { StructureManager } from './structureManager.js';
import { createAtomMaterial, createBondMaterial } from './materials.js';
import { createViewerLighting, removeViewerLighting, createEnvironmentMap, createRadialGradientBackground } from './lighting.js';
import { PostProcessingPipeline } from './postProcessing.js';

import { BallAndStickRepresentation } from './representations/BallAndStickRepresentation.js';
import { SpacefillRepresentation } from './representations/SpacefillRepresentation.js';
import { StickRepresentation } from './representations/StickRepresentation.js';
import { CartoonRepresentation } from './representations/CartoonRepresentation.js';
import { LinesRepresentation } from './representations/LinesRepresentation.js';

const REP_CLASSES = {
  [REP_TYPES.BALL_AND_STICK]: BallAndStickRepresentation,
  [REP_TYPES.SPACEFILL]:      SpacefillRepresentation,
  [REP_TYPES.STICK]:          StickRepresentation,
  [REP_TYPES.CARTOON]:        CartoonRepresentation,
  [REP_TYPES.LINES]:          LinesRepresentation,
};

/**
 * PDBViewer — controls the viewer mode lifecycle.
 * Created once when entering viewer mode, disposed when leaving.
 */
export class PDBViewer {
  constructor(scene, camera, controls, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.renderer = renderer;

    this.model = null;
    this.bonds = null;
    this.activeRep = null;
    this.currentRepType = REP_TYPES.BALL_AND_STICK;

    // Multi-structure support
    this.structureManager = new StructureManager();

    // Legacy refs for compatibility (some code may still check these)
    this.atomMesh = null;
    this.bondMesh = null;

    this.lights = [];
    this.viewerGroup = new THREE.Group();
    this.viewerGroup.name = 'pdb-viewer';
    this.scene.add(this.viewerGroup);

    // Environment map for PBR reflections
    this.envMap = createEnvironmentMap(renderer);

    // Enhanced PBR materials
    this.atomMaterial = createAtomMaterial(this.envMap);
    this.bondMaterial = createBondMaterial(this.envMap);

    // Dark radial gradient background
    this.backgroundTexture = createRadialGradientBackground();
    this.scene.background = this.backgroundTexture;

    // Post-processing pipeline
    this.postProcessing = new PostProcessingPipeline(renderer, scene, camera);

    // Resize handler
    this._onResize = () => {
      const w = window.visualViewport?.width ?? window.innerWidth;
      const h = window.visualViewport?.height ?? window.innerHeight;
      this.postProcessing.setSize(w, h);
    };
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', this._onResize);
    } else {
      window.addEventListener('resize', this._onResize);
    }
  }

  /**
   * Load and render a PDB structure from text.
   * Clears any existing structures, then adds this one.
   *
   * @param {string} pdbText - Raw PDB file content
   * @param {string} [name] - Optional structure name
   * @returns {{ model, bonds }} or null if parse failed
   */
  loadFromText(pdbText, name) {
    this.clearStructure();
    return this.addStructure(pdbText, name);
  }

  /**
   * Add an additional PDB structure (multi-structure support).
   * Parses the PDB, registers it, and rebuilds the merged state.
   *
   * @param {string} pdbText - Raw PDB file content
   * @param {string} [name] - Optional structure name
   * @returns {{ model, bonds, name: string }} or null if parse failed
   */
  addStructure(pdbText, name) {
    const model = parsePDB(pdbText);
    if (!model) return null;

    const bonds = inferBonds(model);
    const structName = name || model.header?.pdbId || 'structure';
    const actualName = this.structureManager.addStructure(structName, model, bonds);

    this._rebuildMergedState();
    this._applyStructureColor(actualName);
    this._centerCamera();

    return { model: this.model, bonds: this.bonds, name: actualName };
  }

  /**
   * Remove a structure by name and rebuild.
   *
   * @param {string} name - Structure name to remove
   * @returns {boolean} true if removed
   */
  removeStructure(name) {
    if (!this.structureManager.removeStructure(name)) return false;

    if (this.structureManager.count === 0) {
      this.clearStructure();
      return true;
    }

    this._rebuildMergedState();
    this._centerCamera();
    return true;
  }

  /**
   * Rebuild merged model/bonds from the structure manager,
   * resize state arrays, and rebuild representations.
   */
  _rebuildMergedState() {
    // Dispose current rep
    if (this.activeRep) {
      this.activeRep.dispose();
      this.activeRep = null;
    }

    this.model = this.structureManager.buildMergedModel();
    this.bonds = this.structureManager.buildMergedBonds();

    if (!this.model) return;

    this._buildMeshes();
    this._resizeStateArrays();
  }

  /**
   * Initialize or resize per-atom state arrays to match the current model.
   * Preserves element colors, sets new atoms to element defaults.
   */
  _resizeStateArrays() {
    const n = this.model.atomCount;
    const { atoms } = this.model;

    // Colors: always rebuild from element defaults
    this.atomColors = new Array(n);
    for (let i = 0; i < n; i++) {
      this.atomColors[i] = new THREE.Color(ELEMENT_COLORS[atoms[i].element] || DEFAULT_COLOR);
    }

    // Visibility: all visible
    this.atomVisible = new Uint8Array(n).fill(1);

    // Base scales from active rep
    this.baseScales = this.activeRep ? this.activeRep.getBaseScales() : null;
    this.baseBondScales = this.activeRep ? this.activeRep.getBaseBondScales() : null;

    this._radiusScale = 0.3;
    this._representation = 'sticks';

    // Save initial camera state for reset
    this._initialCameraPos = this.camera.position.clone();
    this._initialTarget = this.controls.target.clone();
  }

  /**
   * Apply a uniform tint color to atoms of a non-first structure.
   *
   * @param {string} name - Structure name
   */
  _applyStructureColor(name) {
    const entry = this.structureManager.getStructure(name);
    if (!entry || !entry.color) return; // first structure keeps element colors

    const color = entry.color;
    const start = entry.atomOffset;
    const end = start + entry.atomCount;

    for (let i = start; i < end; i++) {
      this.atomColors[i].copy(color);
    }

    if (this.activeRep) this.activeRep.applyColors(this.atomColors);
  }

  /**
   * Build representation meshes for the current model.
   */
  _buildMeshes() {
    const RepClass = REP_CLASSES[this.currentRepType];
    if (!RepClass) return;

    this.activeRep = new RepClass(
      this.model, this.bonds,
      { atom: this.atomMaterial, bond: this.bondMaterial },
      this.viewerGroup
    );
    this.activeRep.build();

    // Update legacy refs
    this.atomMesh = this.activeRep.getAtomMesh();
    this.bondMesh = this.activeRep.getBondMesh();
  }

  /**
   * Switch to a different representation type.
   * Preserves color and visibility state.
   *
   * @param {string} type - One of REP_TYPES values
   */
  setRepresentation(type) {
    if (!REP_CLASSES[type]) return;
    if (!this.model) return;
    if (type === this.currentRepType && this.activeRep) return;

    // Dispose old representation
    if (this.activeRep) {
      this.activeRep.dispose();
      this.activeRep = null;
    }

    this.currentRepType = type;

    // Build new representation
    const RepClass = REP_CLASSES[type];
    this.activeRep = new RepClass(
      this.model, this.bonds,
      { atom: this.atomMaterial, bond: this.bondMaterial },
      this.viewerGroup
    );
    this.activeRep.build();

    // Update legacy refs
    this.atomMesh = this.activeRep.getAtomMesh();
    this.bondMesh = this.activeRep.getBondMesh();

    // Reapply color and visibility state
    if (this.atomColors) {
      this.activeRep.applyColors(this.atomColors);
    }
    if (this.atomVisible) {
      this.activeRep.applyVisibility(this.atomVisible);
    }

    // Update base scales from the new representation
    this.baseScales = this.activeRep.getBaseScales();
    this.baseBondScales = this.activeRep.getBaseBondScales();
  }

  /**
   * Center camera on the protein bounding box.
   */
  _centerCamera() {
    const { positions, atomCount } = this.model;
    if (atomCount === 0) return;

    // Compute bounding box
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < atomCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

    // Set orbit target to center
    this.controls.target.set(cx, cy, cz);

    // Position camera at a distance that fits the structure
    const fov = this.camera.fov * (Math.PI / 180);
    const dist = (size / 2) / Math.tan(fov / 2) * 1.5;
    this.camera.position.set(cx, cy, cz + dist);
    this.camera.near = 0.1;
    this.camera.far = dist * 10;
    this.camera.updateProjectionMatrix();

    // Remove distance limits for free orbit
    this.controls.minDistance = 1;
    this.controls.maxDistance = dist * 5;
    this.controls.maxPolarAngle = Math.PI;
    this.controls.update();

    // Set up cinematic lighting centered on the protein
    this._setupLighting(cx, cy, cz, size);
  }

  /**
   * Set up cinematic 3-point lighting centered on the protein.
   */
  _setupLighting(cx, cy, cz, size) {
    this._removeLights();
    this.lights = createViewerLighting(this.scene, cx, cy, cz, size);
  }

  /**
   * Remove viewer lights from the scene.
   */
  _removeLights() {
    removeViewerLighting(this.scene, this.lights);
    this.lights = [];
  }

  /**
   * Set post-processing quality level.
   *
   * @param {'off'|'low'|'high'} quality
   */
  setQuality(quality) {
    this.postProcessing.build(quality);
  }

  /**
   * Render one frame (post-processing or direct).
   */
  render() {
    this.postProcessing.render();
  }

  // ============================================================
  // Atom coloring
  // ============================================================

  /**
   * Color specific atoms by hex color value.
   * @param {Set<number>|number[]} indices
   * @param {number} hexColor - e.g. 0xff0000
   */
  colorAtoms(indices, hexColor) {
    const color = new THREE.Color(hexColor);
    for (const i of indices) {
      this.atomColors[i].copy(color);
    }
    if (this.activeRep) this.activeRep.applyColors(this.atomColors);
  }

  /**
   * Reset specific atoms to their element colors.
   * @param {Set<number>|number[]} indices
   */
  resetColorsForAtoms(indices) {
    const { atoms } = this.model;
    for (const i of indices) {
      this.atomColors[i].setHex(ELEMENT_COLORS[atoms[i].element] || DEFAULT_COLOR);
    }
    if (this.activeRep) this.activeRep.applyColors(this.atomColors);
  }

  /**
   * Reset all atom colors to element defaults.
   */
  resetColors() {
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      this.atomColors[i].setHex(ELEMENT_COLORS[atoms[i].element] || DEFAULT_COLOR);
    }
    // Reapply structure colors for non-first structures
    for (const name of this.structureManager.getStructureNames()) {
      this._applyStructureColor(name);
    }
    if (this.activeRep) this.activeRep.applyColors(this.atomColors);
  }

  /**
   * Hide specific atoms (scale to zero).
   * @param {Set<number>|number[]} indices
   */
  hideAtoms(indices) {
    for (const i of indices) {
      this.atomVisible[i] = 0;
    }
    if (this.activeRep) this.activeRep.applyVisibility(this.atomVisible);
  }

  /**
   * Show specific atoms (restore base scale).
   * @param {Set<number>|number[]} indices
   */
  showAtoms(indices) {
    for (const i of indices) {
      this.atomVisible[i] = 1;
    }
    if (this.activeRep) this.activeRep.applyVisibility(this.atomVisible);
  }

  /**
   * Reset all atoms to visible.
   */
  resetVisibility() {
    this.atomVisible.fill(1);
    if (this.activeRep) this.activeRep.applyVisibility(this.atomVisible);
  }

  /**
   * Fit camera to show selected atoms.
   * @param {Set<number>|number[]} indices
   */
  zoomToAtoms(indices) {
    const { positions } = this.model;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let count = 0;

    for (const i of indices) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      count++;
    }

    if (count === 0) return;

    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 2);

    this.controls.target.set(cx, cy, cz);

    const fov = this.camera.fov * (Math.PI / 180);
    const dist = (size / 2) / Math.tan(fov / 2) * 1.8;
    this.camera.position.set(cx, cy, cz + dist);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /**
   * Set orbit target to centroid of selected atoms.
   * @param {Set<number>|number[]} indices
   */
  centerOnAtoms(indices) {
    const { positions } = this.model;
    let sx = 0, sy = 0, sz = 0, count = 0;
    for (const i of indices) {
      sx += positions[i * 3];
      sy += positions[i * 3 + 1];
      sz += positions[i * 3 + 2];
      count++;
    }
    if (count === 0) return;
    this.controls.target.set(sx / count, sy / count, sz / count);
    this.controls.update();
  }

  /**
   * Set scene background color.
   * @param {number} hexColor
   */
  setBackground(hexColor) {
    this.scene.background = new THREE.Color(hexColor);
  }

  /**
   * Get current representation type.
   * @returns {string}
   */
  getRepresentation() {
    return this.currentRepType;
  }

  /**
   * Color atoms using a per-atom hex color map.
   * Used by spectrum, util.cbc, util.ss commands.
   * @param {Map<number, number>} colorMap - atom index → hex color
   */
  colorAtomsByMap(colorMap) {
    for (const [i, hex] of colorMap) {
      this.atomColors[i].setHex(hex);
    }
    this._applyAtomColors();
    this._updateBondColors();
  }

  /**
   * Orient camera for best view of selection (look along shortest axis).
   * @param {Set<number>|number[]} indices
   */
  orientToAtoms(indices) {
    const { positions } = this.model;
    let cx = 0, cy = 0, cz = 0, count = 0;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (const i of indices) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      cx += x; cy += y; cz += z; count++;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (count === 0) return;
    cx /= count; cy /= count; cz /= count;

    const extents = [
      { x: 1, y: 0, z: 0, size: maxX - minX },
      { x: 0, y: 1, z: 0, size: maxY - minY },
      { x: 0, y: 0, z: 1, size: maxZ - minZ },
    ];
    extents.sort((a, b) => a.size - b.size);

    // Camera looks along the shortest axis for the widest view
    const v = extents[0];
    const size = Math.max(extents[1].size, extents[2].size, 2);
    const fov = this.camera.fov * (Math.PI / 180);
    const dist = (size / 2) / Math.tan(fov / 2) * 1.8;

    this.controls.target.set(cx, cy, cz);
    this.camera.position.set(cx + v.x * dist, cy + v.y * dist, cz + v.z * dist);
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  /**
   * Rotate the camera around the orbit target by an angle along an axis.
   * @param {'x'|'y'|'z'} axis
   * @param {number} angleDeg - rotation in degrees
   */
  turnView(axis, angleDeg) {
    const angleRad = angleDeg * Math.PI / 180;
    const axisVec = new THREE.Vector3(
      axis === 'x' ? 1 : 0,
      axis === 'y' ? 1 : 0,
      axis === 'z' ? 1 : 0
    );
    const offset = this.camera.position.clone().sub(this.controls.target);
    offset.applyAxisAngle(axisVec, angleRad);
    this.camera.position.copy(this.controls.target).add(offset);
    this.camera.lookAt(this.controls.target);
    this.controls.update();
  }

  /**
   * Reset colors, visibility, camera, and background.
   */
  resetAll() {
    this.resetColors();
    this.resetVisibility();
    this.setRepresentation(REP_TYPES.BALL_AND_STICK);
    if (this._initialCameraPos) {
      this.camera.position.copy(this._initialCameraPos);
      this.controls.target.copy(this._initialTarget);
      this.camera.updateProjectionMatrix();
      this.controls.update();
    }
    if (this.backgroundTexture) {
      this.scene.background = this.backgroundTexture;
    }
  }

  // ---- Private helpers ----

  /**
   * Apply atomColors array to the active representation.
   */
  _applyAtomColors() {
    if (this.activeRep) {
      this.activeRep.applyColors(this.atomColors);
    }
  }

  /**
   * Update bond colors to match current atom colors.
   */
  _updateBondColors() {
    if (this.activeRep && this.activeRep.applyBondColors) {
      this.activeRep.applyBondColors(this.atomColors, this.bonds);
    }
  }

  /**
   * Hide bonds where either atom is hidden (scale to zero).
   */
  _updateBondVisibility() {
    if (this.activeRep) {
      this.activeRep.applyVisibility(this.atomVisible);
    }
  }

  /**
   * Remove current structure meshes from the scene.
   */
  clearStructure() {
    if (this.activeRep) {
      this.activeRep.dispose();
      this.activeRep = null;
    }
    this.atomMesh = null;
    this.bondMesh = null;
    this.model = null;
    this.bonds = null;
    this.atomColors = null;
    this.atomVisible = null;
    this.baseScales = null;
    this.baseBondScales = null;
    this.baseBondPositions = null;
    this.baseBondQuats = null;
    this.structureManager.clear();
  }

  /**
   * Full cleanup when leaving viewer mode.
   */
  dispose() {
    this.clearStructure();
    this._removeLights();
    this.postProcessing.dispose();
    this.scene.remove(this.viewerGroup);
    this.atomMaterial.dispose();
    this.bondMaterial.dispose();

    // Clear background before disposing texture
    this.scene.background = null;

    // Dispose environment map and background
    if (this.envMap) {
      this.envMap.dispose();
      this.envMap = null;
    }
    if (this.backgroundTexture) {
      this.backgroundTexture.dispose();
      this.backgroundTexture = null;
    }

    // Remove resize listener
    if (window.visualViewport) {
      window.visualViewport.removeEventListener('resize', this._onResize);
    } else {
      window.removeEventListener('resize', this._onResize);
    }
  }

  /**
   * Get structure summary info for the UI.
   */
  getInfo() {
    if (!this.model) return null;
    const { atomCount, residues, chains } = this.model;
    const info = {
      atomCount,
      residueCount: residues.length,
      chainCount: chains.length,
      chains: chains.map(c => c.id),
    };

    // Multi-structure info
    if (this.structureManager.count > 1) {
      info.structureCount = this.structureManager.count;
      info.structures = this.structureManager.getStructureNames().map(name => {
        const entry = this.structureManager.getStructure(name);
        return {
          name: entry.name,
          atomCount: entry.atomCount,
          color: entry.color ? '#' + entry.color.getHexString() : 'element',
        };
      });
    }

    return info;
  }
}
