// ============================================================
// renderer3d.js — Three.js scene, OrbitControls camera, lights
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GRID_W, GRID_H } from './constants.js';

export const SCALE = 0.1; // 2D pixels → 3D units (kept for structures)

// --- Scene ---
export const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1e2a3d);
scene.fog = new THREE.FogExp2(0x1e2a3d, 0.003);

// --- Camera ---
export const camera3D = new THREE.PerspectiveCamera(
  45, window.innerWidth / window.innerHeight, 0.1, 500
);
// Start elevated, looking at grid center
const cx = GRID_W / 2;
const cz = GRID_H / 2;
camera3D.position.set(cx, 40, cz + 35);

// --- WebGL Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.7;

// Replace existing display canvas
const oldCanvas = document.getElementById('display');
if (oldCanvas) {
  renderer.domElement.id = 'display';
  renderer.domElement.style.position = 'absolute';
  renderer.domElement.style.zIndex = '1';
  oldCanvas.parentNode.replaceChild(renderer.domElement, oldCanvas);
}

// --- CSS2DRenderer (HTML labels overlaid on 3D) ---
export const cssRenderer = new CSS2DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
cssRenderer.domElement.style.position = 'absolute';
cssRenderer.domElement.style.top = '0';
cssRenderer.domElement.style.left = '0';
cssRenderer.domElement.style.zIndex = '2';
cssRenderer.domElement.style.pointerEvents = 'none';
renderer.domElement.parentNode.appendChild(cssRenderer.domElement);

// --- OrbitControls ---
export const controls = new OrbitControls(camera3D, renderer.domElement);
controls.target.set(cx, 0, cz);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 10;
controls.maxDistance = 80;
controls.maxPolarAngle = Math.PI / 2 - 0.05;
// Left click free for placement — orbit with right button
controls.mouseButtons = {
  LEFT: null,                        // free for grid clicks
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};
controls.update();

// --- Lights ---
const ambientLight = new THREE.AmbientLight(0xbccce8, 0.7);
scene.add(ambientLight);

// Hemisphere fill — sky/ground gradient for depth
const hemiLight = new THREE.HemisphereLight(0x446688, 0x222035, 0.5);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xfff5e0, 1.6);
dirLight.position.set(cx + 20, 30, cz + 10);
dirLight.castShadow = false;
dirLight.target.position.set(cx, 0, cz);
scene.add(dirLight);
scene.add(dirLight.target);

// --- Update controls (call each frame) ---
export function updateControls() {
  controls.update();
}

// no-op for compatibility
export function updateParticles() {}

// --- Render ---
export function render3D() {
  renderer.render(scene, camera3D);
  cssRenderer.render(scene, camera3D);
}

// --- Resize ---
export function resize3D() {
  camera3D.aspect = window.innerWidth / window.innerHeight;
  camera3D.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  cssRenderer.setSize(window.innerWidth, window.innerHeight);
}

// --- Expose renderer canvas for raycasting ---
export function getCanvas() {
  return renderer.domElement;
}
