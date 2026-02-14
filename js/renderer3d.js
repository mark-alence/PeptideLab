// ============================================================
// renderer3d.js — Three.js scene, OrbitControls camera, lights
// ============================================================

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';
import { GRID_W, GRID_H } from './constants.js';
import { GameEvents } from './ui.js';

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
camera3D.position.set(cx, 25, cz + 30);

// --- WebGL Renderer ---
export const renderer = new THREE.WebGLRenderer({ antialias: true });
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

// --- OrbitControls (builder mode) ---
const orbitControls = new OrbitControls(camera3D, renderer.domElement);
orbitControls.target.set(cx, 0, cz);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.08;
orbitControls.minDistance = 10;
orbitControls.maxDistance = 80;
orbitControls.maxPolarAngle = Math.PI / 2 - 0.05;
// Left click free for placement — orbit with right button
orbitControls.mouseButtons = {
  LEFT: null,                        // free for grid clicks
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};
// Touch: one-finger orbit, two-finger dolly+pan
orbitControls.touches = {
  ONE: THREE.TOUCH.ROTATE,
  TWO: THREE.TOUCH.DOLLY_PAN,
};
orbitControls.update();

// --- TrackballControls (viewer mode — infinite free rotation) ---
const trackballControls = new TrackballControls(camera3D, renderer.domElement);
trackballControls.rotateSpeed = 2.0;
trackballControls.zoomSpeed = 1.2;
trackballControls.panSpeed = 0.8;
trackballControls.dynamicDampingFactor = 0.12;
trackballControls.enabled = false;

// Active controls reference (live ES module binding)
export let controls = orbitControls;

// --- Camera gesture events (fade UI during orbit/pan/zoom) ---
orbitControls.addEventListener('start', () => GameEvents.emit('cameraGestureStart'));
orbitControls.addEventListener('end', () => GameEvents.emit('cameraGestureEnd'));
trackballControls.addEventListener('start', () => GameEvents.emit('cameraGestureStart'));
trackballControls.addEventListener('end', () => GameEvents.emit('cameraGestureEnd'));

// --- Camera focus: smoothly animate target to a world position ---
const defaultTarget = new THREE.Vector3(cx, 0, cz);
let cameraAnim = null;

export function focusCamera(worldX, worldZ) {
  cameraAnim = {
    startTarget: controls.target.clone(),
    endTarget: new THREE.Vector3(worldX, 0, worldZ),
    startTime: performance.now(),
    duration: 400,
  };
}

export function resetCamera() {
  cameraAnim = {
    startTarget: controls.target.clone(),
    endTarget: defaultTarget.clone(),
    startTime: performance.now(),
    duration: 400,
  };
  GameEvents.emit('cameraReset');
}

export function updateCameraAnim() {
  if (!cameraAnim) return;
  const t = Math.min((performance.now() - cameraAnim.startTime) / cameraAnim.duration, 1);
  const ease = t * (2 - t); // ease-out quad
  controls.target.lerpVectors(cameraAnim.startTarget, cameraAnim.endTarget, ease);
  if (t >= 1) cameraAnim = null;
}

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
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;
  camera3D.aspect = w / h;
  camera3D.updateProjectionMatrix();
  renderer.setSize(w, h);
  cssRenderer.setSize(w, h);
  trackballControls.handleResize();
}

// --- Expose renderer canvas for raycasting ---
export function getCanvas() {
  return renderer.domElement;
}

// --- Viewer mode controls ---
export function configureViewerControls() {
  const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

  orbitControls.enabled = false;
  trackballControls.target.copy(orbitControls.target);
  trackballControls.minDistance = 0;
  trackballControls.maxDistance = Infinity;
  // Disable pan on touch devices: TrackballControls' TOUCH_ZOOM_PAN
  // combines zoom and pan simultaneously, causing erratic pinch-zoom.
  // With noPan the two-finger gesture cleanly zooms only.
  trackballControls.noPan = isTouchDevice;
  trackballControls.enabled = true;
  trackballControls.handleResize();
  controls = trackballControls;
}

// --- Restore builder mode controls ---
export function configureBuilderControls() {
  const cx = GRID_W / 2;
  const cz = GRID_H / 2;
  trackballControls.enabled = false;

  orbitControls.enabled = true;
  orbitControls.maxPolarAngle = Math.PI / 2 - 0.05;
  orbitControls.minDistance = 10;
  orbitControls.maxDistance = 80;
  orbitControls.target.set(cx, 0, cz);
  camera3D.position.set(cx, 25, cz + 30);
  camera3D.near = 0.1;
  camera3D.far = 500;
  camera3D.updateProjectionMatrix();
  orbitControls.update();

  controls = orbitControls;
}

// --- Scene background / fog / lighting control for viewer mode ---
export function setViewerBackground() {
  scene.fog = null;
  // Hide builder lights — viewer adds its own
  ambientLight.visible = false;
  hemiLight.visible = false;
  dirLight.visible = false;
  // ACES tone mapping for cinematic look (MeshStandardMaterial handles it well)
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
}

export function setBuilderBackground() {
  scene.background = new THREE.Color(0x1e2a3d);
  scene.fog = new THREE.FogExp2(0x1e2a3d, 0.003);
  // Restore builder lights
  ambientLight.visible = true;
  hemiLight.visible = true;
  dirLight.visible = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.7;
}
