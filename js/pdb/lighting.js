// ============================================================
// lighting.js — Cinematic lighting for PDB viewer
// Refined 3-point rig, synthetic environment map via
// PMREMGenerator, and dark radial gradient background.
// ============================================================

import * as THREE from 'three';

/**
 * Create cinematic 3-point lighting centered on the protein.
 * Warm key, cool fill, strong rim — tuned for MeshStandardMaterial.
 *
 * @param {THREE.Scene} scene
 * @param {number} cx - Protein center X
 * @param {number} cy - Protein center Y
 * @param {number} cz - Protein center Z
 * @param {number} size - Protein bounding box max dimension
 * @returns {THREE.Object3D[]} Array of lights + targets (for disposal)
 */
export function createViewerLighting(scene, cx, cy, cz, size) {
  const lights = [];
  const r = size * 0.8;

  // Key light — warm, from upper-right-front
  const keyLight = new THREE.DirectionalLight(0xfff0dd, 2.0);
  keyLight.position.set(cx + r, cy + r * 0.8, cz + r);
  keyLight.target.position.set(cx, cy, cz);
  scene.add(keyLight);
  scene.add(keyLight.target);
  lights.push(keyLight, keyLight.target);

  // Fill light — cool blue, from left to soften shadows
  const fillLight = new THREE.DirectionalLight(0x8ab4f8, 1.0);
  fillLight.position.set(cx - r, cy + r * 0.3, cz + r * 0.5);
  fillLight.target.position.set(cx, cy, cz);
  scene.add(fillLight);
  scene.add(fillLight.target);
  lights.push(fillLight, fillLight.target);

  // Rim/back light — strong white for edge definition
  const rimLight = new THREE.DirectionalLight(0xffffff, 2.5);
  rimLight.position.set(cx, cy - r * 0.5, cz - r);
  rimLight.target.position.set(cx, cy, cz);
  scene.add(rimLight);
  scene.add(rimLight.target);
  lights.push(rimLight, rimLight.target);

  // Ambient — reduced so SSAO depth shadows are visible
  const ambient = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(ambient);
  lights.push(ambient);

  // Hemisphere — subtle sky/ground gradient
  const hemi = new THREE.HemisphereLight(0x88aacc, 0x444455, 0.3);
  scene.add(hemi);
  lights.push(hemi);

  return lights;
}

/**
 * Remove viewer lights from the scene and dispose them.
 *
 * @param {THREE.Scene} scene
 * @param {THREE.Object3D[]} lights
 */
export function removeViewerLighting(scene, lights) {
  for (const light of lights) {
    scene.remove(light);
    if (light.dispose) light.dispose();
  }
}

/**
 * Create a synthetic studio environment map via PMREMGenerator.
 * Used for MeshStandardMaterial reflections.
 *
 * @param {THREE.WebGLRenderer} renderer
 * @returns {THREE.Texture} Pre-filtered environment map
 */
export function createEnvironmentMap(renderer) {
  const pmremGenerator = new THREE.PMREMGenerator(renderer);

  // Build a synthetic "studio" environment scene
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x0a0f18);

  // Warm overhead panel
  const topGeo = new THREE.PlaneGeometry(10, 10);
  const topMat = new THREE.MeshBasicMaterial({ color: 0xfff5e8, side: THREE.DoubleSide });
  const topLight = new THREE.Mesh(topGeo, topMat);
  topLight.position.set(0, 5, 0);
  topLight.lookAt(0, 0, 0);
  envScene.add(topLight);

  // Cool side panel
  const sideGeo = new THREE.PlaneGeometry(10, 10);
  const sideMat = new THREE.MeshBasicMaterial({ color: 0xa0c0e0, side: THREE.DoubleSide });
  const sideLight = new THREE.Mesh(sideGeo, sideMat);
  sideLight.position.set(-5, 0, 0);
  sideLight.lookAt(0, 0, 0);
  envScene.add(sideLight);

  // Generate pre-filtered mipmap environment
  const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
  pmremGenerator.dispose();

  // Clean up temporary scene
  topGeo.dispose();
  topMat.dispose();
  sideGeo.dispose();
  sideMat.dispose();

  return envMap;
}

/**
 * Create a dark radial gradient background texture.
 * Center: dark blue-gray (#1a2030), edges: near-black (#060810).
 *
 * @returns {THREE.CanvasTexture}
 */
export function createRadialGradientBackground() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');

  const gradient = ctx.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size * 0.7
  );
  gradient.addColorStop(0, '#1a2030');
  gradient.addColorStop(1, '#060810');

  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  return texture;
}
