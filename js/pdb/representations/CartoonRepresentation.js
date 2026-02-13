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

// ---- Tunable parameters (exported so the tuner panel can modify them) ----
export const CARTOON_PARAMS = {
  coilRadius:     0.25,
  helixWidth:     2.0,
  helixThickness: 0.35,
  sheetWidth:     1.95,
  sheetThickness: 0.40,
  arrowWidth:     3.8,
  arrowResidues:  1.6,
  subdivisions:   12,
  smoothIters:    5,
  helixSmoothW:   0.15,
  sheetSmoothW:   0.25,
  coilSmoothW:    0.10,
  sheetExponent:  11,
  flatCycles:     4,
  tipRefineIters: 10,
};

// ---- Fixed constants ----
const PROFILE_N       = 16;
const RING_VERTS      = PROFILE_N + 1;

const SS_COIL  = 0;
const SS_HELIX = 1;
const SS_SHEET = 2;

// ---- Profile generators (return { points, normals } with PROFILE_N entries) ----

function circleProfile(radius) {
  const points = [], normals = [];
  for (let i = 0; i < PROFILE_N; i++) {
    const a = (i / PROFILE_N) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    points.push([ca * radius, sa * radius]);
    normals.push([ca, sa]);
  }
  return { points, normals };
}

function ellipseProfile(halfW, halfH) {
  const points = [], normals = [];
  for (let i = 0; i < PROFILE_N; i++) {
    const a = (i / PROFILE_N) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    points.push([ca * halfW, sa * halfH]);
    const nx = ca / halfW, ny = sa / halfH;
    const len = Math.sqrt(nx * nx + ny * ny) || 1;
    normals.push([nx / len, ny / len]);
  }
  return { points, normals };
}

function superEllipseProfile(halfW, halfH, exp) {
  const points = [], normals = [];
  for (let i = 0; i < PROFILE_N; i++) {
    const a = (i / PROFILE_N) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    const absCa = Math.abs(ca), absSa = Math.abs(sa);
    const r = 1.0 / Math.pow(
      Math.pow(absCa, exp) + Math.pow(absSa, exp),
      1.0 / exp
    );
    points.push([ca * r * halfW, sa * r * halfH]);
  }
  // Compute normals from finite differences
  for (let i = 0; i < PROFILE_N; i++) {
    const prev = points[(i - 1 + PROFILE_N) % PROFILE_N];
    const next = points[(i + 1) % PROFILE_N];
    const dx = next[0] - prev[0];
    const dy = next[1] - prev[1];
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    normals.push([dy / len, -dx / len]);
  }
  return { points, normals };
}

function lerpProfile(profA, profB, t) {
  const s = 1 - t;
  const points = [], normals = [];
  for (let i = 0; i < PROFILE_N; i++) {
    points.push([
      profA.points[i][0] * s + profB.points[i][0] * t,
      profA.points[i][1] * s + profB.points[i][1] * t,
    ]);
    const nx = profA.normals[i][0] * s + profB.normals[i][0] * t;
    const ny = profA.normals[i][1] * s + profB.normals[i][1] * t;
    const len = Math.sqrt(nx * nx + ny * ny) || 1;
    normals.push([nx / len, ny / len]);
  }
  return { points, normals };
}

// ---- Representation ----

export class CartoonRepresentation extends BaseRepresentation {
  build() {
    const { model, materials, viewerGroup } = this;
    const { residues, chains, positions } = model;

    // Snapshot tunable params and pre-build profiles
    const P = this._p = { ...CARTOON_PARAMS };
    this._coilProf  = circleProfile(P.coilRadius);
    // Helix: wide axis = Y (normal direction = radially outward from helix axis)
    //        thin axis = X (binormal direction = along helix axis)
    this._helixProf = ellipseProfile(P.helixThickness / 2, P.helixWidth / 2);
    this._sheetProf = superEllipseProfile(P.sheetWidth / 2, P.sheetThickness / 2, P.sheetExponent);

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

      // Smooth control points, idealize helices, flatten sheets, refine arrows
      const smoothedPositions = this._smoothPositions(caPositions, ssPerCA);
      this._idealizeHelices(smoothedPositions, ssPerCA);
      this._flattenSheets(smoothedPositions, ssPerCA);
      this._refineArrowTips(smoothedPositions, ssPerCA);

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

    // Helices are handled by _idealizeHelices() — no smoothing pass here.

    // --- Sheet — Laplacian smoothing (controlled by smoothIters) ---
    const sw = this._p.sheetSmoothW;
    if (sw > 0) {
      for (let iter = 0; iter < this._p.smoothIters; iter++) {
        const prev = out.map(p => p.clone());
        for (let i = 0; i < n; i++) {
          if (ssPerCA[i] !== SS_SHEET) continue;
          let sx = 0, sy = 0, sz = 0, count = 0;
          for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
            if (ssPerCA[j] === SS_SHEET) {
              sx += prev[j].x; sy += prev[j].y; sz += prev[j].z;
              count++;
            }
          }
          if (count <= 1) continue;
          out[i].x += (sx / count - prev[i].x) * sw;
          out[i].y += (sy / count - prev[i].y) * sw;
          out[i].z += (sz / count - prev[i].z) * sw;
        }
      }
    }

    // --- Pass 3: Coil — Laplacian smoothing (independent, 5 iters) ---
    const cw = this._p.coilSmoothW;
    if (cw > 0) {
      for (let iter = 0; iter < 5; iter++) {
        const prev = out.map(p => p.clone());
        for (let i = 0; i < n; i++) {
          if (ssPerCA[i] !== SS_COIL) continue;
          let sx = 0, sy = 0, sz = 0, count = 0;
          for (let j = Math.max(0, i - 1); j <= Math.min(n - 1, i + 1); j++) {
            sx += prev[j].x; sy += prev[j].y; sz += prev[j].z;
            count++;
          }
          if (count <= 1) continue;
          out[i].x += (sx / count - prev[i].x) * cw;
          out[i].y += (sy / count - prev[i].y) * cw;
          out[i].z += (sz / count - prev[i].z) * cw;
        }
      }
    }

    return out;
  }

  // ----------------------------------------------------------------
  // Idealize helix geometry — fit each helix run to a perfect helix
  // (constant radius, constant pitch, constant angular velocity).
  // This eliminates the polygonal appearance from having only ~3.6
  // CA positions per turn and regularizes the pitch.
  // ----------------------------------------------------------------
  _idealizeHelices(positions, ssPerCA) {
    const n = positions.length;
    this._helixRuns = [];
    let i = 0;
    while (i < n) {
      if (ssPerCA[i] !== SS_HELIX) { i++; continue; }
      let j = i;
      while (j < n && ssPerCA[j] === SS_HELIX) j++;
      if (j - i >= 4) {
        this._idealizeHelixRun(positions, i, j);
      }
      i = j;
    }
  }

  _idealizeHelixRun(positions, start, end) {
    const count = end - start;

    // 1. Centroid
    const centroid = new THREE.Vector3();
    for (let i = start; i < end; i++) centroid.add(positions[i]);
    centroid.divideScalar(count);

    // 2. Covariance matrix for PCA
    const cov = [[0,0,0],[0,0,0],[0,0,0]];
    for (let i = start; i < end; i++) {
      const d = [
        positions[i].x - centroid.x,
        positions[i].y - centroid.y,
        positions[i].z - centroid.z,
      ];
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++)
          cov[a][b] += d[a] * d[b];
    }

    // 3. Power iteration for largest eigenvector → helix axis
    let axis = new THREE.Vector3(1, 1, 1).normalize();
    for (let iter = 0; iter < 30; iter++) {
      const nx = cov[0][0]*axis.x + cov[0][1]*axis.y + cov[0][2]*axis.z;
      const ny = cov[1][0]*axis.x + cov[1][1]*axis.y + cov[1][2]*axis.z;
      const nz = cov[2][0]*axis.x + cov[2][1]*axis.y + cov[2][2]*axis.z;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      if (len < 1e-10) break;
      axis.set(nx/len, ny/len, nz/len);
    }

    // Consistent direction: axis points from start toward end
    if (positions[end-1].clone().sub(positions[start]).dot(axis) < 0) {
      axis.negate();
    }

    // 4. Project CAs onto axis (height) and perpendicular (radial)
    const heights = [], radials = [];
    for (let i = start; i < end; i++) {
      const d = positions[i].clone().sub(centroid);
      const h = d.dot(axis);
      heights.push(h);
      radials.push(d.clone().addScaledVector(axis, -h));
    }

    // 5. Average radius
    let avgRadius = 0;
    for (const r of radials) avgRadius += r.length();
    avgRadius /= count;

    // 6. Build perpendicular frame (u, v)
    const u = new THREE.Vector3();
    const v = new THREE.Vector3();
    const tmp = Math.abs(axis.y) < 0.9
      ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    u.crossVectors(axis, tmp).normalize();
    v.crossVectors(axis, u).normalize();

    // 7. Compute and unwrap angular positions
    const angles = [];
    for (const r of radials) {
      angles.push(Math.atan2(r.dot(v), r.dot(u)));
    }
    for (let i = 1; i < count; i++) {
      while (angles[i] - angles[i-1] >  Math.PI) angles[i] -= 2 * Math.PI;
      while (angles[i] - angles[i-1] < -Math.PI) angles[i] += 2 * Math.PI;
    }

    // 8. Linear regression: angle = a0 + a1*t, height = h0 + h1*t
    const tMean = (count - 1) / 2;
    let angleMean = 0, heightMean = 0;
    for (let i = 0; i < count; i++) { angleMean += angles[i]; heightMean += heights[i]; }
    angleMean /= count;
    heightMean /= count;

    let tVar = 0, taCovar = 0, thCovar = 0;
    for (let i = 0; i < count; i++) {
      const dt = i - tMean;
      tVar += dt * dt;
      taCovar += dt * (angles[i] - angleMean);
      thCovar += dt * (heights[i] - heightMean);
    }

    const a1 = taCovar / tVar;   // angular velocity (rad/residue)
    const a0 = angleMean - a1 * tMean;
    const h1 = thCovar / tVar;   // rise per residue
    const h0 = heightMean - h1 * tMean;

    // 9. Replace positions with ideal helix coordinates
    for (let i = 0; i < count; i++) {
      const angle  = a0 + a1 * i;
      const height = h0 + h1 * i;
      positions[start + i].copy(centroid)
        .addScaledVector(axis, height)
        .addScaledVector(u, Math.cos(angle) * avgRadius)
        .addScaledVector(v, Math.sin(angle) * avgRadius);
    }

    // 10. Store run parameters for analytic sampling in _buildChainGeometry
    this._helixRuns.push({
      start, end,
      centroid: centroid.clone(),
      axis: axis.clone(),
      u: u.clone(), v: v.clone(),
      a0, a1, h0, h1, avgRadius,
    });
  }

  // ----------------------------------------------------------------
  // Flatten sheet residues onto their average plane.
  // 4 iterative cycles — removes the backbone zigzag oscillation
  // perpendicular to the sheet plane for clean, flat strands.
  // ----------------------------------------------------------------
  _flattenSheets(positions, ssPerCA) {
    const n = positions.length;
    const tmpV1 = new THREE.Vector3();
    const tmpV2 = new THREE.Vector3();

    for (let cycle = 0; cycle < this._p.flatCycles; cycle++) {
      let i = 0;
      while (i < n) {
        if (ssPerCA[i] !== SS_SHEET) { i++; continue; }
        let j = i;
        while (j < n && ssPerCA[j] === SS_SHEET) j++;
        if (j - i >= 3) {
          // Compute average plane normal from consecutive CA–CA cross products
          const planeNormal = new THREE.Vector3();
          let crossCount = 0;
          for (let k = i + 1; k < j - 1; k++) {
            tmpV1.subVectors(positions[k], positions[k - 1]);
            tmpV2.subVectors(positions[k + 1], positions[k]);
            const cross = new THREE.Vector3().crossVectors(tmpV1, tmpV2);
            if (cross.lengthSq() > 1e-10) {
              if (crossCount > 0 && cross.dot(planeNormal) < 0) cross.negate();
              planeNormal.add(cross);
              crossCount++;
            }
          }
          if (crossCount > 0) {
            planeNormal.normalize();
            // Compute centroid
            const centroid = new THREE.Vector3();
            for (let k = i; k < j; k++) centroid.add(positions[k]);
            centroid.divideScalar(j - i);
            // Project each position onto the plane
            for (let k = i; k < j; k++) {
              tmpV1.subVectors(positions[k], centroid);
              const dist = tmpV1.dot(planeNormal);
              positions[k].sub(tmpV2.copy(planeNormal).multiplyScalar(dist));
            }
          }
        }
        i = j;
      }
    }
  }

  // ----------------------------------------------------------------
  // Straighten the C-terminal arrow tips of beta strands.
  // 10 iterations of progressive interpolation toward a straight
  // line through the last few residues of each strand.
  // ----------------------------------------------------------------
  _refineArrowTips(positions, ssPerCA) {
    const n = positions.length;
    const tmpTarget = new THREE.Vector3();

    for (let i = 0; i < n; i++) {
      if (ssPerCA[i] !== SS_SHEET || (i < n - 1 && ssPerCA[i + 1] === SS_SHEET)) continue;

      // i is the C-terminal end of a strand — find the strand start
      let strandStart = i;
      while (strandStart > 0 && ssPerCA[strandStart - 1] === SS_SHEET) strandStart--;

      const tipStart = Math.max(strandStart, i - 3);
      if (i - tipStart < 2) continue;

      const anchor = positions[tipStart].clone();
      const tip = positions[i].clone();

      for (let iter = 0; iter < this._p.tipRefineIters; iter++) {
        for (let j = tipStart + 1; j < i; j++) {
          const t = (j - tipStart) / (i - tipStart);
          tmpTarget.lerpVectors(anchor, tip, t);
          positions[j].lerp(tmpTarget, 0.3);
        }
      }
    }
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
    const SUBDIVISIONS = this._p.subdivisions;
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

      // Check if this sample falls inside an idealized helix run
      let helixRun = null;
      if (this._helixRuns) {
        for (const run of this._helixRuns) {
          if (caFloat >= run.start && caFloat <= run.end - 1) {
            helixRun = run;
            break;
          }
        }
      }

      if (helixRun) {
        // --- Analytic helix: perfectly round path + smooth normal rotation ---
        const localT = caFloat - helixRun.start;
        const angle  = helixRun.a0 + helixRun.a1 * localT;
        const height = helixRun.h0 + helixRun.h1 * localT;
        const cosA = Math.cos(angle), sinA = Math.sin(angle);

        // Position on ideal helix
        pos.copy(helixRun.centroid)
          .addScaledVector(helixRun.axis, height)
          .addScaledVector(helixRun.u, cosA * helixRun.avgRadius)
          .addScaledVector(helixRun.v, sinA * helixRun.avgRadius);

        // Tangent: derivative of helix position w.r.t. localT
        tangent.copy(helixRun.axis).multiplyScalar(helixRun.h1)
          .addScaledVector(helixRun.u, -sinA * helixRun.a1 * helixRun.avgRadius)
          .addScaledVector(helixRun.v,  cosA * helixRun.a1 * helixRun.avgRadius)
          .normalize();

        // Radial direction (outward from helix axis)
        tmpV.copy(helixRun.u).multiplyScalar(cosA)
          .addScaledVector(helixRun.v, sinA);

        // Normal = cross(tangent, radial) — perpendicular to both,
        // so the wide ribbon face lies tangent to the helix cylinder
        // (visible when looking at the helix from outside)
        normal.crossVectors(tangent, tmpV).normalize();
        binormal.crossVectors(tangent, normal).normalize();
      } else {
        // --- Default: CatmullRom spline + guide normal spline ---
        curve.getPoint(t, pos);
        curve.getTangent(t, tangent).normalize();

        normalCurve.getPoint(t, normal);

        // Re-orthogonalize against tangent (Gram-Schmidt)
        normal.sub(tmpV.copy(tangent).multiplyScalar(normal.dot(tangent)));
        if (normal.lengthSq() < 1e-6) {
          const up = Math.abs(tangent.y) < 0.9 ? tmpV.set(0, 1, 0) : tmpV.set(1, 0, 0);
          normal.crossVectors(tangent, up);
        }
        normal.normalize();

        binormal.crossVectors(tangent, normal).normalize();
      }

      // Store ring center for per-residue visibility
      ringCenters[s * 3]     = pos.x;
      ringCenters[s * 3 + 1] = pos.y;
      ringCenters[s * 3 + 2] = pos.z;

      const prof = this._getProfileAtSample(caFloat, caCount, ssPerCA, strandEnds, strandEndSet);

      for (let p = 0; p <= PROFILE_N; p++) {
        const pi = p % PROFILE_N;
        const [px, py] = prof.points[pi];
        const [pnx, pny] = prof.normals[pi];

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
  _getBaseProfile(ssType) {
    if (ssType === SS_HELIX) return this._helixProf;
    if (ssType === SS_SHEET) return this._sheetProf;
    return this._coilProf;
  }

  _sheetProfileAtWidth(width) {
    return superEllipseProfile(width / 2, this._p.sheetThickness / 2, this._p.sheetExponent);
  }

  _getProfileAtSample(caFloat, caCount, ssPerCA, strandEnds, strandEndSet) {
    const caNearest = Math.min(Math.round(caFloat), caCount - 1);
    const P = this._p;

    // 1. Check arrowhead zones
    if (ssPerCA[caNearest] === SS_SHEET) {
      for (let e = 0; e < strandEnds.length; e++) {
        const endIdx = strandEnds[e];
        const arrowStart = endIdx - P.arrowResidues;
        if (caFloat >= arrowStart && caFloat <= endIdx) {
          const distToEnd = endIdx - caFloat;
          const width = P.arrowWidth * (distToEnd / P.arrowResidues);
          return width > 0.05 ? this._sheetProfileAtWidth(width) : circleProfile(0.05);
        }
      }
    }

    // 2. Transition blending at SS boundaries
    const caFloor = Math.max(0, Math.floor(caFloat));
    const caCeil = Math.min(caFloor + 1, caCount - 1);

    if (caFloor !== caCeil && ssPerCA[caFloor] !== ssPerCA[caCeil]) {
      const frac = caFloat - caFloor;
      const ssA = ssPerCA[caFloor];
      const ssB = ssPerCA[caCeil];

      // Coil↔helix or coil↔sheet: no gradual expansion — stay thin (coil) throughout
      if (ssA === SS_COIL || ssB === SS_COIL) {
        return this._coilProf;
      }

      // Helix↔sheet: blend between the two
      let profA = (ssA === SS_SHEET && strandEndSet.has(caFloor))
        ? circleProfile(0.05)
        : this._getBaseProfile(ssA);

      let profB = this._getBaseProfile(ssB);
      return lerpProfile(profA, profB, frac);
    }

    // 3. Base profile
    return this._getBaseProfile(ssPerCA[caNearest]);
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
