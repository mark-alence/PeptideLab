// ============================================================
// water3d.js — Floating water molecules around placed amino acids
// Waters anchor to specific sidechain atoms based on real
// crystallographic hydration data (Cerny & Schneider 2015, WatAA atlas)
// Anchors update live so waters follow rotamer transitions.
// ============================================================

import * as THREE from 'three';
import { scene, SCALE } from './renderer3d.js';
import { FULL, STRUCT_SCALE, BB_ATOMS } from './structures.js';
import { currentAtoms } from './structures3d.js';
import { cellToWorld } from './grid3d.js';

const S = STRUCT_SCALE * SCALE;
const bbLen = BB_ATOMS.length;

// Water molecule geometry
const oGeo = new THREE.SphereGeometry(0.18, 8, 6);
const hGeo = new THREE.SphereGeometry(0.12, 6, 4);
const oMat = new THREE.MeshStandardMaterial({
  color: 0x4488ff, emissive: 0x2244aa, emissiveIntensity: 0.5,
  transparent: true, opacity: 0.8, roughness: 0.3,
});
const hMat = new THREE.MeshStandardMaterial({
  color: 0xccddff, emissive: 0x4466aa, emissiveIntensity: 0.4,
  transparent: true, opacity: 0.75, roughness: 0.3,
});

const H_OFFSET = 0.25;
const H_ANGLE = 52.25 * (Math.PI / 180);

function createWaterMolecule() {
  const group = new THREE.Group();
  group.add(new THREE.Mesh(oGeo, oMat.clone()));
  const h1 = new THREE.Mesh(hGeo, hMat.clone());
  h1.position.set(-Math.sin(H_ANGLE) * H_OFFSET, Math.cos(H_ANGLE) * H_OFFSET, 0);
  group.add(h1);
  const h2 = new THREE.Mesh(hGeo, hMat.clone());
  h2.position.set(Math.sin(H_ANGLE) * H_OFFSET, Math.cos(H_ANGLE) * H_OFFSET, 0);
  group.add(h2);
  group.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
  return group;
}

// ============================================================
// Per-AA hydration: which sidechain atoms attract water
// scIdx: index into sidechain atoms (offset from BB_ATOMS.length)
// waters: how many water molecules coordinate at this atom
// ============================================================
const HYDRATION = {
  R: { sites: [{ scIdx: 3, waters: 1 }, { scIdx: 5, waters: 2 }, { scIdx: 6, waters: 2 }] },
  K: { sites: [{ scIdx: 4, waters: 3 }] },
  H: { sites: [{ scIdx: 2, waters: 1 }, { scIdx: 5, waters: 1 }] },
  D: { sites: [{ scIdx: 2, waters: 3 }, { scIdx: 3, waters: 3 }] },
  E: { sites: [{ scIdx: 3, waters: 3 }, { scIdx: 4, waters: 3 }] },
  S: { sites: [{ scIdx: 1, waters: 2 }] },
  T: { sites: [{ scIdx: 1, waters: 2 }] },
  N: { sites: [{ scIdx: 2, waters: 2 }, { scIdx: 3, waters: 1 }] },
  Q: { sites: [{ scIdx: 3, waters: 2 }, { scIdx: 4, waters: 1 }] },
  Y: { sites: [{ scIdx: 7, waters: 2 }] },
  W: { sites: [{ scIdx: 4, waters: 1 }] },
  C: { sites: [{ scIdx: 1, waters: 1 }] },
  M: { sites: [{ scIdx: 2, waters: 1 }] },
  G: { sites: [] }, A: { sites: [] }, V: { sites: [] },
  L: { sites: [] }, I: { sites: [] }, P: { sites: [] }, F: { sites: [] },
};

// --- State ---
const waterSets = {};

// ============================================================
// Sync water molecules with current chain state
// ============================================================
export function syncWaters(chain) {
  const activeKeys = new Set();

  for (const entry of chain) {
    activeKeys.add(entry.refKey);
    if (waterSets[entry.refKey]) continue;

    const h = HYDRATION[entry.letter];
    if (!h || h.sites.length === 0) continue;

    const struct = FULL[entry.letter];
    if (!struct) continue;

    const pos = cellToWorld(entry.col, entry.row);
    const molecules = [];

    for (const site of h.sites) {
      const atomIdx = bbLen + site.scIdx;
      if (atomIdx >= struct.atoms.length) continue;

      for (let w = 0; w < site.waters; w++) {
        const mol = createWaterMolecule();
        const angle = (w / site.waters) * Math.PI * 2 + Math.random() * 0.8;
        const radius = 0.3 + Math.random() * 0.25;
        const speed = 0.3 + Math.random() * 0.5;
        const bobPhase = Math.random() * Math.PI * 2;

        scene.add(mol);

        molecules.push({
          group: mol,
          orbitAngle: angle,
          orbitRadius: radius,
          orbitSpeed: speed,
          bobPhase,
          atomIdx,  // flat index into atoms array — read live each frame
        });
      }
    }

    waterSets[entry.refKey] = {
      molecules,
      letter: entry.letter,
      refKey: entry.refKey,
      groupX: pos.x,
      groupZ: pos.z,
      structureGroup: entry.group, // reference to the Three.js group for rotation
    };
  }

  // Remove waters for entries no longer in chain
  for (const key of Object.keys(waterSets)) {
    if (!activeKeys.has(key)) {
      for (const m of waterSets[key].molecules) {
        scene.remove(m.group);
      }
      delete waterSets[key];
    }
  }
}

// ============================================================
// Reposition waters when an AA is moved
// ============================================================
export function repositionWaters(refKey, newCol, newRow) {
  const ws = waterSets[refKey];
  if (!ws) return;
  const pos = cellToWorld(newCol, newRow);
  ws.groupX = pos.x;
  ws.groupZ = pos.z;
}

// ============================================================
// Per-frame: read live atom positions so waters follow rotamers
// and apply the structure group's rotation (arrow key rotation)
// ============================================================
const _localVec = new THREE.Vector3();

export function updateWaters3D() {
  const now = performance.now() / 1000;

  for (const ws of Object.values(waterSets)) {
    const atoms = currentAtoms[ws.refKey] || FULL[ws.letter].atoms;
    const grp = ws.structureGroup;

    for (const m of ws.molecules) {
      m.orbitAngle += m.orbitSpeed * 0.016;

      const atom = atoms[m.atomIdx];
      // Local atom position (same space as meshes inside the group)
      _localVec.set(atom.x * S, atom.y * S, (atom.z || 0) * S);
      // Apply the group's rotation to the local offset
      _localVec.applyEuler(grp.rotation);

      // World anchor = group world position + rotated local offset
      const ax = grp.position.x + _localVec.x;
      const ay = grp.position.y + _localVec.y;
      const az = grp.position.z + _localVec.z;

      const x = ax + Math.cos(m.orbitAngle) * m.orbitRadius;
      const z = az + Math.sin(m.orbitAngle) * m.orbitRadius;
      const y = ay + Math.sin(now * 1.5 + m.bobPhase) * 0.12;

      m.group.position.set(x, y, z);
      m.group.rotation.y += 0.005;
      m.group.rotation.x += 0.003;
    }
  }
}
