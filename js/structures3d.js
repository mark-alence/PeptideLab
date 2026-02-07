// ============================================================
// structures3d.js — 3D molecular structures (atoms, bonds, charges)
// ============================================================

import * as THREE from 'three';
import { FULL, ACOL, ARAD, STRUCT_SCALE, BB_ATOMS } from './structures.js';
import { SCALE } from './renderer3d.js';
import { computeRotamerPositions } from './rotamers.js';

// Atom element colors for 3D
const ELEM_COLORS = {
  C: new THREE.Color(0x909090),
  N: new THREE.Color(0x6699ff),
  O: new THREE.Color(0xff5555),
  S: new THREE.Color(0xeedd44),
  H: new THREE.Color(0xcccccc),
};

// Emissive glow for certain elements
const ELEM_EMISSIVE = {
  N: new THREE.Color(0x334477),
  O: new THREE.Color(0x882222),
  S: new THREE.Color(0x666600),
};

// Shared geometries
const atomGeos = {};
function getAtomGeo(el) {
  if (!atomGeos[el]) {
    const r = ARAD[el] * STRUCT_SCALE * SCALE * 0.8;
    atomGeos[el] = new THREE.SphereGeometry(Math.max(r, 0.08), 8, 6);
  }
  return atomGeos[el];
}

const bondGeo = new THREE.CylinderGeometry(0.04, 0.04, 1, 6);

// Store animated elements for per-frame updates
const chargeIndicators = [];
const phFlashElements = [];
const forcefields = [];
let phFlashCharge = null;

// --- Forcefield shader ---
const ffVertexShader = `
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vNormal = normalize(normalMatrix * normal);
  vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
  vViewDir = normalize(-mvPos.xyz);
  gl_Position = projectionMatrix * mvPos;
}
`;

const ffFragmentShader = `
uniform vec3 uColor;
uniform float uTime;
uniform float uIntensity;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  float fresnel = pow(1.0 - abs(dot(vViewDir, vNormal)), 2.5);
  float pulse = 0.85 + 0.15 * sin(uTime * 2.0);
  float alpha = fresnel * pulse * uIntensity * 0.75;
  vec3 col = uColor * (1.0 + fresnel * 0.5);
  gl_FragColor = vec4(col, alpha);
}
`;

const ffGeometry = new THREE.SphereGeometry(1.0, 32, 24);

const S = STRUCT_SCALE * SCALE;

// structureRefs[key] = { atomMeshes, bondData, chargeGroup, ffMesh, glowMeshes, plusGroup, hisFFMesh, mirror }
const structureRefs = {};

// Smooth rotamer transitions
const activeTransitions = {};
export const currentAtoms = {};
const TRANSITION_DURATION = 350;

// ============================================================
// Build a structure group at direct 3D world position
// opts: { x3d, y3d, z3d, mirror }
// ============================================================
export function buildStructureGroup(letter, opts = {}) {
  const struct = FULL[letter];
  const mirror = opts.mirror || false;
  const mx = mirror ? -1 : 1;
  const group = new THREE.Group();

  const baseX = opts.x3d || 0;
  const baseY = (opts.y3d !== undefined ? opts.y3d : 0.3);
  const baseZ = opts.z3d || 0;

  const atomMeshes = [];
  const bondData = [];

  // --- Atoms ---
  for (let ai = 0; ai < struct.atoms.length; ai++) {
    const atom = struct.atoms[ai];
    const lx = atom.x * S * mx;
    const ly = atom.y * S;
    const lz = (atom.z || 0) * S;

    const mat = new THREE.MeshStandardMaterial({
      color: ELEM_COLORS[atom.el] || ELEM_COLORS.C,
      roughness: 0.5,
      metalness: 0.1,
      emissive: ELEM_EMISSIVE[atom.el] || new THREE.Color(0x000000),
      emissiveIntensity: 0.3,
    });

    const mesh = new THREE.Mesh(getAtomGeo(atom.el), mat);
    mesh.position.set(lx, ly, lz);
    mesh.castShadow = true;
    group.add(mesh);
    atomMeshes.push(mesh);
  }

  // --- Bonds ---
  for (const [a, b, isDouble] of struct.bonds) {
    const atomA = struct.atoms[a];
    const atomB = struct.atoms[b];

    const ax = atomA.x * S * mx;
    const ay = atomA.y * S;
    const az = (atomA.z || 0) * S;
    const bx = atomB.x * S * mx;
    const by = atomB.y * S;
    const bz = (atomB.z || 0) * S;

    const primaryMesh = addBondReturning(group, ax, ay, az, bx, by, bz, false);
    bondData.push({ mesh: primaryMesh, fromIdx: a, toIdx: b, isSecondary: false });

    if (isDouble) {
      const bondDir = new THREE.Vector3(bx - ax, by - ay, bz - az);
      const up = new THREE.Vector3(0, 1, 0);
      const perp = new THREE.Vector3().crossVectors(bondDir, up);
      if (perp.lengthSq() < 0.0001) {
        perp.crossVectors(bondDir, new THREE.Vector3(1, 0, 0));
      }
      perp.normalize().multiplyScalar(0.06);
      const secMesh = addBondReturning(group, ax + perp.x, ay + perp.y, az + perp.z,
                      bx + perp.x, by + perp.y, bz + perp.z, true);
      bondData.push({ mesh: secMesh, fromIdx: a, toIdx: b, isSecondary: true });
    }
  }

  const refs = { atomMeshes, bondData, mirror: mx, chargeGroup: null, ffMesh: null,
                 glowMeshes: null, plusGroup: null, hisFFMesh: null };

  // --- Charge indicator ---
  if (struct.charge !== 0 && struct.chargeAtom >= 0) {
    const ca = struct.atoms[struct.chargeAtom];
    const cx = ca.x * S * mx;
    const cy = ca.y * S + ARAD[ca.el] * S + 0.15;
    const caz = (ca.z || 0) * S;

    const chargeGroup = new THREE.Group();
    const chargeMat = new THREE.MeshStandardMaterial({
      color: struct.charge > 0 ? 0xffdd55 : 0xff8877,
      emissive: struct.charge > 0 ? 0xffdd55 : 0xff8877,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });

    const hBar = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.03, 0.03), chargeMat);
    chargeGroup.add(hBar);

    if (struct.charge > 0) {
      const vBar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), chargeMat);
      chargeGroup.add(vBar);
    }

    chargeGroup.position.set(cx, cy, caz);
    group.add(chargeGroup);
    chargeIndicators.push(chargeMat);
    refs.chargeGroup = chargeGroup;
    refs.chargeAtomIdx = struct.chargeAtom;

    // Charge forcefield
    const caIdx = struct.chargeAtom;
    const fgIndices = [caIdx];
    for (const [a, b] of struct.bonds) {
      if (a === caIdx) fgIndices.push(b);
      else if (b === caIdx) fgIndices.push(a);
    }
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const idx of fgIndices) {
      sumX += struct.atoms[idx].x * S * mx;
      sumY += struct.atoms[idx].y * S;
      sumZ += (struct.atoms[idx].z || 0) * S;
    }
    const ffCX = sumX / fgIndices.length;
    const ffCY = sumY / fgIndices.length;
    const ffCZ = sumZ / fgIndices.length;
    let ffR = 0;
    for (const idx of fgIndices) {
      const dx = struct.atoms[idx].x * S * mx - ffCX;
      const dy = struct.atoms[idx].y * S - ffCY;
      const dz = (struct.atoms[idx].z || 0) * S - ffCZ;
      ffR = Math.max(ffR, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    ffR += 0.25;

    const ffColor = struct.charge > 0
      ? new THREE.Color(0xffcc33)
      : new THREE.Color(0xff5544);
    const ffMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: ffColor },
        uTime: { value: 0.0 },
        uIntensity: { value: 1.0 },
      },
      vertexShader: ffVertexShader,
      fragmentShader: ffFragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const ffMesh = new THREE.Mesh(ffGeometry, ffMat);
    ffMesh.position.set(ffCX, ffCY, ffCZ);
    ffMesh.scale.setScalar(ffR);
    group.add(ffMesh);
    forcefields.push({ mat: ffMat, type: struct.charge > 0 ? 'pos' : 'neg' });
    refs.ffMesh = ffMesh;
    refs.ffIndices = fgIndices;
  }

  // --- Histidine pH flash ---
  if (letter === 'H') {
    const bbLen = BB_ATOMS.length;
    const glowMeshes = [];
    for (const idx of [2, 5]) {
      const atom = struct.atoms[bbLen + idx];
      const lx = atom.x * S * mx;
      const ly = atom.y * S;
      const lz = (atom.z || 0) * S;

      const glowGeo = new THREE.SphereGeometry(0.12, 8, 6);
      const glowMat = new THREE.MeshStandardMaterial({
        color: 0xaaccff,
        emissive: 0xaaccff,
        emissiveIntensity: 0,
        transparent: true,
        opacity: 0.4,
        roughness: 0.2,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(lx, ly, lz);
      group.add(glow);
      phFlashElements.push(glowMat);
      glowMeshes.push({ mesh: glow, scIdx: idx });
    }
    refs.glowMeshes = glowMeshes;

    const ringAtom = struct.atoms[bbLen + 4];
    const rx = ringAtom.x * S * mx;
    const ry = ringAtom.y * S + 0.2;
    const plusMat = new THREE.MeshStandardMaterial({
      color: 0xffdd55,
      emissive: 0xffdd55,
      emissiveIntensity: 0,
      transparent: true,
      opacity: 0,
    });
    const plusH = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.02, 0.02), plusMat);
    const plusV = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.15, 0.02), plusMat);
    const plusGroup = new THREE.Group();
    plusGroup.add(plusH);
    plusGroup.add(plusV);
    const rz = (ringAtom.z || 0) * S;
    plusGroup.position.set(rx, ry, rz);
    group.add(plusGroup);
    phFlashCharge = plusMat;
    refs.plusGroup = plusGroup;
    refs.plusScIdx = 4;

    const hisFFMat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x4488ff) },
        uTime: { value: 0.0 },
        uIntensity: { value: 0.0 },
      },
      vertexShader: ffVertexShader,
      fragmentShader: ffFragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    let hSumX = 0, hSumY = 0, hSumZ = 0;
    for (let ri = 1; ri <= 5; ri++) {
      hSumX += struct.atoms[bbLen + ri].x * S * mx;
      hSumY += struct.atoms[bbLen + ri].y * S;
      hSumZ += (struct.atoms[bbLen + ri].z || 0) * S;
    }
    const hisCX = hSumX / 5;
    const hisCY = hSumY / 5;
    const hisCZ = hSumZ / 5;
    let hisR = 0;
    for (let ri = 1; ri <= 5; ri++) {
      const dx = struct.atoms[bbLen + ri].x * S * mx - hisCX;
      const dy = struct.atoms[bbLen + ri].y * S - hisCY;
      const dz = (struct.atoms[bbLen + ri].z || 0) * S - hisCZ;
      hisR = Math.max(hisR, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    hisR += 0.25;
    const hisFFMesh = new THREE.Mesh(ffGeometry, hisFFMat);
    hisFFMesh.position.set(hisCX, hisCY, hisCZ);
    hisFFMesh.scale.setScalar(hisR);
    group.add(hisFFMesh);
    forcefields.push({ mat: hisFFMat, type: 'his' });
    refs.hisFFMesh = hisFFMesh;
  }

  // Store refs keyed by a unique key (support multiple of same letter)
  const refKey = opts.refKey || letter;
  structureRefs[refKey] = refs;

  group.position.set(baseX, baseY, baseZ);
  return group;
}

function addBondReturning(group, ax, ay, az, bx, by, bz, isSecondary) {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  if (len < 0.001) return null;

  const mat = new THREE.MeshStandardMaterial({
    color: isSecondary ? 0x888888 : 0x777777,
    roughness: 0.5,
    metalness: 0.1,
  });

  const mesh = new THREE.Mesh(bondGeo, mat);
  mesh.scale.y = len;
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);

  const axis = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(axis, dir.normalize());
  mesh.quaternion.copy(quat);

  group.add(mesh);
  return mesh;
}

function updateBondMesh(mesh, ax, ay, az, bx, by, bz) {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  if (len < 0.001) return;

  mesh.scale.y = len;
  mesh.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
  const axis = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(axis, dir.normalize());
  mesh.quaternion.copy(quat);
}

// ============================================================
// Rebuild structure visuals from new atom positions (rotamer)
// ============================================================
function rebuildStructureGroup(refKey, newAtoms) {
  const refs = structureRefs[refKey];
  if (!refs) return;
  const mx = refs.mirror;
  const bbLen = BB_ATOMS.length;

  for (let i = 0; i < refs.atomMeshes.length; i++) {
    const atom = newAtoms[i];
    refs.atomMeshes[i].position.set(atom.x * S * mx, atom.y * S, (atom.z || 0) * S);
  }

  for (const bd of refs.bondData) {
    const atomA = newAtoms[bd.fromIdx];
    const atomB = newAtoms[bd.toIdx];
    let ax = atomA.x * S * mx, ay = atomA.y * S, az = (atomA.z || 0) * S;
    let bx = atomB.x * S * mx, by = atomB.y * S, bz = (atomB.z || 0) * S;

    if (bd.isSecondary) {
      const bondDir = new THREE.Vector3(bx - ax, by - ay, bz - az);
      const up = new THREE.Vector3(0, 1, 0);
      const perp = new THREE.Vector3().crossVectors(bondDir, up);
      if (perp.lengthSq() < 0.0001) {
        perp.crossVectors(bondDir, new THREE.Vector3(1, 0, 0));
      }
      perp.normalize().multiplyScalar(0.06);
      ax += perp.x; ay += perp.y; az += perp.z;
      bx += perp.x; by += perp.y; bz += perp.z;
    }

    updateBondMesh(bd.mesh, ax, ay, az, bx, by, bz);
  }

  if (refs.chargeGroup && refs.chargeAtomIdx >= 0) {
    const ca = newAtoms[refs.chargeAtomIdx];
    const cx = ca.x * S * mx;
    const cy = ca.y * S + ARAD[ca.el] * S + 0.15;
    const caz = (ca.z || 0) * S;
    refs.chargeGroup.position.set(cx, cy, caz);
  }

  if (refs.ffMesh && refs.ffIndices) {
    let sumX = 0, sumY = 0, sumZ = 0;
    for (const idx of refs.ffIndices) {
      sumX += newAtoms[idx].x * S * mx;
      sumY += newAtoms[idx].y * S;
      sumZ += (newAtoms[idx].z || 0) * S;
    }
    const n = refs.ffIndices.length;
    const ffCX = sumX / n, ffCY = sumY / n, ffCZ = sumZ / n;
    let ffR = 0;
    for (const idx of refs.ffIndices) {
      const dx = newAtoms[idx].x * S * mx - ffCX;
      const dy = newAtoms[idx].y * S - ffCY;
      const dz = (newAtoms[idx].z || 0) * S - ffCZ;
      ffR = Math.max(ffR, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    ffR += 0.25;
    refs.ffMesh.position.set(ffCX, ffCY, ffCZ);
    refs.ffMesh.scale.setScalar(ffR);
  }

  // Histidine special
  if (refs.glowMeshes) {
    for (const g of refs.glowMeshes) {
      const atom = newAtoms[bbLen + g.scIdx];
      g.mesh.position.set(atom.x * S * mx, atom.y * S, (atom.z || 0) * S);
    }
  }
  if (refs.plusGroup && refs.plusScIdx !== undefined) {
    const ringAtom = newAtoms[bbLen + refs.plusScIdx];
    refs.plusGroup.position.set(
      ringAtom.x * S * mx,
      ringAtom.y * S + 0.2,
      (ringAtom.z || 0) * S
    );
  }
  if (refs.hisFFMesh) {
    let hSumX = 0, hSumY = 0, hSumZ = 0;
    for (let ri = 1; ri <= 5; ri++) {
      hSumX += newAtoms[bbLen + ri].x * S * mx;
      hSumY += newAtoms[bbLen + ri].y * S;
      hSumZ += (newAtoms[bbLen + ri].z || 0) * S;
    }
    const hisCX = hSumX / 5, hisCY = hSumY / 5, hisCZ = hSumZ / 5;
    let hisR = 0;
    for (let ri = 1; ri <= 5; ri++) {
      const dx = newAtoms[bbLen + ri].x * S * mx - hisCX;
      const dy = newAtoms[bbLen + ri].y * S - hisCY;
      const dz = (newAtoms[bbLen + ri].z || 0) * S - hisCZ;
      hisR = Math.max(hisR, Math.sqrt(dx * dx + dy * dy + dz * dz));
    }
    hisR += 0.25;
    refs.hisFFMesh.position.set(hisCX, hisCY, hisCZ);
    refs.hisFFMesh.scale.setScalar(hisR);
  }
}

// ============================================================
// Public: set rotamer with smooth lerp
// refKey identifies which placed structure to update (e.g. "chain_0")
// ============================================================
export function setRotamer(letter, rotamerIdx, refKey) {
  const key = refKey || letter;
  const toAtoms = computeRotamerPositions(letter, rotamerIdx);
  const fromAtoms = currentAtoms[key]
    ? currentAtoms[key].map(a => ({ ...a }))
    : FULL[letter].atoms.map(a => ({ ...a }));

  activeTransitions[key] = {
    fromAtoms,
    toAtoms,
    startTime: Date.now(),
    duration: TRANSITION_DURATION,
  };
}

// ============================================================
// Remove a structure ref (for undo)
// ============================================================
export function removeStructureRef(refKey) {
  delete structureRefs[refKey];
  delete activeTransitions[refKey];
  delete currentAtoms[refKey];
}

// ============================================================
// Per-frame animation
// ============================================================
export function updateStructures3D() {
  const now = Date.now();

  // Tick rotamer transitions
  for (const key of Object.keys(activeTransitions)) {
    const tr = activeTransitions[key];
    const elapsed = now - tr.startTime;
    const rawT = Math.min(elapsed / tr.duration, 1);
    const t = rawT < 0.5
      ? 2 * rawT * rawT
      : 1 - 2 * (1 - rawT) * (1 - rawT);

    const lerped = tr.fromAtoms.map((from, i) => {
      const to = tr.toAtoms[i];
      return {
        el: from.el, name: from.name,
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        z: (from.z || 0) + ((to.z || 0) - (from.z || 0)) * t,
      };
    });

    currentAtoms[key] = lerped;
    rebuildStructureGroup(key, lerped);

    if (rawT >= 1) {
      currentAtoms[key] = tr.toAtoms;
      rebuildStructureGroup(key, tr.toAtoms);
      delete activeTransitions[key];
    }
  }

  // Pulse charge indicators
  const pulse = 0.3 + Math.sin(now / 300) * 0.4;
  for (const mat of chargeIndicators) {
    mat.emissiveIntensity = Math.max(0, pulse);
  }

  // Histidine pH flash
  const t = (Math.sin(now / 2000) + 1) / 2;
  for (const mat of phFlashElements) {
    mat.emissiveIntensity = t * 0.6;
    mat.opacity = 0.2 + t * 0.4;
  }
  if (phFlashCharge) {
    if (t > 0.5) {
      phFlashCharge.emissiveIntensity = (t - 0.5) * 1.5;
      phFlashCharge.opacity = (t - 0.5) * 1.5;
    } else {
      phFlashCharge.emissiveIntensity = 0;
      phFlashCharge.opacity = 0;
    }
  }

  // Animate forcefields
  const ffTime = now / 1000;
  for (const ff of forcefields) {
    ff.mat.uniforms.uTime.value = ffTime;
    if (ff.type === 'his') {
      ff.mat.uniforms.uIntensity.value = t;
    }
  }
}
