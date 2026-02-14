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
import { InteractionOverlay } from './representations/InteractionOverlay.js';

const REP_CLASSES = {
  [REP_TYPES.BALL_AND_STICK]: BallAndStickRepresentation,
  [REP_TYPES.SPACEFILL]:      SpacefillRepresentation,
  [REP_TYPES.STICK]:          StickRepresentation,
  [REP_TYPES.CARTOON]:        CartoonRepresentation,
  [REP_TYPES.LINES]:          LinesRepresentation,
};

// ============================================================
// Atom removal helpers
// ============================================================

/**
 * Build a new model with specified atoms removed.
 * Returns { model, indexMap } where indexMap maps old local index → new local index.
 *
 * @param {Object} model - parsePDB-style model
 * @param {Set<number>} indicesToRemove - local atom indices to remove
 * @returns {{ model: Object, indexMap: Map<number, number> }}
 */
function rebuildModelWithoutAtoms(model, indicesToRemove) {
  const oldCount = model.atomCount;
  const indexMap = new Map();
  let newIdx = 0;
  for (let i = 0; i < oldCount; i++) {
    if (!indicesToRemove.has(i)) {
      indexMap.set(i, newIdx++);
    }
  }
  const newCount = newIdx;

  // Filter atoms array
  const newAtoms = [];
  for (let i = 0; i < oldCount; i++) {
    if (!indicesToRemove.has(i)) newAtoms.push(model.atoms[i]);
  }

  // Filter positions
  const newPositions = new Float32Array(newCount * 3);
  for (const [oldI, newI] of indexMap) {
    newPositions[newI * 3]     = model.positions[oldI * 3];
    newPositions[newI * 3 + 1] = model.positions[oldI * 3 + 1];
    newPositions[newI * 3 + 2] = model.positions[oldI * 3 + 2];
  }

  // Filter bFactors
  const newBFactors = new Float32Array(newCount);
  for (const [oldI, newI] of indexMap) {
    newBFactors[newI] = model.bFactors[oldI];
  }

  // Filter elements
  const newElements = new Uint8Array(newCount);
  for (const [oldI, newI] of indexMap) {
    newElements[newI] = model.elements[oldI];
  }

  // Filter isHet
  const newIsHet = new Uint8Array(newCount);
  for (const [oldI, newI] of indexMap) {
    newIsHet[newI] = model.isHet[oldI];
  }

  // Rebuild residues — remap atom indices, drop empty residues
  const newResidues = [];
  for (const res of model.residues) {
    let newStart = newCount; // sentinel: past end
    let newEnd = 0;
    for (let i = res.atomStart; i < res.atomEnd; i++) {
      const ni = indexMap.get(i);
      if (ni !== undefined) {
        if (ni < newStart) newStart = ni;
        if (ni + 1 > newEnd) newEnd = ni + 1;
      }
    }
    if (newStart >= newEnd) continue; // residue has 0 remaining atoms

    const remapSpecial = (idx) => {
      if (idx < 0) return -1;
      const ni = indexMap.get(idx);
      return ni !== undefined ? ni : -1;
    };

    newResidues.push({
      ...res,
      atomStart: newStart,
      atomEnd: newEnd,
      caIndex: remapSpecial(res.caIndex),
      cIndex: remapSpecial(res.cIndex),
      nIndex: remapSpecial(res.nIndex),
    });
  }

  // Rebuild chains — remap residue indices, drop empty chains
  // Build old residue index → new residue index map
  const oldResidues = model.residues;
  const residueMap = new Map();
  let newResIdx = 0;
  for (let ri = 0; ri < oldResidues.length; ri++) {
    const res = oldResidues[ri];
    // Check if this residue survived (has any atom in indexMap)
    let survived = false;
    for (let i = res.atomStart; i < res.atomEnd; i++) {
      if (indexMap.has(i)) { survived = true; break; }
    }
    if (survived) {
      residueMap.set(ri, newResIdx++);
    }
  }

  const newChains = [];
  for (const chain of model.chains) {
    let newResStart = newResidues.length; // sentinel
    let newResEnd = 0;
    for (let ri = chain.residueStart; ri < chain.residueEnd; ri++) {
      const nri = residueMap.get(ri);
      if (nri !== undefined) {
        if (nri < newResStart) newResStart = nri;
        if (nri + 1 > newResEnd) newResEnd = nri + 1;
      }
    }
    if (newResStart >= newResEnd) continue; // chain has 0 remaining residues
    newChains.push({
      ...chain,
      residueStart: newResStart,
      residueEnd: newResEnd,
    });
  }

  // Filter conectBonds
  const newConectBonds = [];
  for (const [i, j] of model.conectBonds) {
    const ni = indexMap.get(i);
    const nj = indexMap.get(j);
    if (ni !== undefined && nj !== undefined) {
      newConectBonds.push([ni, nj]);
    }
  }

  const newModel = {
    atoms: newAtoms,
    atomCount: newCount,
    positions: newPositions,
    bFactors: newBFactors,
    elements: newElements,
    elementList: model.elementList,
    isHet: newIsHet,
    residues: newResidues,
    chains: newChains,
    conectBonds: newConectBonds,
    header: model.header,
  };

  return { model: newModel, indexMap };
}

/**
 * Filter and remap a bond Uint32Array, removing bonds touching removed atoms.
 *
 * @param {Uint32Array} bonds - Flat bond pairs [a0,b0, a1,b1, ...]
 * @param {Set<number>} indicesToRemove - local atom indices being removed
 * @param {Map<number, number>} indexMap - old → new index mapping
 * @returns {Uint32Array} New bond array with surviving bonds remapped
 */
function rebuildBondsWithoutAtoms(bonds, indicesToRemove, indexMap) {
  const kept = [];
  for (let i = 0; i < bonds.length; i += 2) {
    const a = bonds[i], b = bonds[i + 1];
    if (indicesToRemove.has(a) || indicesToRemove.has(b)) continue;
    const na = indexMap.get(a);
    const nb = indexMap.get(b);
    if (na !== undefined && nb !== undefined) {
      kept.push(na, nb);
    }
  }
  return new Uint32Array(kept);
}

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
    this.activeReps = new Map();
    this.currentRepType = REP_TYPES.BALL_AND_STICK;
    this.atomRepType = null;

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
   * Permanently remove atoms by global index from loaded structures.
   * Rebuilds each affected structure's model/bonds, removes empty structures,
   * and rebuilds the merged state.
   *
   * @param {Set<number>} globalIndices - Global atom indices to remove
   */
  removeAtoms(globalIndices) {
    if (!this.model || globalIndices.size === 0) return;

    const ranges = this.model._structureRanges;
    if (!ranges) return;

    // Partition global indices into per-structure local index sets
    const perStructure = new Map(); // key (lowercase name) → Set<localIndex>
    for (const gi of globalIndices) {
      for (const [key, range] of ranges) {
        if (gi >= range.atomOffset && gi < range.atomOffset + range.atomCount) {
          if (!perStructure.has(key)) perStructure.set(key, new Set());
          perStructure.get(key).add(gi - range.atomOffset);
          break;
        }
      }
    }

    // Rebuild each affected structure
    const toRemoveKeys = [];
    for (const [key, localIndices] of perStructure) {
      const entry = this.structureManager.structures.get(key);
      if (!entry) continue;

      // If removing all atoms from this structure, mark for removal
      if (localIndices.size >= entry.atomCount) {
        toRemoveKeys.push(key);
        continue;
      }

      // Rebuild model without removed atoms
      const { model: newModel, indexMap } = rebuildModelWithoutAtoms(entry.model, localIndices);
      const newBonds = rebuildBondsWithoutAtoms(entry.bonds, localIndices, indexMap);

      entry.model = newModel;
      entry.bonds = newBonds;
      entry.atomCount = newModel.atomCount;
    }

    // Remove structures that lost all atoms
    for (const key of toRemoveKeys) {
      this.structureManager.structures.delete(key);
      this.structureManager._insertionOrder = this.structureManager._insertionOrder.filter(k => k !== key);
    }

    // If nothing left, clear everything
    if (this.structureManager.count === 0) {
      this.clearStructure();
      return;
    }

    // Recalculate offsets and rebuild merged state
    this.structureManager._recalculateOffsets();
    this._rebuildMergedState();
  }

  /**
   * Rebuild merged model/bonds from the structure manager,
   * resize state arrays, and rebuild representations.
   * Preserves per-structure visual state (colors, visibility, scale, rep types).
   */
  _rebuildMergedState() {
    // Save per-structure state before rebuild
    const savedState = this._savePerStructureState();

    // Dispose current reps
    for (const rep of this.activeReps.values()) rep.dispose();
    this.activeReps.clear();

    this.model = this.structureManager.buildMergedModel();
    this.bonds = this.structureManager.buildMergedBonds();

    if (!this.model) return;

    this._buildMeshes();
    this._resizeStateArrays();

    // Restore state for structures that existed before
    if (this._restorePerStructureState(savedState)) {
      // Ensure reps exist for all restored rep types
      const repTypes = new Set(this.atomRepType);
      for (const rt of repTypes) this._ensureRep(rt);
      this._cleanupUnusedReps();
      // Apply restored colors to all reps
      for (const rep of this.activeReps.values()) {
        rep.applyColors(this.atomColors);
      }
      this._syncRepVisibility();
      this._updateCurrentRepType();
    }
  }

  /**
   * Save per-structure visual state keyed by structure name.
   * @returns {Map|null}
   */
  _savePerStructureState() {
    if (!this.model || !this.atomColors) return null;
    const ranges = this.model._structureRanges;
    if (!ranges) return null;

    const state = new Map();
    for (const [name, range] of ranges) {
      const { atomOffset, atomCount } = range;
      state.set(name, {
        colors: this.atomColors.slice(atomOffset, atomOffset + atomCount),
        visible: this.atomVisible.slice(atomOffset, atomOffset + atomCount),
        scale: this.atomScale.slice(atomOffset, atomOffset + atomCount),
        repType: this.atomRepType.slice(atomOffset, atomOffset + atomCount),
      });
    }
    return state;
  }

  /**
   * Restore per-structure visual state from a saved snapshot.
   * @param {Map|null} savedState
   * @returns {boolean} true if any state was restored
   */
  _restorePerStructureState(savedState) {
    if (!savedState || !this.model) return false;
    const ranges = this.model._structureRanges;
    if (!ranges) return false;

    let restored = false;
    for (const [name, range] of ranges) {
      const saved = savedState.get(name);
      if (!saved) continue;

      const { atomOffset, atomCount } = range;
      const count = Math.min(atomCount, saved.colors.length);

      for (let i = 0; i < count; i++) {
        this.atomColors[atomOffset + i] = saved.colors[i];
        this.atomRepType[atomOffset + i] = saved.repType[i];
      }
      this.atomVisible.set(saved.visible.subarray(0, count), atomOffset);
      this.atomScale.set(saved.scale.subarray(0, count), atomOffset);
      restored = true;
    }
    return restored;
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

    // Per-atom scale multipliers (default 1.0)
    this.atomScale = new Float32Array(n).fill(1);

    // Per-atom representation type
    this.atomRepType = new Array(n).fill(this.currentRepType);

    // Base scales from active rep
    const firstRep = this.activeReps.values().next().value || null;
    this.baseScales = firstRep ? firstRep.getBaseScales() : null;
    this.baseBondScales = firstRep ? firstRep.getBaseBondScales() : null;

    // Rebuild interaction overlay for new model
    if (this.interactionOverlay) {
      this.interactionOverlay.removeAll();
    }
    this.interactionOverlay = new InteractionOverlay(this.model, this.viewerGroup);

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

    const rep = new RepClass(
      this.model, this.bonds,
      { atom: this.atomMaterial, bond: this.bondMaterial },
      this.viewerGroup
    );
    rep.build();
    this.activeReps.set(this.currentRepType, rep);

    // Update legacy refs
    this.atomMesh = rep.getAtomMesh();
    this.bondMesh = rep.getBondMesh();
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
    if (this.activeReps.size === 1 && this.activeReps.has(type)) return;

    // Dispose all existing reps (global switch)
    for (const rep of this.activeReps.values()) rep.dispose();
    this.activeReps.clear();

    this.currentRepType = type;

    // Assign all atoms to this rep type
    if (this.atomRepType) this.atomRepType.fill(type);

    // Build new representation
    const RepClass = REP_CLASSES[type];
    const rep = new RepClass(
      this.model, this.bonds,
      { atom: this.atomMaterial, bond: this.bondMaterial },
      this.viewerGroup
    );
    rep.build();
    this.activeReps.set(type, rep);

    // Update legacy refs
    this.atomMesh = rep.getAtomMesh();
    this.bondMesh = rep.getBondMesh();

    // Reapply color and visibility state
    if (this.atomColors) {
      rep.applyColors(this.atomColors);
    }
    if (this.atomVisible) {
      rep.applyVisibility(this.atomVisible, this.atomScale);
    }

    // Update base transforms from the new representation
    this.baseScales = rep.getBaseScales();
    this.baseBondScales = rep.getBaseBondScales();
    this.baseBondPositions = rep.getBaseBondPositions();
    this.baseBondQuats = rep.getBaseBondQuats();

  }

  /**
   * Assign specific atoms to a representation type (per-selection rep).
   * Creates the representation if needed, syncs visibility.
   *
   * @param {string} repType - One of REP_TYPES values
   * @param {Set<number>|number[]} indices - Atoms to assign
   */
  setRepresentationForAtoms(repType, indices) {
    if (!this.model || !this.atomRepType) return;
    if (!REP_CLASSES[repType]) return;

    for (const i of indices) {
      this.atomRepType[i] = repType;
    }

    this._ensureRep(repType);
    this._cleanupUnusedReps();
    this._syncRepVisibility();
    this._updateCurrentRepType();
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

    // Set distance limits for zoom
    this.controls.minDistance = 1;
    this.controls.maxDistance = dist * 5;
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
    this.updateCameraAnimation();
    this.postProcessing.render();
  }

  // ============================================================
  // Atom coloring
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

    // Per-atom scale multipliers (default 1.0)
    this.atomScale = new Float32Array(n).fill(1);

    // Per-atom representation type
    this.atomRepType = new Array(n).fill(this.currentRepType);

    // Extract base scales from the active representation
    const firstRep = this.activeReps.values().next().value || null;
    this.baseScales = firstRep ? firstRep.getBaseScales() : null;
    this.baseBondScales = firstRep ? firstRep.getBaseBondScales() : null;

    // Save initial camera state for reset
    this._initialCameraPos = this.camera.position.clone();
    this._initialTarget = this.controls.target.clone();

    // Camera animation state
    this._cameraAnim = null;

    // Interaction overlay (contacts command)
    this.interactionOverlay = new InteractionOverlay(this.model, this.viewerGroup);
  }

  // ============================================================
  // Camera animation
  // ============================================================

  /**
   * Smoothly animate camera target (and optionally position) over time.
   * @param {THREE.Vector3} newTarget
   * @param {THREE.Vector3|null} newPosition - null keeps same offset from target
   * @param {number} duration - ms
   */
  _animateCameraTo(newTarget, newPosition = null, duration = 350) {
    this._cameraAnim = {
      startTarget: this.controls.target.clone(),
      endTarget: newTarget.clone(),
      startPos: this.camera.position.clone(),
      endPos: newPosition ? newPosition.clone() : null,
      startTime: performance.now(),
      duration,
    };
  }

  /**
   * Tick camera animation. Called each frame from render().
   */
  updateCameraAnimation() {
    if (!this._cameraAnim) return;
    const anim = this._cameraAnim;
    const t = Math.min((performance.now() - anim.startTime) / anim.duration, 1);
    const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; // ease-in-out quad

    this.controls.target.lerpVectors(anim.startTarget, anim.endTarget, ease);

    if (anim.endPos) {
      this.camera.position.lerpVectors(anim.startPos, anim.endPos, ease);
    } else {
      // Keep same offset — just shift orbit center
      const offset = new THREE.Vector3().subVectors(anim.startPos, anim.startTarget);
      this.camera.position.copy(this.controls.target).add(offset);
    }

    this.controls.update();
    if (t >= 1) this._cameraAnim = null;
  }

  /**
   * Recenter orbit target on the centroid of currently visible atoms.
   * Preserves viewing angle, only shifts what you orbit around.
   */
  recenterOnVisible() {
    if (!this.model || !this.atomVisible) return;
    const { positions, atomCount } = this.model;
    let sx = 0, sy = 0, sz = 0, count = 0;
    for (let i = 0; i < atomCount; i++) {
      if (this.atomVisible[i]) {
        sx += positions[i * 3];
        sy += positions[i * 3 + 1];
        sz += positions[i * 3 + 2];
        count++;
      }
    }
    if (count === 0) return;
    const newTarget = new THREE.Vector3(sx / count, sy / count, sz / count);

    // Only animate if the shift is noticeable
    if (newTarget.distanceTo(this.controls.target) > 0.5) {
      this._animateCameraTo(newTarget, null, 300);
    }
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
    for (const rep of this.activeReps.values()) rep.applyColors(this.atomColors);
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
    for (const rep of this.activeReps.values()) rep.applyColors(this.atomColors);
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
    for (const rep of this.activeReps.values()) rep.applyColors(this.atomColors);
  }

  /**
   * Hide specific atoms (scale to zero).
   * @param {Set<number>|number[]} indices
   */
  hideAtoms(indices) {
    for (const i of indices) {
      this.atomVisible[i] = 0;
    }
    this._syncRepVisibility();
  }

  /**
   * Show specific atoms (restore base scale).
   * @param {Set<number>|number[]} indices
   */
  showAtoms(indices) {
    for (const i of indices) {
      this.atomVisible[i] = 1;
    }
    this._syncRepVisibility();
  }

  /**
   * Set per-atom scale multipliers for specific atoms.
   * @param {Set<number>|number[]} indices
   * @param {number} factor - Scale multiplier (e.g. 2.0 = double size)
   */
  scaleAtoms(indices, factor) {
    if (!this.atomScale) return;
    for (const i of indices) {
      this.atomScale[i] = factor;
    }
    this._syncRepVisibility();
  }

  /**
   * Reset all atom scale multipliers to 1.0.
   */
  resetScale() {
    if (!this.atomScale) return;
    this.atomScale.fill(1);
    this._syncRepVisibility();
  }

  /**
   * Reset all atoms to visible.
   */
  resetVisibility() {
    this.atomVisible.fill(1);
    this._syncRepVisibility();
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

    const fov = this.camera.fov * (Math.PI / 180);
    const dist = (size / 2) / Math.tan(fov / 2) * 1.8;
    const newTarget = new THREE.Vector3(cx, cy, cz);
    const newPos = new THREE.Vector3(cx, cy, cz + dist);

    this._animateCameraTo(newTarget, newPos, 400);
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
    const newTarget = new THREE.Vector3(sx / count, sy / count, sz / count);
    this._animateCameraTo(newTarget, null, 350);
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
   * @returns {string} One of REP_TYPES values
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

    const newTarget = new THREE.Vector3(cx, cy, cz);
    const newPos = new THREE.Vector3(cx + v.x * dist, cy + v.y * dist, cz + v.z * dist);
    this._animateCameraTo(newTarget, newPos, 400);
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
   * Add new bonds and rebuild representations.
   * @param {Uint32Array} newBonds - Flat pairs [a0,b0, a1,b1, ...] to add
   * @returns {number} Number of bonds actually added (deduped)
   */
  addBonds(newBonds) {
    if (!this.model || !this.bonds) return 0;
    const n = this.model.atoms.length;

    // Build set of existing bond keys
    const existing = new Set();
    for (let i = 0; i < this.bonds.length; i += 2) {
      const a = Math.min(this.bonds[i], this.bonds[i + 1]);
      const b = Math.max(this.bonds[i], this.bonds[i + 1]);
      existing.add(a * n + b);
    }

    // Filter to genuinely new bonds
    const toAdd = [];
    for (let i = 0; i < newBonds.length; i += 2) {
      const a = Math.min(newBonds[i], newBonds[i + 1]);
      const b = Math.max(newBonds[i], newBonds[i + 1]);
      const key = a * n + b;
      if (!existing.has(key)) {
        existing.add(key);
        toAdd.push(a, b);
      }
    }

    if (toAdd.length === 0) return 0;

    // Merge into bonds array
    const merged = new Uint32Array(this.bonds.length + toAdd.length);
    merged.set(this.bonds);
    merged.set(toAdd, this.bonds.length);
    this.bonds = merged;

    this._rebuildReps();
    return toAdd.length / 2;
  }

  /**
   * Remove bonds between two selections and rebuild representations.
   * Removes any bond where one endpoint is in sel1 and the other in sel2.
   * @param {Set<number>} sel1
   * @param {Set<number>} sel2
   * @returns {number} Number of bonds removed
   */
  removeBonds(sel1, sel2) {
    if (!this.model || !this.bonds) return 0;

    const kept = [];
    let removed = 0;
    for (let i = 0; i < this.bonds.length; i += 2) {
      const a = this.bonds[i], b = this.bonds[i + 1];
      const crosses = (sel1.has(a) && sel2.has(b)) || (sel1.has(b) && sel2.has(a));
      if (crosses) {
        removed++;
      } else {
        kept.push(a, b);
      }
    }

    if (removed === 0) return 0;

    this.bonds = new Uint32Array(kept);
    this._rebuildReps();
    return removed;
  }

  /**
   * Rebuild all active representations (after bond array changes).
   * Preserves colors and visibility.
   */
  _rebuildReps() {
    const savedColors = this.atomColors;
    const savedVisible = this.atomVisible;
    const savedRepTypes = this.atomRepType;

    // Rebuild each active rep
    const activeTypes = [...this.activeReps.keys()];
    for (const rep of this.activeReps.values()) rep.dispose();
    this.activeReps.clear();

    for (const repType of activeTypes) {
      const RepClass = REP_CLASSES[repType];
      if (!RepClass) continue;
      const rep = new RepClass(
        this.model, this.bonds,
        { atom: this.atomMaterial, bond: this.bondMaterial },
        this.viewerGroup
      );
      rep.build();
      this.activeReps.set(repType, rep);
    }

    // Restore state
    this.atomColors = savedColors;
    this.atomVisible = savedVisible;
    this.atomRepType = savedRepTypes;

    for (const rep of this.activeReps.values()) {
      if (savedColors) rep.applyColors(savedColors);
    }
    if (savedVisible) this._syncRepVisibility();

    // Update legacy refs
    if (this.activeReps.size === 1) {
      const rep = this.activeReps.values().next().value;
      this.atomMesh = rep.getAtomMesh();
      this.bondMesh = rep.getBondMesh();
    }
  }

  /**
   * Reset colors, visibility, camera, and background.
   */
  resetAll() {
    this.resetColors();
    this.resetVisibility();
    this.resetScale();
    this.clearAllInteractions();
    this.setRepresentation(REP_TYPES.BALL_AND_STICK);
    if (this._initialCameraPos) {
      this._animateCameraTo(this._initialTarget, this._initialCameraPos, 400);
    }
    if (this.backgroundTexture) {
      this.scene.background = this.backgroundTexture;
    }
  }

  // ============================================================
  // Interaction overlay (contacts)
  // ============================================================

  /**
   * Add interaction pairs as a dashed-line overlay layer.
   * @param {string} type - Interaction type (e.g. INTERACTION_TYPES.HBONDS)
   * @param {{ a: number, b: number, distance: number }[]} pairs
   */
  addInteractions(type, pairs) {
    if (!this.interactionOverlay) return;
    this.interactionOverlay.addLayer(type, pairs);
    // Apply current visibility so hidden atoms are respected
    if (this.atomVisible) {
      this.interactionOverlay.applyVisibility(this.atomVisible);
    }
  }

  /**
   * Remove a specific interaction layer.
   * @param {string} type
   */
  removeInteractions(type) {
    if (!this.interactionOverlay) return;
    this.interactionOverlay.removeLayer(type);
  }

  /**
   * Remove all interaction layers.
   */
  clearAllInteractions() {
    if (!this.interactionOverlay) return;
    this.interactionOverlay.removeAll();
  }

  /**
   * Get interaction pairs for a given type from the overlay.
   * @param {string} type - Interaction type
   * @returns {{ a: number, b: number, distance: number }[] | null}
   */
  getInteractionPairs(type) {
    if (!this.interactionOverlay) return null;
    return this.interactionOverlay.getLayerPairs(type);
  }

  // ---- Private helpers ----

  /**
   * Apply atomColors array to the atom InstancedMesh.
   */
  _applyAtomColors() {
    for (const rep of this.activeReps.values()) {
      rep.applyColors(this.atomColors);
    }
  }

  /**
   * Update bond colors to match current atom colors.
   */
  _updateBondColors() {
    for (const rep of this.activeReps.values()) {
      if (rep.applyBondColors) rep.applyBondColors(this.atomColors, this.bonds);
    }
  }

  /**
   * Hide bonds where either atom is hidden (scale to zero).
   */
  _updateBondVisibility() {
    this._syncRepVisibility();
  }

  /**
   * Sync visibility across all active reps based on atomRepType and atomVisible.
   */
  _syncRepVisibility() {
    if (!this.atomVisible || !this.atomRepType) return;
    const n = this.model.atomCount;
    const combined = new Uint8Array(n);

    for (const [repType, rep] of this.activeReps) {
      for (let i = 0; i < n; i++) {
        combined[i] = (this.atomRepType[i] === repType && this.atomVisible[i]) ? 1 : 0;
      }
      rep.applyVisibility(combined, this.atomScale);
    }

    // Sync interaction overlay visibility with atom visibility
    if (this.interactionOverlay && this.interactionOverlay.hasLayers()) {
      this.interactionOverlay.applyVisibility(this.atomVisible);
    }
  }

  /**
   * Remove reps that have no atoms assigned.
   */
  _cleanupUnusedReps() {
    if (!this.atomRepType) return;
    const usedTypes = new Set(this.atomRepType);
    for (const [repType, rep] of this.activeReps) {
      if (!usedTypes.has(repType)) {
        rep.dispose();
        this.activeReps.delete(repType);
      }
    }
  }

  /**
   * Create a rep if not already active.
   */
  _ensureRep(repType) {
    if (this.activeReps.has(repType)) return this.activeReps.get(repType);
    const RepClass = REP_CLASSES[repType];
    if (!RepClass) return null;
    const rep = new RepClass(
      this.model, this.bonds,
      { atom: this.atomMaterial, bond: this.bondMaterial },
      this.viewerGroup
    );
    rep.build();
    if (this.atomColors) rep.applyColors(this.atomColors);
    this.activeReps.set(repType, rep);
    return rep;
  }

  /**
   * Update currentRepType based on atom assignments.
   * Sets to null when multiple rep types are active (mixed mode).
   */
  _updateCurrentRepType() {
    if (!this.atomRepType) return;
    const types = new Set(this.atomRepType);
    if (types.size === 1) {
      this.currentRepType = types.values().next().value;
    } else {
      this.currentRepType = null;
    }
    // Update legacy refs
    if (this.activeReps.size === 1) {
      const rep = this.activeReps.values().next().value;
      this.atomMesh = rep.getAtomMesh();
      this.bondMesh = rep.getBondMesh();
    } else {
      this.atomMesh = null;
      this.bondMesh = null;
    }
  }

  /**
   * Remove current structure meshes from the scene.
   */
  clearStructure() {
    for (const rep of this.activeReps.values()) rep.dispose();
    this.activeReps.clear();
    if (this.interactionOverlay) {
      this.interactionOverlay.dispose();
      this.interactionOverlay = null;
    }
    this.atomMesh = null;
    this.bondMesh = null;
    this.model = null;
    this.bonds = null;
    this.atomColors = null;
    this.atomVisible = null;
    this.atomScale = null;
    this.atomRepType = null;
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
