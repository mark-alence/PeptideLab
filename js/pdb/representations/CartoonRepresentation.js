// ============================================================
// CartoonRepresentation.js — Cartoon ribbon/tube representation
// Per-chain: CA atoms -> CatmullRomCurve3 spline -> TubeGeometry
// Vertex colors by secondary structure type.
// ============================================================

import * as THREE from 'three';
import { BaseRepresentation } from './BaseRepresentation.js';
import { SS_COLORS } from '../constants.js';

const TUBE_RADIUS = 0.4;
const TUBE_SEGMENTS_PER_RESIDUE = 6;
const TUBE_RADIAL_SEGMENTS = 6;

export class CartoonRepresentation extends BaseRepresentation {
  build() {
    const { model, materials, viewerGroup } = this;
    const { residues, chains, positions } = model;

    this._chainMeshes = []; // { mesh, chainIdx, caIndices[] }

    for (let ci = 0; ci < chains.length; ci++) {
      const chain = chains[ci];
      const caIndices = [];
      const caPositions = [];
      const ssPerCA = [];

      // Collect CA atoms for this chain
      for (let ri = chain.residueStart; ri < chain.residueEnd; ri++) {
        const res = residues[ri];
        if (res.caIndex >= 0) {
          caIndices.push(res.caIndex);
          const idx = res.caIndex;
          caPositions.push(new THREE.Vector3(
            positions[idx * 3],
            positions[idx * 3 + 1],
            positions[idx * 3 + 2]
          ));
          ssPerCA.push(res.ss);
        }
      }

      // Need at least 2 CA atoms for a spline
      if (caPositions.length < 2) continue;

      // Build spline
      const curve = new THREE.CatmullRomCurve3(caPositions, false, 'catmullrom', 0.5);
      const tubularSegments = caPositions.length * TUBE_SEGMENTS_PER_RESIDUE;
      const geometry = new THREE.TubeGeometry(
        curve, tubularSegments, TUBE_RADIUS, TUBE_RADIAL_SEGMENTS, false
      );

      // Apply vertex colors based on secondary structure
      this._applyVertexSSColors(geometry, caPositions.length, ssPerCA, tubularSegments);

      const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.4,
        metalness: 0.05,
        envMap: materials.atom.envMap || null,
        envMapIntensity: 0.5,
      });

      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `cartoon-chain-${chain.id}`;
      mesh.frustumCulled = false;

      viewerGroup.add(mesh);
      this.meshes.push(mesh);
      this._chainMeshes.push({ mesh, material, chainIdx: ci, caIndices, ssPerCA });
    }

    // Cartoon has no atom/bond InstancedMesh
    this.atomMesh = null;
    this.bondMesh = null;
    this.baseScales = null;
    this.baseBondScales = null;
  }

  /**
   * Apply SS vertex colors to tube geometry.
   * Each tube cross-section ring maps to a position along the spline.
   * We interpolate SS color based on which CA atom segment we're in.
   */
  _applyVertexSSColors(geometry, caCount, ssPerCA, tubularSegments) {
    const posAttr = geometry.attributes.position;
    const vertexCount = posAttr.count;
    const colors = new Float32Array(vertexCount * 3);
    const ringSize = TUBE_RADIAL_SEGMENTS + 1; // vertices per cross-section ring
    const color = new THREE.Color();

    for (let i = 0; i < vertexCount; i++) {
      // Which ring does this vertex belong to?
      const ringIdx = Math.floor(i / ringSize);
      // Map ring to CA index
      const t = ringIdx / tubularSegments; // 0..1
      const caFloat = t * (caCount - 1);
      const caIdx = Math.min(Math.round(caFloat), caCount - 1);

      const ss = ssPerCA[caIdx];
      color.setHex(SS_COLORS[ss] || SS_COLORS[0]);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  }

  applyColors(atomColors) {
    // Map atom colors to per-residue via CA atom index, then update vertex colors
    for (const cm of this._chainMeshes) {
      const geometry = cm.mesh.geometry;
      const posAttr = geometry.attributes.position;
      const colorAttr = geometry.attributes.color;
      const vertexCount = posAttr.count;
      const ringSize = TUBE_RADIAL_SEGMENTS + 1;
      const caCount = cm.caIndices.length;
      const tubularSegments = caCount * TUBE_SEGMENTS_PER_RESIDUE;

      for (let i = 0; i < vertexCount; i++) {
        const ringIdx = Math.floor(i / ringSize);
        const t = ringIdx / tubularSegments;
        const caFloat = t * (caCount - 1);
        const caLocalIdx = Math.min(Math.round(caFloat), caCount - 1);
        const atomIdx = cm.caIndices[caLocalIdx];
        const c = atomColors[atomIdx];

        colorAttr.setXYZ(i, c.r, c.g, c.b);
      }
      colorAttr.needsUpdate = true;
    }
  }

  applyVisibility(atomVisible) {
    // Hide chain mesh if all CA atoms in that chain are hidden
    for (const cm of this._chainMeshes) {
      let anyVisible = false;
      for (const caIdx of cm.caIndices) {
        if (atomVisible[caIdx]) {
          anyVisible = true;
          break;
        }
      }
      cm.mesh.visible = anyVisible;
    }
  }

  dispose() {
    // Dispose materials we created (the vertexColors materials are unique per chain)
    for (const cm of this._chainMeshes) {
      if (cm.material) cm.material.dispose();
    }
    this._chainMeshes = [];
    super.dispose();
  }
}
