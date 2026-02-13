// ============================================================
// InteractionOverlay.js — Standalone overlay for non-covalent
// interactions. NOT a BaseRepresentation subclass — interactions
// are additive, drawn on top of any representation.
//
// Per-type layers: each interaction type gets its own
// THREE.LineSegments + THREE.LineDashedMaterial with distinct
// colors and dash patterns.
// ============================================================

import * as THREE from 'three';
import { INTERACTION_TYPES } from '../interactionDetector.js';

// Visual styles per interaction type
const LAYER_STYLES = {
  [INTERACTION_TYPES.HBONDS]: {
    color: 0x00FFFF,    // cyan
    dashSize: 0.3,
    gapSize: 0.15,
    linewidth: 1,
  },
  [INTERACTION_TYPES.SALT_BRIDGES]: {
    color: 0xFF4444,    // red
    dashSize: 0.4,
    gapSize: 0.2,
    linewidth: 1,
  },
  [INTERACTION_TYPES.COVALENT]: {
    color: 0xFF8C00,    // orange
    dashSize: 0.2,
    gapSize: 0.1,
    linewidth: 1,
  },
  [INTERACTION_TYPES.DISTANCE]: {
    color: 0xAADD00,    // yellow-green
    dashSize: 0.25,
    gapSize: 0.15,
    linewidth: 1,
  },
};

/**
 * InteractionOverlay — manages dashed-line layers for interaction types.
 * Added to the viewerGroup, drawn on top with renderOrder = 999.
 */
export class InteractionOverlay {
  /**
   * @param {Object} model - Parsed PDB model (for positions)
   * @param {THREE.Group} viewerGroup - Parent group to add meshes to
   */
  constructor(model, viewerGroup) {
    this.model = model;
    this.viewerGroup = viewerGroup;

    /** @type {Map<string, { mesh: THREE.LineSegments, material: THREE.LineDashedMaterial, pairs: {a,b,distance}[], basePositions: Float32Array }>} */
    this.layers = new Map();
  }

  /**
   * Add interaction pairs for a given type. Replaces any existing layer of that type.
   *
   * @param {string} type - One of INTERACTION_TYPES values
   * @param {{ a: number, b: number, distance: number }[]} pairs
   */
  addLayer(type, pairs) {
    // Remove existing layer of this type
    this.removeLayer(type);

    if (pairs.length === 0) return;

    const { positions } = this.model;
    const style = LAYER_STYLES[type] || LAYER_STYLES[INTERACTION_TYPES.DISTANCE];

    // 2 vertices per pair (simple line segment A->B)
    const vertCount = pairs.length * 2;
    const posArray = new Float32Array(vertCount * 3);
    // Store atom indices per vertex for visibility
    const vertexAtomIndex = new Uint32Array(vertCount);

    for (let pi = 0; pi < pairs.length; pi++) {
      const { a, b } = pairs[pi];
      const v = pi * 2;

      posArray[v * 3]     = positions[a * 3];
      posArray[v * 3 + 1] = positions[a * 3 + 1];
      posArray[v * 3 + 2] = positions[a * 3 + 2];

      posArray[(v + 1) * 3]     = positions[b * 3];
      posArray[(v + 1) * 3 + 1] = positions[b * 3 + 1];
      posArray[(v + 1) * 3 + 2] = positions[b * 3 + 2];

      vertexAtomIndex[v] = a;
      vertexAtomIndex[v + 1] = b;
    }

    // Save base positions for visibility restore
    const basePositions = new Float32Array(posArray);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));

    const material = new THREE.LineDashedMaterial({
      color: style.color,
      dashSize: style.dashSize,
      gapSize: style.gapSize,
      depthTest: true,
      transparent: true,
      opacity: 0.85,
    });

    const mesh = new THREE.LineSegments(geometry, material);
    mesh.name = `interaction-${type}`;
    mesh.frustumCulled = false;
    mesh.renderOrder = 999;
    mesh.computeLineDistances();

    this.viewerGroup.add(mesh);
    this.layers.set(type, {
      mesh,
      material,
      pairs,
      basePositions,
      vertexAtomIndex,
    });
  }

  /**
   * Remove a specific interaction layer.
   * @param {string} type
   */
  removeLayer(type) {
    const layer = this.layers.get(type);
    if (!layer) return;
    this.viewerGroup.remove(layer.mesh);
    layer.mesh.geometry.dispose();
    layer.material.dispose();
    this.layers.delete(type);
  }

  /**
   * Remove all interaction layers.
   */
  removeAll() {
    for (const type of [...this.layers.keys()]) {
      this.removeLayer(type);
    }
  }

  /**
   * Apply atom visibility to all interaction layers.
   * Collapses line segments to zero when either endpoint atom is hidden.
   *
   * @param {Uint8Array} atomVisible - Per-atom visibility flags
   */
  applyVisibility(atomVisible) {
    for (const layer of this.layers.values()) {
      const posAttr = layer.mesh.geometry.attributes.position;
      const pairCount = layer.pairs.length;

      let anyChanged = false;
      for (let pi = 0; pi < pairCount; pi++) {
        const a = layer.vertexAtomIndex[pi * 2];
        const b = layer.vertexAtomIndex[pi * 2 + 1];
        const visible = atomVisible[a] && atomVisible[b];
        const v = pi * 2;

        if (visible) {
          // Restore from base positions
          for (let k = 0; k < 2; k++) {
            const idx = (v + k) * 3;
            posAttr.array[idx]     = layer.basePositions[idx];
            posAttr.array[idx + 1] = layer.basePositions[idx + 1];
            posAttr.array[idx + 2] = layer.basePositions[idx + 2];
          }
        } else {
          // Collapse to zero
          for (let k = 0; k < 2; k++) {
            const idx = (v + k) * 3;
            posAttr.array[idx]     = 0;
            posAttr.array[idx + 1] = 0;
            posAttr.array[idx + 2] = 0;
          }
        }
        anyChanged = true;
      }

      if (anyChanged) {
        posAttr.needsUpdate = true;
        layer.mesh.computeLineDistances();
      }
    }
  }

  /**
   * Check if any layers exist.
   * @returns {boolean}
   */
  hasLayers() {
    return this.layers.size > 0;
  }

  /**
   * Get the pairs array for a specific interaction layer.
   * @param {string} type - Interaction type
   * @returns {{ a: number, b: number, distance: number }[] | null}
   */
  getLayerPairs(type) {
    const layer = this.layers.get(type);
    return layer ? layer.pairs : null;
  }

  /**
   * Get info about active layers for status messages.
   * @returns {{ type: string, count: number }[]}
   */
  getLayerInfo() {
    const info = [];
    for (const [type, layer] of this.layers) {
      info.push({ type, count: layer.pairs.length });
    }
    return info;
  }

  /**
   * Dispose all layers and clean up.
   */
  dispose() {
    this.removeAll();
    this.model = null;
    this.viewerGroup = null;
  }
}
