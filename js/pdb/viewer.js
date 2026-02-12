// ============================================================
// viewer.js — PDB Viewer mode controller
// Manages parsed protein model, representation rendering,
// camera setup, cinematic lighting, post-processing, and
// cleanup for mode switching.
// ============================================================

import * as THREE from 'three';
import { parsePDB } from './parser.js';
import { inferBonds } from './bondInference.js';
import { ELEMENT_COLORS, DEFAULT_COLOR, REP_TYPES } from './constants.js';
import { createAtomMaterial, createBondMaterial } from './materials.js';
import { createViewerLighting, removeViewerLighting, createEnvironmentMap, createRadialGradientBackground } from './lighting.js';
import { PostProcessingPipeline } from './postProcessing.js';

import { BallAndStickRepresentation } from './representations/BallAndStickRepresentation.js';
import { SpacefillRepresentation } from './representations/SpacefillRepresentation.js';
import { StickRepresentation } from './representations/StickRepresentation.js';
import { CartoonRepresentation } from './representations/CartoonRepresentation.js';

const REP_CLASSES = {
  [REP_TYPES.BALL_AND_STICK]: BallAndStickRepresentation,
  [REP_TYPES.SPACEFILL]:      SpacefillRepresentation,
  [REP_TYPES.STICK]:          StickRepresentation,
  [REP_TYPES.CARTOON]:        CartoonRepresentation,
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
   *
   * @param {string} pdbText - Raw PDB file content
   * @returns {{ model, bonds }} or null if parse failed
   */
  loadFromText(pdbText) {
    this.clearStructure();

    const model = parsePDB(pdbText);
    if (!model) return null;

    this.model = model;
    this.bonds = inferBonds(model);

    this._buildMeshes();
    this._initState();
    this._centerCamera();

    return { model: this.model, bonds: this.bonds };
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
  // Console state management
  // ============================================================

  /**
   * Initialize per-atom state arrays after meshes are built.
   */
  _initState() {
    const n = this.model.atomCount;
    const { atoms } = this.model;

    // Store current element colors
    this.atomColors = new Array(n);
    for (let i = 0; i < n; i++) {
      this.atomColors[i] = new THREE.Color(ELEMENT_COLORS[atoms[i].element] || DEFAULT_COLOR);
    }

    // Visibility: 1 = visible, 0 = hidden
    this.atomVisible = new Uint8Array(n).fill(1);

    // Extract base scales from the active representation
    this.baseScales = this.activeRep ? this.activeRep.getBaseScales() : null;
    this.baseBondScales = this.activeRep ? this.activeRep.getBaseBondScales() : null;

    // Save initial camera state for reset
    this._initialCameraPos = this.camera.position.clone();
    this._initialTarget = this.controls.target.clone();
  }

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
   * Reset colors, visibility, camera, and background.
   */
  resetAll() {
    this.resetColors();
    this.resetVisibility();
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
    return {
      atomCount,
      residueCount: residues.length,
      chainCount: chains.length,
      chains: chains.map(c => c.id),
    };
  }
}
