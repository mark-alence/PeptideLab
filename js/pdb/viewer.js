// ============================================================
// viewer.js — PDB Viewer mode controller
// Manages parsed protein model, InstancedMesh rendering,
// camera setup, cinematic lighting, post-processing, and
// cleanup for mode switching.
// ============================================================

import * as THREE from 'three';
import { parsePDB } from './parser.js';
import { inferBonds } from './bondInference.js';
import { createAtomInstances, createBondInstances, updateAtomColors, updateBondColors, ELEMENT_COLORS } from './atomRenderer.js';
import { createAtomMaterial, createBondMaterial } from './materials.js';
import { createViewerLighting, removeViewerLighting, createEnvironmentMap, createRadialGradientBackground } from './lighting.js';
import { PostProcessingPipeline } from './postProcessing.js';

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
   * Build InstancedMeshes for the current model/bonds and add to scene.
   */
  _buildMeshes() {
    const { model, bonds } = this;

    // Atoms
    this.atomMesh = createAtomInstances(model, this.atomMaterial, 0.3);
    this.viewerGroup.add(this.atomMesh);

    // Bonds
    this.bondMesh = createBondInstances(model, bonds, this.bondMaterial, 0.1);
    if (this.bondMesh) {
      this.viewerGroup.add(this.bondMesh);
    }
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
    const DEFAULT_COLOR = 0xFF69B4;

    // Store current element colors
    this.atomColors = new Array(n);
    for (let i = 0; i < n; i++) {
      this.atomColors[i] = new THREE.Color(ELEMENT_COLORS[atoms[i].element] || DEFAULT_COLOR);
    }

    // Visibility: 1 = visible, 0 = hidden
    this.atomVisible = new Uint8Array(n).fill(1);

    // Extract base scales from atom instance matrices
    this.baseScales = new Float32Array(n);
    const _mat = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scl = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      this.atomMesh.getMatrixAt(i, _mat);
      _mat.decompose(_pos, _quat, _scl);
      this.baseScales[i] = _scl.x; // uniform scale
    }

    // Extract base scales from bond instance matrices
    if (this.bondMesh) {
      const bondInstCount = this.bondMesh.count;
      this.baseBondScales = new Array(bondInstCount);
      for (let i = 0; i < bondInstCount; i++) {
        this.bondMesh.getMatrixAt(i, _mat);
        _mat.decompose(_pos, _quat, _scl);
        this.baseBondScales[i] = new THREE.Vector3().copy(_scl);
      }
    }

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
    this._applyAtomColors();
    this._updateBondColors();
  }

  /**
   * Reset specific atoms to their element colors.
   * @param {Set<number>|number[]} indices
   */
  resetColorsForAtoms(indices) {
    const DEFAULT_COLOR = 0xFF69B4;
    const { atoms } = this.model;
    for (const i of indices) {
      this.atomColors[i].setHex(ELEMENT_COLORS[atoms[i].element] || DEFAULT_COLOR);
    }
    this._applyAtomColors();
    this._updateBondColors();
  }

  /**
   * Reset all atom colors to element defaults.
   */
  resetColors() {
    const DEFAULT_COLOR = 0xFF69B4;
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      this.atomColors[i].setHex(ELEMENT_COLORS[atoms[i].element] || DEFAULT_COLOR);
    }
    this._applyAtomColors();
    this._updateBondColors();
  }

  /**
   * Hide specific atoms (scale to zero).
   * @param {Set<number>|number[]} indices
   */
  hideAtoms(indices) {
    for (const i of indices) {
      this.atomVisible[i] = 0;
      this._setAtomScale(i, 0);
    }
    this.atomMesh.instanceMatrix.needsUpdate = true;
    this._updateBondVisibility();
  }

  /**
   * Show specific atoms (restore base scale).
   * @param {Set<number>|number[]} indices
   */
  showAtoms(indices) {
    for (const i of indices) {
      this.atomVisible[i] = 1;
      this._setAtomScale(i, this.baseScales[i]);
    }
    this.atomMesh.instanceMatrix.needsUpdate = true;
    this._updateBondVisibility();
  }

  /**
   * Reset all atoms to visible.
   */
  resetVisibility() {
    this.atomVisible.fill(1);
    for (let i = 0; i < this.model.atomCount; i++) {
      this._setAtomScale(i, this.baseScales[i]);
    }
    this.atomMesh.instanceMatrix.needsUpdate = true;
    this._updateBondVisibility();
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

  // ---- Private helpers ----

  /**
   * Set instance scale for a single atom.
   */
  _setAtomScale(i, s) {
    const _mat = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scl = new THREE.Vector3();
    this.atomMesh.getMatrixAt(i, _mat);
    _mat.decompose(_pos, _quat, _scl);
    _scl.set(s, s, s);
    _mat.compose(_pos, _quat, _scl);
    this.atomMesh.setMatrixAt(i, _mat);
  }

  /**
   * Apply atomColors array to the atom InstancedMesh.
   */
  _applyAtomColors() {
    updateAtomColors(this.atomMesh, this.atomColors);
  }

  /**
   * Update bond colors to match current atom colors.
   */
  _updateBondColors() {
    if (!this.bondMesh || !this.bonds) return;
    updateBondColors(this.bondMesh, this.bonds, this.atomColors);
  }

  /**
   * Hide bonds where either atom is hidden (scale to zero).
   */
  _updateBondVisibility() {
    if (!this.bondMesh || !this.bonds) return;
    const bondCount = this.bonds.length / 2;
    const _mat = new THREE.Matrix4();
    const _pos = new THREE.Vector3();
    const _quat = new THREE.Quaternion();
    const _scl = new THREE.Vector3();

    for (let bi = 0; bi < bondCount; bi++) {
      const ai = this.bonds[bi * 2];
      const aj = this.bonds[bi * 2 + 1];
      const visible = this.atomVisible[ai] && this.atomVisible[aj];

      for (let half = 0; half < 2; half++) {
        const idx = bi * 2 + half;
        if (visible) {
          // Restore base scale
          this.bondMesh.getMatrixAt(idx, _mat);
          _mat.decompose(_pos, _quat, _scl);
          _scl.copy(this.baseBondScales[idx]);
          _mat.compose(_pos, _quat, _scl);
          this.bondMesh.setMatrixAt(idx, _mat);
        } else {
          // Scale to zero
          this.bondMesh.getMatrixAt(idx, _mat);
          _mat.decompose(_pos, _quat, _scl);
          _scl.set(0, 0, 0);
          _mat.compose(_pos, _quat, _scl);
          this.bondMesh.setMatrixAt(idx, _mat);
        }
      }
    }
    this.bondMesh.instanceMatrix.needsUpdate = true;
  }

  /**
   * Remove current structure meshes from the scene.
   */
  clearStructure() {
    if (this.atomMesh) {
      this.viewerGroup.remove(this.atomMesh);
      this.atomMesh.geometry.dispose();
      this.atomMesh.dispose();
      this.atomMesh = null;
    }
    if (this.bondMesh) {
      this.viewerGroup.remove(this.bondMesh);
      this.bondMesh.geometry.dispose();
      this.bondMesh.dispose();
      this.bondMesh = null;
    }
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
