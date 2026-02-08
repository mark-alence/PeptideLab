// ============================================================
// grid3d.js — Ground plane, grid lines, cell highlighting
// ============================================================

import * as THREE from 'three';
import { GRID_COLS, GRID_ROWS, CELL_SIZE, GRID_W, GRID_H } from './constants.js';
import { scene, camera3D, getCanvas } from './renderer3d.js';

// --- Ground plane ---
const groundGeo = new THREE.PlaneGeometry(GRID_W + 10, GRID_H + 10);
const groundMat = new THREE.MeshStandardMaterial({
  color: 0x222e42,
  roughness: 0.8,
  metalness: 0.08,
});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI / 2;
ground.position.set(GRID_W / 2, -0.01, GRID_H / 2);
ground.receiveShadow = false;

// --- Grid lines ---
function buildGridLines() {
  const points = [];
  for (let c = 0; c <= GRID_COLS; c++) {
    const x = c * CELL_SIZE;
    points.push(new THREE.Vector3(x, 0, 0));
    points.push(new THREE.Vector3(x, 0, GRID_H));
  }
  for (let r = 0; r <= GRID_ROWS; r++) {
    const z = r * CELL_SIZE;
    points.push(new THREE.Vector3(0, 0, z));
    points.push(new THREE.Vector3(GRID_W, 0, z));
  }
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = new THREE.LineBasicMaterial({ color: 0x4a5a6e, transparent: true, opacity: 0.4 });
  return new THREE.LineSegments(geo, mat);
}

const gridLines = buildGridLines();

// --- Highlight mesh (shows hovered cell) ---
const hlGeo = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE);
const hlMat = new THREE.MeshBasicMaterial({
  color: 0xffc107,
  transparent: true,
  opacity: 0.25,
  side: THREE.DoubleSide,
});
const highlight = new THREE.Mesh(hlGeo, hlMat);
highlight.rotation.x = -Math.PI / 2;
highlight.position.y = 0.01;
highlight.visible = false;

// --- Raycasting ---
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredCell = null;

export function updatePointerCoords(clientX, clientY) {
  const w = window.visualViewport?.width ?? window.innerWidth;
  const h = window.visualViewport?.height ?? window.innerHeight;
  mouse.x = (clientX / w) * 2 - 1;
  mouse.y = -(clientY / h) * 2 + 1;
}

function onMouseMove(e) {
  updatePointerCoords(e.clientX, e.clientY);
}

export function updateHover() {
  raycaster.setFromCamera(mouse, camera3D);
  const hits = raycaster.intersectObject(ground);
  if (hits.length > 0) {
    const p = hits[0].point;
    const col = Math.floor(p.x / CELL_SIZE);
    const row = Math.floor(p.z / CELL_SIZE);
    if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
      hoveredCell = { col, row };
      highlight.position.x = col * CELL_SIZE + CELL_SIZE / 2;
      highlight.position.z = row * CELL_SIZE + CELL_SIZE / 2;
      highlight.visible = true;
      if (dragMode) {
        ring.position.x = highlight.position.x;
        ring.position.z = highlight.position.z;
        ring.visible = true;
      }
      return;
    }
  }
  hoveredCell = null;
  highlight.visible = false;
  ring.visible = false;
}

export function getHoveredCell() {
  return hoveredCell;
}

export function hideHighlight() {
  highlight.visible = false;
  ring.visible = false;
}

export function cellToWorld(col, row) {
  return new THREE.Vector3(
    col * CELL_SIZE + CELL_SIZE / 2,
    0,
    row * CELL_SIZE + CELL_SIZE / 2
  );
}

export function setHighlightValid(valid) {
  const c = valid ? 0xffc107 : 0xff4444;
  hlMat.color.set(c);
  ringMat.color.set(c);
}

// --- Drag-mode highlight: brighter + outline ring ---
const ringGeo = new THREE.RingGeometry(CELL_SIZE * 0.42, CELL_SIZE * 0.48, 4);
const ringMat = new THREE.MeshBasicMaterial({
  color: 0xffc107,
  transparent: true,
  opacity: 0.7,
  side: THREE.DoubleSide,
});
const ring = new THREE.Mesh(ringGeo, ringMat);
ring.rotation.x = -Math.PI / 2;
ring.rotation.z = Math.PI / 4; // rotate 45° so corners align with square
ring.position.y = 0.02;
ring.visible = false;

let dragMode = false;

export function setDragMode(active) {
  dragMode = active;
  hlMat.opacity = active ? 0.4 : 0.25;
  if (!active) ring.visible = false;
}

// --- Occupied cell markers (colored square under each placed AA) ---
const cellMarkers = {}; // "col,row" → mesh

const markerGeo = new THREE.PlaneGeometry(CELL_SIZE * 0.92, CELL_SIZE * 0.92);

export function addCellMarker(col, row, color) {
  const key = `${col},${row}`;
  if (cellMarkers[key]) return;

  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    transparent: true,
    opacity: 0.25,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(markerGeo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(
    col * CELL_SIZE + CELL_SIZE / 2,
    0.005,
    row * CELL_SIZE + CELL_SIZE / 2
  );
  scene.add(mesh);
  cellMarkers[key] = mesh;
}

export function removeCellMarker(col, row) {
  const key = `${col},${row}`;
  const mesh = cellMarkers[key];
  if (mesh) {
    scene.remove(mesh);
    mesh.material.dispose();
    delete cellMarkers[key];
  }
}

export function moveCellMarker(oldCol, oldRow, newCol, newRow) {
  const oldKey = `${oldCol},${oldRow}`;
  const mesh = cellMarkers[oldKey];
  if (!mesh) return;
  delete cellMarkers[oldKey];
  mesh.position.set(
    newCol * CELL_SIZE + CELL_SIZE / 2,
    0.005,
    newRow * CELL_SIZE + CELL_SIZE / 2
  );
  cellMarkers[`${newCol},${newRow}`] = mesh;
}

// --- Create (add to scene) ---
export function createGrid() {
  scene.add(ground);
  scene.add(gridLines);
  scene.add(highlight);
  scene.add(ring);
  window.addEventListener('mousemove', onMouseMove);
}
