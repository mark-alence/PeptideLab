// ============================================================
// CartoonRepresentation.js — PyMOL-style cartoon representation
// Per-chain: distinct geometry for helices (wide flat ribbons),
// sheets (flat ribbon arrows), and coils (thin round tubes).
// Uses custom BufferGeometry with varying cross-section profiles
// extruded along a backbone CatmullRom spline.
//
// Key techniques:
//  1. Moderate position smoothing (5 iterations, ±1 window) to
//     remove the CA-atom zigzag while preserving enough displacement
//     for guide normal computation.
//  2. CatmullRom spline for normal interpolation — gives C1-continuous
//     rotation without the scalloped edges caused by linear lerp
//     between normals that differ by ~80° per residue.
//  3. Displacement-based guide normals for helix/sheet
//     (originalCA − smoothedCA) which naturally point radially
//     outward from the helical axis.
// ============================================================

import * as THREE from 'three';
import { BaseRepresentation } from './BaseRepresentation.js';

// ---- Constants ----
const COIL_RADIUS     = 0.25;
const HELIX_WIDTH     = 2.0;
const HELIX_THICKNESS = 0.4;
const SHEET_WIDTH     = 1.6;
const SHEET_THICKNESS = 0.25;
const ARROW_WIDTH     = 2.4;
const ARROW_RESIDUES  = 1.5;
const SUBDIVISIONS    = 8;
const PROFILE_N       = 16;
const RING_VERTS      = PROFILE_N + 1;
const SMOOTH_ITERS    = 5;   // moderate — preserves spiral + displacement

const SS_COIL  = 0;
const SS_HELIX = 1;
const SS_SHEET = 2;

// ---- Profile generators (return PROFILE_N [x,y] pairs) ----

function circleProfile(radius) {
  const pts = [];
  for (let i = 0; i < PROFILE_N; i++) {
    const a = (i / PROFILE_N) * Math.PI * 2;
    pts.push([Math.cos(a) * radius, Math.sin(a) * radius]);
  }
  return pts;
}

function ellipseProfile(halfW, halfH) {
  const pts = [];
  for (let i = 0; i < PROFILE_N; i++) {
    const a = (i / PROFILE_N) * Math.PI * 2;
    pts.push([Math.cos(a) * halfW, Math.sin(a) * halfH]);
  }
  return pts;
}

function superEllipseProfile(halfW, halfH, n) {
  const pts = [];
  for (let i = 0; i < PROFILE_N; i++) {
    const a = (i / PROFILE_N) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const absCa = Math.abs(ca);
    const absSa = Math.abs(sa);
    const r = 1.0 / Math.pow(
      Math.pow(absCa, n) + Math.pow(absSa, n),
      1.0 / n
    );
    pts.push([ca * r * halfW, sa * r * halfH]);
  }
  return pts;
}

const COIL_PROFILE  = circleProfile(COIL_RADIUS);
const HELIX_PROFILE = ellipseProfile(HELIX_WIDTH / 2, HELIX_THICKNESS / 2);
const SHEET_PROFILE = superEllipseProfile(SHEET_WIDTH / 2, SHEET_THICKNESS / 2, 4);

function getBaseProfile(ssType) {
  if (ssType === SS_HELIX) return HELIX_PROFILE;
  if (ssType === SS_SHEET) return SHEET_PROFILE;
  return COIL_PROFILE;
}

function lerpProfile(profA, profB, t) {
  const s = 1 - t;
  const out = [];
  for (let i = 0; i < PROFILE_N; i++) {
    out.push([
      profA[i][0] * s + profB[i][0] * t,
      profA[i][1] * s + profB[i][1] * t,
    ]);
  }
  return out;
}

function sheetProfileAtWidth(width) {
  return superEllipseProfile(width / 2, SHEET_THICKNESS / 2, 4);
}

function computeProfileNormals(profile) {
  const norms = [];
  for (let i = 0; i < PROFILE_N; i++) {
    const prev = profile[(i - 1 + PROFILE_N) % PROFILE_N];
    const next = profile[(i + 1) % PROFILE_N];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    norms.push([dy / len, -dx / len]);
  }
  return norms;
}

// ---- Representation ----

export class CartoonRepresentation extends BaseRepresentation {
  build() {
    const { model, materials, viewerGroup } = this;
    const { residues, chains, positions } = model;

    this._chainMeshes = [];

    for (let ci = 0; ci < chains.length; ci++) {
      const chain = chains[ci];
      const caIndices = [];
      const caPositions = [];
      const ssPerCA = [];
      const cAtomPos = [];
      const nAtomPos = [];

      for (let ri = chain.residueStart; ri < chain.residueEnd; ri++) {
        const res = residues[ri];
        if (res.caIndex < 0) continue;

        const caIdx = res.caIndex;
        caIndices.push(caIdx);
        caPositions.push(new THREE.Vector3(
          positions[caIdx * 3], positions[caIdx * 3 + 1], positions[caIdx * 3 + 2]
        ));
        ssPerCA.push(res.ss);

        cAtomPos.push(res.cIndex >= 0 ? new THREE.Vector3(
          positions[res.cIndex * 3], positions[res.cIndex * 3 + 1], positions[res.cIndex * 3 + 2]
        ) : null);

        nAtomPos.push(res.nIndex >= 0 ? new THREE.Vector3(
          positions[res.nIndex * 3], positions[res.nIndex * 3 + 1], positions[res.nIndex * 3 + 2]
        ) : null);
      }

      if (caPositions.length < 2) continue;

      // Smooth helix/sheet control points to remove CA zigzag
      const smoothedPositions = this._smoothPositions(caPositions, ssPerCA);

      const result = this._buildChainGeometry(
        smoothedPositions, caPositions, ssPerCA, caIndices,
        cAtomPos, nAtomPos, chain, ci, materials
      );
      if (!result) continue;

      viewerGroup.add(result.mesh);
      this.meshes.push(result.mesh);
      this._chainMeshes.push(result);
    }

    this.atomMesh = null;
    this.bondMesh = null;
    this.baseScales = null;
    this.baseBondScales = null;
  }

  // ----------------------------------------------------------------
  // Iteratively smooth helix/sheet control points to remove the
  // CA-atom zigzag. Coil positions are left untouched.
  // Only averages within same-SS runs (won't leak across boundaries).
  //
  // Moderate settings: 5 iterations, ±1 window.
  // This reduces the ~2.3 Å zigzag by ~85% while preserving ~0.3–0.5 Å
  // of displacement for the guide normal computation.
  // ----------------------------------------------------------------
  _smoothPositions(caPositions, ssPerCA) {
    const n = caPositions.length;
    const out = caPositions.map(p => p.clone());

    for (let iter = 0; iter < SMOOTH_ITERS; iter++) {
      const prev = out.map(p => p.clone());
      for (let i = 0; i < n; i++) {
        const ss = ssPerCA[i];
        if (ss === SS_COIL) continue;

        const w = ss === SS_HELIX ? 0.4 : 0.25;

        let sx = 0, sy = 0, sz = 0, count = 0;
        for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
          if (ssPerCA[j] === ss) {
            sx += prev[j].x;
            sy += prev[j].y;
            sz += prev[j].z;
            count++;
          }
        }
        if (count <= 1) continue;

        out[i].x += (sx / count - prev[i].x) * w;
        out[i].y += (sy / count - prev[i].y) * w;
        out[i].z += (sz / count - prev[i].z) * w;
      }
    }

    return out;
  }

  // ----------------------------------------------------------------
  // Build a single chain's cartoon geometry
  // ----------------------------------------------------------------
  _buildChainGeometry(smoothedPos, originalPos, ssPerCA, caIndices,
                      cAtomPos, nAtomPos, chain, ci, materials) {
    const caCount = smoothedPos.length;

    // 1. Backbone spline through smoothed control points
    const curve = new THREE.CatmullRomCurve3(smoothedPos, false, 'catmullrom', 0.5);

    // 2. Guide normals from displacement (original - smoothed) for helix/sheet,
    //    peptide-plane cross product for coils.
    const guideNormals = this._computeGuideNormals(
      originalPos, smoothedPos, cAtomPos, nAtomPos, ssPerCA
    );

    // 3. CatmullRom spline through guide normals for C1-continuous interpolation.
    //    This eliminates the scalloped edges caused by linear lerp between
    //    normals that differ by ~80° per residue in helices.
    //    We treat normals as "positions" for the spline — after sampling we
    //    re-orthogonalize against the tangent and renormalize.
    const normalCurve = new THREE.CatmullRomCurve3(
      guideNormals.map(n => n.clone()),
      false, 'catmullrom', 0.5
    );

    // 4. Detect sheet strand C-terminal ends for arrowheads
    const strandEndSet = new Set();
    for (let i = 0; i < caCount; i++) {
      if (ssPerCA[i] === SS_SHEET && (i === caCount - 1 || ssPerCA[i + 1] !== SS_SHEET)) {
        strandEndSet.add(i);
      }
    }
    const strandEnds = [...strandEndSet];

    // 5. Sample spline
    const totalSamples = (caCount - 1) * SUBDIVISIONS + 1;

    const vertCount = totalSamples * RING_VERTS + 2; // +2 end-cap centers
    const posArr = new Float32Array(vertCount * 3);
    const normArr = new Float32Array(vertCount * 3);
    const vertexToCA = new Uint32Array(vertCount);
    const ringCenters = new Float32Array(totalSamples * 3);

    const tangent  = new THREE.Vector3();
    const normal   = new THREE.Vector3();
    const binormal = new THREE.Vector3();
    const pos      = new THREE.Vector3();
    const tmpV     = new THREE.Vector3();

    let vi = 0;

    for (let s = 0; s < totalSamples; s++) {
      const t = s / (totalSamples - 1);
      const caFloat = t * (caCount - 1);
      const caNearest = Math.min(Math.round(caFloat), caCount - 1);

      curve.getPoint(t, pos);

      // Store ring center (spline point) for per-residue visibility
      ringCenters[s * 3]     = pos.x;
      ringCenters[s * 3 + 1] = pos.y;
      ringCenters[s * 3 + 2] = pos.z;
      curve.getTangent(t, tangent).normalize();

      // Sample guide normal from the normal CatmullRom spline
      normalCurve.getPoint(t, normal);

      // Re-orthogonalize against tangent (Gram-Schmidt)
      normal.sub(tmpV.copy(tangent).multiplyScalar(normal.dot(tangent)));
      if (normal.lengthSq() < 1e-6) {
        const up = Math.abs(tangent.y) < 0.9 ? tmpV.set(0, 1, 0) : tmpV.set(1, 0, 0);
        normal.crossVectors(tangent, up);
      }
      normal.normalize();

      binormal.crossVectors(tangent, normal).normalize();

      const profile = this._getProfileAtSample(caFloat, caCount, ssPerCA, strandEnds, strandEndSet);
      const profNorms = computeProfileNormals(profile);

      for (let p = 0; p <= PROFILE_N; p++) {
        const pi = p % PROFILE_N;
        const [px, py] = profile[pi];
        const [pnx, pny] = profNorms[pi];

        posArr[vi * 3]     = pos.x + px * binormal.x + py * normal.x;
        posArr[vi * 3 + 1] = pos.y + px * binormal.y + py * normal.y;
        posArr[vi * 3 + 2] = pos.z + px * binormal.z + py * normal.z;

        const nx = pnx * binormal.x + pny * normal.x;
        const ny = pnx * binormal.y + pny * normal.y;
        const nz = pnx * binormal.z + pny * normal.z;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
        normArr[vi * 3]     = nx / len;
        normArr[vi * 3 + 1] = ny / len;
        normArr[vi * 3 + 2] = nz / len;

        vertexToCA[vi] = caNearest;
        vi++;
      }
    }

    // End-cap center vertices
    const startCapIdx = vi;
    curve.getPoint(0, pos);
    curve.getTangent(0, tangent).normalize();
    posArr[vi * 3] = pos.x; posArr[vi * 3 + 1] = pos.y; posArr[vi * 3 + 2] = pos.z;
    normArr[vi * 3] = -tangent.x; normArr[vi * 3 + 1] = -tangent.y; normArr[vi * 3 + 2] = -tangent.z;
    vertexToCA[vi] = 0;
    vi++;

    const endCapIdx = vi;
    curve.getPoint(1, pos);
    curve.getTangent(1, tangent).normalize();
    posArr[vi * 3] = pos.x; posArr[vi * 3 + 1] = pos.y; posArr[vi * 3 + 2] = pos.z;
    normArr[vi * 3] = tangent.x; normArr[vi * 3 + 1] = tangent.y; normArr[vi * 3 + 2] = tangent.z;
    vertexToCA[vi] = caCount - 1;
    vi++;

    // 6. Index buffer
    const tubeTriangles = (totalSamples - 1) * PROFILE_N * 2;
    const capTriangles = PROFILE_N * 2;
    const indices = new Uint32Array((tubeTriangles + capTriangles) * 3);
    let fi = 0;

    for (let s = 0; s < totalSamples - 1; s++) {
      const ringA = s * RING_VERTS;
      const ringB = (s + 1) * RING_VERTS;
      for (let p = 0; p < PROFILE_N; p++) {
        const a0 = ringA + p;
        const a1 = ringA + p + 1;
        const b0 = ringB + p;
        const b1 = ringB + p + 1;
        indices[fi++] = a0; indices[fi++] = b0; indices[fi++] = a1;
        indices[fi++] = a1; indices[fi++] = b0; indices[fi++] = b1;
      }
    }

    for (let p = 0; p < PROFILE_N; p++) {
      indices[fi++] = startCapIdx;
      indices[fi++] = (p + 1) % PROFILE_N;
      indices[fi++] = p;
    }

    const lastRing = (totalSamples - 1) * RING_VERTS;
    for (let p = 0; p < PROFILE_N; p++) {
      indices[fi++] = endCapIdx;
      indices[fi++] = lastRing + p;
      indices[fi++] = lastRing + (p + 1) % PROFILE_N;
    }

    // 7. Assemble geometry
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normArr, 3));
    geometry.setIndex(new THREE.BufferAttribute(indices, 1));

    const colors = new Float32Array(vertCount * 3).fill(1);
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.4,
      metalness: 0.05,
      envMap: materials.atom.envMap || null,
      envMapIntensity: 0.5,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `cartoon-chain-${chain.id}`;
    mesh.frustumCulled = false;

    // Store base positions and ring centers for per-residue visibility
    const basePositions = new Float32Array(posArr);

    return { mesh, material, chainIdx: ci, caIndices, ssPerCA, vertexToCA,
             basePositions, ringCenters, totalSamples };
  }

  // ----------------------------------------------------------------
  // Compute per-residue guide normals.
  //
  // For helix/sheet: uses the displacement (originalCA - smoothedCA)
  // which naturally points radially outward from the helical axis
  // or perpendicular to the sheet plane.
  //
  // For coils: uses peptide-plane cross product (CA→C × CA→N).
  //
  // Only 1 iteration of Laplacian smoothing — the CatmullRom normal
  // spline handles smooth interpolation, so we just need to reduce
  // noise at SS boundaries without destroying the ~80°/residue
  // rotation in helices.
  // ----------------------------------------------------------------
  _computeGuideNormals(originalPos, smoothedPos, cAtomPos, nAtomPos, ssPerCA) {
    const n = originalPos.length;
    const normals = [];
    const tmpV1 = new THREE.Vector3();
    const tmpV2 = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      let norm = null;
      const ss = ssPerCA[i];

      // For helix/sheet: displacement from smoothed axis to original CA
      if (ss !== SS_COIL) {
        tmpV1.subVectors(originalPos[i], smoothedPos[i]);
        if (tmpV1.lengthSq() > 0.01) {
          norm = tmpV1.clone().normalize();
        }
      }

      // Fallback 1: peptide plane cross product
      if (!norm && cAtomPos[i] && nAtomPos[i]) {
        tmpV1.subVectors(cAtomPos[i], originalPos[i]);
        tmpV2.subVectors(nAtomPos[i], originalPos[i]);
        norm = new THREE.Vector3().crossVectors(tmpV1, tmpV2);
        if (norm.lengthSq() < 1e-8) norm = null;
        else norm.normalize();
      }

      // Fallback 2: cross of adjacent CA-CA vectors
      if (!norm) {
        const prev = Math.max(0, i - 1);
        const next = Math.min(n - 1, i + 1);
        if (prev !== next) {
          tmpV1.subVectors(originalPos[i], originalPos[prev]);
          tmpV2.subVectors(originalPos[next], originalPos[i]);
          norm = new THREE.Vector3().crossVectors(tmpV1, tmpV2);
          if (norm.lengthSq() < 1e-8) norm = null;
          else norm.normalize();
        }
      }

      // Fallback 3: arbitrary perpendicular
      if (!norm) {
        const tang = i < n - 1
          ? tmpV1.subVectors(originalPos[i + 1], originalPos[i])
          : tmpV1.subVectors(originalPos[i], originalPos[i - 1]);
        const up = Math.abs(tang.y) < 0.9 ? tmpV2.set(0, 1, 0) : tmpV2.set(1, 0, 0);
        norm = new THREE.Vector3().crossVectors(tang, up).normalize();
      }

      normals.push(norm);
    }

    // Sign-consistency pass: flip normals > 90° from previous
    for (let i = 1; i < n; i++) {
      if (normals[i].dot(normals[i - 1]) < 0) normals[i].negate();
    }

    // Single Laplacian smoothing pass — just enough to reduce noise
    // at SS boundaries. The CatmullRom normal spline handles the
    // smooth interpolation between samples.
    const smoothed = normals.map(v => v.clone());
    for (let i = 1; i < n - 1; i++) {
      smoothed[i]
        .add(normals[i - 1]).add(normals[i + 1])
        .multiplyScalar(1 / 3)
        .normalize();
    }
    for (let i = 0; i < n; i++) normals[i].copy(smoothed[i]);

    // Orthogonalize against smoothed backbone tangent
    for (let i = 0; i < n; i++) {
      const tang = i < n - 1
        ? tmpV1.subVectors(smoothedPos[i + 1], smoothedPos[i]).normalize()
        : tmpV1.subVectors(smoothedPos[i], smoothedPos[i - 1]).normalize();

      normals[i].sub(tmpV2.copy(tang).multiplyScalar(normals[i].dot(tang)));
      if (normals[i].lengthSq() < 1e-6) {
        const up = Math.abs(tang.y) < 0.9 ? tmpV2.set(0, 1, 0) : tmpV2.set(1, 0, 0);
        normals[i].crossVectors(tang, up);
      }
      normals[i].normalize();
    }

    return normals;
  }

  // ----------------------------------------------------------------
  // Get cross-section profile at a spline sample position
  // ----------------------------------------------------------------
  _getProfileAtSample(caFloat, caCount, ssPerCA, strandEnds, strandEndSet) {
    const caNearest = Math.min(Math.round(caFloat), caCount - 1);

    // 1. Check arrowhead zones
    if (ssPerCA[caNearest] === SS_SHEET) {
      for (let e = 0; e < strandEnds.length; e++) {
        const endIdx = strandEnds[e];
        const arrowStart = endIdx - ARROW_RESIDUES;
        if (caFloat >= arrowStart && caFloat <= endIdx) {
          const distToEnd = endIdx - caFloat;
          const width = ARROW_WIDTH * (distToEnd / ARROW_RESIDUES);
          return width > 0.05 ? sheetProfileAtWidth(width) : circleProfile(0.05);
        }
      }
    }

    // 2. Transition blending at SS boundaries
    const caFloor = Math.max(0, Math.floor(caFloat));
    const caCeil = Math.min(caFloor + 1, caCount - 1);

    if (caFloor !== caCeil && ssPerCA[caFloor] !== ssPerCA[caCeil]) {
      const frac = caFloat - caFloor;

      let profA = (ssPerCA[caFloor] === SS_SHEET && strandEndSet.has(caFloor))
        ? circleProfile(0.05)
        : getBaseProfile(ssPerCA[caFloor]);

      let profB = getBaseProfile(ssPerCA[caCeil]);
      return lerpProfile(profA, profB, frac);
    }

    // 3. Base profile
    return getBaseProfile(ssPerCA[caNearest]);
  }

  // ----------------------------------------------------------------
  // Color / visibility / dispose
  // ----------------------------------------------------------------

  applyColors(atomColors) {
    for (const cm of this._chainMeshes) {
      const colorAttr = cm.mesh.geometry.attributes.color;
      const vtca = cm.vertexToCA;
      const caIdx = cm.caIndices;

      for (let i = 0; i < vtca.length; i++) {
        const c = atomColors[caIdx[vtca[i]]];
        colorAttr.setXYZ(i, c.r, c.g, c.b);
      }
      colorAttr.needsUpdate = true;
    }
  }

  applyVisibility(atomVisible, scaleMultipliers = null) {
    for (const cm of this._chainMeshes) {
      const posAttr = cm.mesh.geometry.attributes.position;
      const posArray = posAttr.array;
      const basePosArr = cm.basePositions;
      const centers = cm.ringCenters;
      const vtca = cm.vertexToCA;
      const caIdx = cm.caIndices;
      const totalSamples = cm.totalSamples;

      let anyVisible = false;

      // Process ring vertices — collapse hidden residues to ring center
      for (let s = 0; s < totalSamples; s++) {
        const caLocal = vtca[s * RING_VERTS];
        const visible = atomVisible[caIdx[caLocal]];
        if (visible) anyVisible = true;

        const cx = centers[s * 3];
        const cy = centers[s * 3 + 1];
        const cz = centers[s * 3 + 2];

        for (let p = 0; p <= PROFILE_N; p++) {
          const vi = s * RING_VERTS + p;
          if (visible) {
            posArray[vi * 3]     = basePosArr[vi * 3];
            posArray[vi * 3 + 1] = basePosArr[vi * 3 + 1];
            posArray[vi * 3 + 2] = basePosArr[vi * 3 + 2];
          } else {
            posArray[vi * 3]     = cx;
            posArray[vi * 3 + 1] = cy;
            posArray[vi * 3 + 2] = cz;
          }
        }
      }

      // End-cap center vertices
      const startCapVi = totalSamples * RING_VERTS;
      const endCapVi = startCapVi + 1;

      if (atomVisible[caIdx[0]]) {
        posArray[startCapVi * 3]     = basePosArr[startCapVi * 3];
        posArray[startCapVi * 3 + 1] = basePosArr[startCapVi * 3 + 1];
        posArray[startCapVi * 3 + 2] = basePosArr[startCapVi * 3 + 2];
      } else {
        posArray[startCapVi * 3]     = centers[0];
        posArray[startCapVi * 3 + 1] = centers[1];
        posArray[startCapVi * 3 + 2] = centers[2];
      }

      const lastCA = caIdx.length - 1;
      if (atomVisible[caIdx[lastCA]]) {
        posArray[endCapVi * 3]     = basePosArr[endCapVi * 3];
        posArray[endCapVi * 3 + 1] = basePosArr[endCapVi * 3 + 1];
        posArray[endCapVi * 3 + 2] = basePosArr[endCapVi * 3 + 2];
      } else {
        const lastS = (totalSamples - 1) * 3;
        posArray[endCapVi * 3]     = centers[lastS];
        posArray[endCapVi * 3 + 1] = centers[lastS + 1];
        posArray[endCapVi * 3 + 2] = centers[lastS + 2];
      }

      posAttr.needsUpdate = true;
      cm.mesh.visible = anyVisible;
    }
  }

  dispose() {
    for (const cm of this._chainMeshes) {
      if (cm.material) cm.material.dispose();
    }
    this._chainMeshes = [];
    super.dispose();
  }
}
