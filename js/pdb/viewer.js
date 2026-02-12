// ============================================================
// viewer.js — PDB Viewer mode controller
// Manages parsed protein model, InstancedMesh rendering,
// camera setup, and cleanup for mode switching.
// ============================================================

import * as THREE from 'three';
import { parsePDB } from './parser.js';
import { inferBonds } from './bondInference.js';
import { createAtomInstances, createBondInstances, createAtomMaterial, createBondMaterial } from './atomRenderer.js';

/**
 * PDBViewer — controls the viewer mode lifecycle.
 * Created once when entering viewer mode, disposed when leaving.
 */
export class PDBViewer {
  constructor(scene, camera, controls) {
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;

    this.model = null;
    this.bonds = null;
    this.atomMesh = null;
    this.bondMesh = null;
    this.lights = [];
    this.viewerGroup = new THREE.Group();
    this.viewerGroup.name = 'pdb-viewer';
    this.scene.add(this.viewerGroup);

    // Materials (shared across instances, white base so instance colors show through)
    this.atomMaterial = createAtomMaterial();
    this.bondMaterial = createBondMaterial();
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

    // Set up lights centered on the protein
    this._setupLighting(cx, cy, cz, size);
  }

  /**
   * Set up 3-point lighting centered on the protein.
   */
  _setupLighting(cx, cy, cz, size) {
    // Remove any previous viewer lights
    this._removeLights();

    const r = size * 0.8; // light distance from center

    // Key light — warm, strong, from upper-right-front
    const keyLight = new THREE.DirectionalLight(0xfff5e0, 3.0);
    keyLight.position.set(cx + r, cy + r * 0.8, cz + r);
    keyLight.target.position.set(cx, cy, cz);
    this.scene.add(keyLight);
    this.scene.add(keyLight.target);

    // Fill light — cool, from left to soften shadows
    const fillLight = new THREE.DirectionalLight(0xb0d0ff, 1.5);
    fillLight.position.set(cx - r, cy + r * 0.3, cz + r * 0.5);
    fillLight.target.position.set(cx, cy, cz);
    this.scene.add(fillLight);
    this.scene.add(fillLight.target);

    // Rim/back light — strong white, from behind for edge definition
    const rimLight = new THREE.DirectionalLight(0xffffff, 2.0);
    rimLight.position.set(cx, cy - r * 0.5, cz - r);
    rimLight.target.position.set(cx, cy, cz);
    this.scene.add(rimLight);
    this.scene.add(rimLight.target);

    // Ambient — bright base so nothing is fully black
    const ambient = new THREE.AmbientLight(0xffffff, 1.5);
    this.scene.add(ambient);

    // Hemisphere — sky/ground gradient for subtle depth cues
    const hemi = new THREE.HemisphereLight(0x88aacc, 0x444455, 0.6);
    this.scene.add(hemi);

    this.lights = [keyLight, keyLight.target, fillLight, fillLight.target,
                   rimLight, rimLight.target, ambient, hemi];
  }

  /**
   * Remove viewer lights from the scene.
   */
  _removeLights() {
    for (const light of this.lights) {
      this.scene.remove(light);
      if (light.dispose) light.dispose();
    }
    this.lights = [];
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
  }

  /**
   * Full cleanup when leaving viewer mode.
   */
  dispose() {
    this.clearStructure();
    this._removeLights();
    this.scene.remove(this.viewerGroup);
    this.atomMaterial.dispose();
    this.bondMaterial.dispose();
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
