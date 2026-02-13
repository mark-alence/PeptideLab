// ============================================================
// LinesRepresentation.js — Wireframe bond-only representation
// Thin colored lines between bonded atoms, no atom spheres.
// Each bond is split into 2 segments (A->mid, mid->B) for
// per-atom coloring, rendered with THREE.LineSegments.
// ============================================================

import * as THREE from 'three';
import { BaseRepresentation } from './BaseRepresentation.js';
import { ELEMENT_COLORS, DEFAULT_COLOR } from '../constants.js';

export class LinesRepresentation extends BaseRepresentation {
  build() {
    const { model, bonds, viewerGroup } = this;
    const { positions, atoms, atomCount } = model;
    const bondCount = bonds.length / 2;

    if (bondCount === 0) {
      this.atomMesh = null;
      this.bondMesh = null;
      return;
    }

    // 4 vertices per bond: A, midpoint, midpoint, B (2 line segments)
    const vertCount = bondCount * 4;
    const posArray = new Float32Array(vertCount * 3);
    const colorArray = new Float32Array(vertCount * 3);

    // Also store which atom owns each vertex for recoloring
    this._vertexAtomIndex = new Uint32Array(vertCount);
    // Store base positions for visibility restore
    this._basePositions = new Float32Array(vertCount * 3);
    // Map bond index -> [atomA, atomB] for visibility checks
    this._bondAtoms = new Uint32Array(bondCount * 2);

    const color = new THREE.Color();

    for (let bi = 0; bi < bondCount; bi++) {
      const a = bonds[bi * 2];
      const b = bonds[bi * 2 + 1];
      this._bondAtoms[bi * 2] = a;
      this._bondAtoms[bi * 2 + 1] = b;

      const ax = positions[a * 3], ay = positions[a * 3 + 1], az = positions[a * 3 + 2];
      const bx = positions[b * 3], by = positions[b * 3 + 1], bz = positions[b * 3 + 2];
      const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;

      const v = bi * 4; // first vertex index for this bond

      // Segment 1: A -> midpoint (colored by atom A)
      posArray[(v) * 3] = ax;     posArray[(v) * 3 + 1] = ay;     posArray[(v) * 3 + 2] = az;
      posArray[(v + 1) * 3] = mx; posArray[(v + 1) * 3 + 1] = my; posArray[(v + 1) * 3 + 2] = mz;

      // Segment 2: midpoint -> B (colored by atom B)
      posArray[(v + 2) * 3] = mx; posArray[(v + 2) * 3 + 1] = my; posArray[(v + 2) * 3 + 2] = mz;
      posArray[(v + 3) * 3] = bx; posArray[(v + 3) * 3 + 1] = by; posArray[(v + 3) * 3 + 2] = bz;

      // Atom ownership per vertex
      this._vertexAtomIndex[v] = a;
      this._vertexAtomIndex[v + 1] = a;
      this._vertexAtomIndex[v + 2] = b;
      this._vertexAtomIndex[v + 3] = b;

      // Default element colors
      color.setHex(ELEMENT_COLORS[atoms[a].element] || DEFAULT_COLOR);
      colorArray[(v) * 3] = color.r;     colorArray[(v) * 3 + 1] = color.g;     colorArray[(v) * 3 + 2] = color.b;
      colorArray[(v + 1) * 3] = color.r; colorArray[(v + 1) * 3 + 1] = color.g; colorArray[(v + 1) * 3 + 2] = color.b;

      color.setHex(ELEMENT_COLORS[atoms[b].element] || DEFAULT_COLOR);
      colorArray[(v + 2) * 3] = color.r; colorArray[(v + 2) * 3 + 1] = color.g; colorArray[(v + 2) * 3 + 2] = color.b;
      colorArray[(v + 3) * 3] = color.r; colorArray[(v + 3) * 3 + 1] = color.g; colorArray[(v + 3) * 3 + 2] = color.b;
    }

    // Save base positions for visibility toggling
    this._basePositions.set(posArray);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));

    this._material = new THREE.LineBasicMaterial({ vertexColors: true });
    this._lineSegments = new THREE.LineSegments(geometry, this._material);
    this._lineSegments.name = 'lines-rep';
    this._lineSegments.frustumCulled = false;

    viewerGroup.add(this._lineSegments);
    this.meshes.push(this._lineSegments);

    // No atom or bond InstancedMesh
    this.atomMesh = null;
    this.bondMesh = null;
    this.baseScales = null;
    this.baseBondScales = null;
  }

  applyColors(atomColors) {
    if (!this._lineSegments) return;
    const colorAttr = this._lineSegments.geometry.attributes.color;
    const vertCount = this._vertexAtomIndex.length;

    for (let v = 0; v < vertCount; v++) {
      const c = atomColors[this._vertexAtomIndex[v]];
      colorAttr.setXYZ(v, c.r, c.g, c.b);
    }
    colorAttr.needsUpdate = true;
  }

  applyVisibility(atomVisible, scaleMultipliers = null) {
    if (!this._lineSegments) return;
    const posAttr = this._lineSegments.geometry.attributes.position;
    const bondCount = this._bondAtoms.length / 2;

    for (let bi = 0; bi < bondCount; bi++) {
      const a = this._bondAtoms[bi * 2];
      const b = this._bondAtoms[bi * 2 + 1];
      const visible = atomVisible[a] && atomVisible[b];
      const v = bi * 4;

      if (visible) {
        // Restore from base positions
        for (let k = 0; k < 4; k++) {
          const idx = (v + k) * 3;
          posAttr.array[idx] = this._basePositions[idx];
          posAttr.array[idx + 1] = this._basePositions[idx + 1];
          posAttr.array[idx + 2] = this._basePositions[idx + 2];
        }
      } else {
        // Collapse to degenerate zero-length segments
        for (let k = 0; k < 4; k++) {
          const idx = (v + k) * 3;
          posAttr.array[idx] = 0;
          posAttr.array[idx + 1] = 0;
          posAttr.array[idx + 2] = 0;
        }
      }
    }
    posAttr.needsUpdate = true;
  }

  dispose() {
    if (this._material) {
      this._material.dispose();
      this._material = null;
    }
    this._lineSegments = null;
    this._vertexAtomIndex = null;
    this._basePositions = null;
    this._bondAtoms = null;
    super.dispose();
  }
}
