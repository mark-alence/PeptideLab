// ============================================================
// kabsch.js — Kabsch superposition algorithm
// Pure JS implementation for aligning two sets of 3D points.
// Uses SVD via Jacobi eigenvalue iterations.
// ============================================================

/**
 * Align mobile points onto target points using the Kabsch algorithm.
 * Returns rotation matrix, centers, and RMSD.
 *
 * @param {Float32Array|number[]} mobileXYZ - Flat [x0,y0,z0, x1,y1,z1, ...] mobile coords
 * @param {Float32Array|number[]} targetXYZ - Flat [x0,y0,z0, ...] target coords
 * @param {number} n - Number of points
 * @returns {{ rotation: Float64Array, mobileCenter: Float64Array, targetCenter: Float64Array, rmsd: number }}
 */
export function kabschAlign(mobileXYZ, targetXYZ, n) {
  if (n < 3) throw new Error('Need at least 3 points for Kabsch alignment');

  // 1. Compute centroids
  const mc = new Float64Array(3);
  const tc = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    mc[0] += mobileXYZ[i * 3];
    mc[1] += mobileXYZ[i * 3 + 1];
    mc[2] += mobileXYZ[i * 3 + 2];
    tc[0] += targetXYZ[i * 3];
    tc[1] += targetXYZ[i * 3 + 1];
    tc[2] += targetXYZ[i * 3 + 2];
  }
  mc[0] /= n; mc[1] /= n; mc[2] /= n;
  tc[0] /= n; tc[1] /= n; tc[2] /= n;

  // 2. Center both point sets
  const P = new Float64Array(n * 3); // centered mobile
  const Q = new Float64Array(n * 3); // centered target
  for (let i = 0; i < n; i++) {
    P[i * 3]     = mobileXYZ[i * 3]     - mc[0];
    P[i * 3 + 1] = mobileXYZ[i * 3 + 1] - mc[1];
    P[i * 3 + 2] = mobileXYZ[i * 3 + 2] - mc[2];
    Q[i * 3]     = targetXYZ[i * 3]     - tc[0];
    Q[i * 3 + 1] = targetXYZ[i * 3 + 1] - tc[1];
    Q[i * 3 + 2] = targetXYZ[i * 3 + 2] - tc[2];
  }

  // 3. Compute 3x3 cross-covariance matrix H = P^T * Q
  const H = new Float64Array(9); // row-major [H00, H01, H02, H10, ...]
  for (let i = 0; i < n; i++) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    const qx = Q[i * 3], qy = Q[i * 3 + 1], qz = Q[i * 3 + 2];
    H[0] += px * qx; H[1] += px * qy; H[2] += px * qz;
    H[3] += py * qx; H[4] += py * qy; H[5] += py * qz;
    H[6] += pz * qx; H[7] += pz * qy; H[8] += pz * qz;
  }

  // 4. SVD of H: H = U * S * V^T
  const { U, S, V } = svd3x3(H);

  // 5. Correct for reflection: ensure det(V * U^T) = +1
  const d = det3x3(V) * det3x3(U);
  const sign = new Float64Array([1, 1, d < 0 ? -1 : 1]);

  // 6. Rotation R = V * diag(sign) * U^T
  const R = new Float64Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) {
        sum += V[i * 3 + k] * sign[k] * U[j * 3 + k]; // U^T: swap j,k
      }
      R[i * 3 + j] = sum;
    }
  }

  // 7. Compute RMSD after alignment
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const px = P[i * 3], py = P[i * 3 + 1], pz = P[i * 3 + 2];
    // Rotated mobile point
    const rx = R[0] * px + R[1] * py + R[2] * pz;
    const ry = R[3] * px + R[4] * py + R[5] * pz;
    const rz = R[6] * px + R[7] * py + R[8] * pz;
    const dx = rx - Q[i * 3];
    const dy = ry - Q[i * 3 + 1];
    const dz = rz - Q[i * 3 + 2];
    sumSq += dx * dx + dy * dy + dz * dz;
  }
  const rmsd = Math.sqrt(sumSq / n);

  return {
    rotation: R,
    mobileCenter: mc,
    targetCenter: tc,
    rmsd,
  };
}

/**
 * Pair CA atoms between two models by chainId:resSeq match.
 * Falls back to sequential CA pairing if chain IDs don't overlap.
 *
 * @param {Object} mobileModel - parsePDB output
 * @param {Object} targetModel - parsePDB output
 * @returns {{ mobileIndices: number[], targetIndices: number[], count: number }}
 */
export function pairCAAtoms(mobileModel, targetModel) {
  // Build maps of chainId:resSeq → atom index for CA atoms
  const mobileMap = new Map();
  const targetMap = new Map();

  for (const res of mobileModel.residues) {
    if (res.caIndex >= 0) {
      const key = `${mobileModel.atoms[res.caIndex].chainId}:${res.seq}`;
      mobileMap.set(key, res.caIndex);
    }
  }

  for (const res of targetModel.residues) {
    if (res.caIndex >= 0) {
      const key = `${targetModel.atoms[res.caIndex].chainId}:${res.seq}`;
      targetMap.set(key, res.caIndex);
    }
  }

  // Try matching by chainId:resSeq
  const mobileIndices = [];
  const targetIndices = [];

  for (const [key, mIdx] of mobileMap) {
    if (targetMap.has(key)) {
      mobileIndices.push(mIdx);
      targetIndices.push(targetMap.get(key));
    }
  }

  if (mobileIndices.length >= 3) {
    return { mobileIndices, targetIndices, count: mobileIndices.length };
  }

  // Fallback: sequential CA pairing (ignore chain IDs)
  const mobileCAs = [];
  const targetCAs = [];

  for (const res of mobileModel.residues) {
    if (res.caIndex >= 0) mobileCAs.push(res.caIndex);
  }
  for (const res of targetModel.residues) {
    if (res.caIndex >= 0) targetCAs.push(res.caIndex);
  }

  const count = Math.min(mobileCAs.length, targetCAs.length);
  return {
    mobileIndices: mobileCAs.slice(0, count),
    targetIndices: targetCAs.slice(0, count),
    count,
  };
}

/**
 * Apply rotation + translation transform to a model in place.
 * Transforms: x' = R * (x - mobileCenter) + targetCenter
 *
 * @param {Object} model - parsePDB output (modified in place)
 * @param {Float64Array} rotation - 3x3 row-major rotation matrix
 * @param {Float64Array} mobileCenter - Center of mobile point set
 * @param {Float64Array} targetCenter - Center of target point set
 */
export function applyTransform(model, rotation, mobileCenter, targetCenter) {
  const R = rotation;
  const mc = mobileCenter;
  const tc = targetCenter;
  const pos = model.positions;

  for (let i = 0; i < model.atomCount; i++) {
    const ox = pos[i * 3]     - mc[0];
    const oy = pos[i * 3 + 1] - mc[1];
    const oz = pos[i * 3 + 2] - mc[2];

    const nx = R[0] * ox + R[1] * oy + R[2] * oz + tc[0];
    const ny = R[3] * ox + R[4] * oy + R[5] * oz + tc[1];
    const nz = R[6] * ox + R[7] * oy + R[8] * oz + tc[2];

    pos[i * 3]     = nx;
    pos[i * 3 + 1] = ny;
    pos[i * 3 + 2] = nz;

    // Also update atom objects
    model.atoms[i].x = nx;
    model.atoms[i].y = ny;
    model.atoms[i].z = nz;
  }
}

// ============================================================
// SVD of a 3x3 matrix via Jacobi eigenvalue method
// ============================================================

/**
 * Compute SVD of a 3x3 matrix: A = U * diag(S) * V^T
 * Uses the relation: A^T A = V * diag(S^2) * V^T
 * Then U = A * V * diag(1/S)
 */
function svd3x3(A) {
  // Compute A^T * A
  const AtA = new Float64Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      let s = 0;
      for (let k = 0; k < 3; k++) {
        s += A[k * 3 + i] * A[k * 3 + j]; // A^T[i,k] * A[k,j]
      }
      AtA[i * 3 + j] = s;
    }
  }

  // Eigendecomposition of symmetric AtA via Jacobi iterations
  const { eigenvalues, eigenvectors } = jacobiEigen3x3(AtA);

  // Sort eigenvalues descending
  const order = [0, 1, 2];
  order.sort((a, b) => eigenvalues[b] - eigenvalues[a]);

  const S = new Float64Array(3);
  const V = new Float64Array(9);

  for (let col = 0; col < 3; col++) {
    const src = order[col];
    S[col] = Math.sqrt(Math.max(0, eigenvalues[src]));
    for (let row = 0; row < 3; row++) {
      V[row * 3 + col] = eigenvectors[row * 3 + src];
    }
  }

  // U = A * V * diag(1/S)
  const U = new Float64Array(9);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (S[j] < 1e-10) {
        U[i * 3 + j] = (i === j) ? 1 : 0;
        continue;
      }
      let s = 0;
      for (let k = 0; k < 3; k++) {
        s += A[i * 3 + k] * V[k * 3 + j];
      }
      U[i * 3 + j] = s / S[j];
    }
  }

  // Orthonormalize U (Gram-Schmidt) in case of near-zero singular values
  orthonormalize3x3(U);

  return { U, S, V };
}

/**
 * Jacobi eigenvalue algorithm for a 3x3 symmetric matrix.
 * Returns eigenvalues and column eigenvectors.
 */
function jacobiEigen3x3(A) {
  const M = Float64Array.from(A);
  // Eigenvectors start as identity
  const V = new Float64Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);

  const MAX_ITER = 50;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    // Find largest off-diagonal element
    let maxVal = 0, p = 0, q = 1;
    for (let i = 0; i < 3; i++) {
      for (let j = i + 1; j < 3; j++) {
        const v = Math.abs(M[i * 3 + j]);
        if (v > maxVal) { maxVal = v; p = i; q = j; }
      }
    }
    if (maxVal < 1e-15) break;

    // Compute rotation angle
    const app = M[p * 3 + p], aqq = M[q * 3 + q], apq = M[p * 3 + q];
    let theta;
    if (Math.abs(app - aqq) < 1e-15) {
      theta = Math.PI / 4;
    } else {
      theta = 0.5 * Math.atan2(2 * apq, app - aqq);
    }

    const c = Math.cos(theta), s = Math.sin(theta);

    // Apply Jacobi rotation to M
    const newM = Float64Array.from(M);
    for (let i = 0; i < 3; i++) {
      if (i === p || i === q) continue;
      newM[i * 3 + p] = c * M[i * 3 + p] + s * M[i * 3 + q];
      newM[p * 3 + i] = newM[i * 3 + p];
      newM[i * 3 + q] = -s * M[i * 3 + p] + c * M[i * 3 + q];
      newM[q * 3 + i] = newM[i * 3 + q];
    }
    newM[p * 3 + p] = c * c * app + 2 * s * c * apq + s * s * aqq;
    newM[q * 3 + q] = s * s * app - 2 * s * c * apq + c * c * aqq;
    newM[p * 3 + q] = 0;
    newM[q * 3 + p] = 0;
    M.set(newM);

    // Update eigenvectors
    for (let i = 0; i < 3; i++) {
      const vip = V[i * 3 + p];
      const viq = V[i * 3 + q];
      V[i * 3 + p] = c * vip + s * viq;
      V[i * 3 + q] = -s * vip + c * viq;
    }
  }

  return {
    eigenvalues: new Float64Array([M[0], M[4], M[8]]),
    eigenvectors: V,
  };
}

/**
 * Gram-Schmidt orthonormalization of a 3x3 column-major matrix.
 */
function orthonormalize3x3(M) {
  for (let col = 0; col < 3; col++) {
    // Subtract projections of previous columns
    for (let prev = 0; prev < col; prev++) {
      let dot = 0;
      for (let r = 0; r < 3; r++) dot += M[r * 3 + col] * M[r * 3 + prev];
      for (let r = 0; r < 3; r++) M[r * 3 + col] -= dot * M[r * 3 + prev];
    }
    // Normalize
    let len = 0;
    for (let r = 0; r < 3; r++) len += M[r * 3 + col] * M[r * 3 + col];
    len = Math.sqrt(len);
    if (len > 1e-10) {
      for (let r = 0; r < 3; r++) M[r * 3 + col] /= len;
    }
  }
}

/**
 * Determinant of a 3x3 row-major matrix.
 */
function det3x3(M) {
  return (
    M[0] * (M[4] * M[8] - M[5] * M[7]) -
    M[1] * (M[3] * M[8] - M[5] * M[6]) +
    M[2] * (M[3] * M[7] - M[4] * M[6])
  );
}
