// ============================================================
// parser.js — PDB file format parser
// Parses ATOM/HETATM, HELIX/SHEET, CONECT, MODEL/ENDMDL
// Output: GPU-friendly typed arrays + per-residue/chain metadata
// ============================================================

// Element → atomic number (for covalent radii lookup in bondInference)
const ELEMENT_SYMS = [
  '', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne',
  'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar', 'K', 'Ca',
  'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn',
  'Ga', 'Ge', 'As', 'Se', 'Br',
];

function guessElement(atomName, resName) {
  // PDB columns 77-78 hold the element symbol, but many files leave it blank.
  // Fallback: derive from atom name (columns 13-16).
  const name = atomName.trim();
  // Common ions / multi-letter elements first
  if (name === 'FE' || name === 'FE2') return 'FE';
  if (name === 'ZN') return 'ZN';
  if (name === 'MG') return 'MG';
  if (name === 'CA' && (resName === 'CA' || resName === ' CA')) return 'CA'; // calcium ion
  if (name === 'CL') return 'CL';
  if (name === 'BR') return 'BR';
  if (name === 'SE') return 'SE';
  // Single-letter: first non-digit character
  for (let i = 0; i < name.length; i++) {
    const ch = name[i];
    if (ch >= 'A' && ch <= 'Z') return ch;
  }
  return 'C';
}

// Standard amino acid 3-letter codes
const STANDARD_AA = new Set([
  'ALA', 'ARG', 'ASN', 'ASP', 'CYS', 'GLN', 'GLU', 'GLY',
  'HIS', 'ILE', 'LEU', 'LYS', 'MET', 'PHE', 'PRO', 'SER',
  'THR', 'TRP', 'TYR', 'VAL',
]);

// 3-letter → 1-letter code
const AA_1LETTER = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C',
  GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P',
  SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
};

// Secondary structure type enum
export const SS_COIL = 0;
export const SS_HELIX = 1;
export const SS_SHEET = 2;

/**
 * Parse a PDB-format string into a structured protein model.
 *
 * @param {string} pdbText - Raw PDB file contents
 * @returns {Object} Parsed protein model
 */
export function parsePDB(pdbText) {
  const lines = pdbText.split('\n');

  // Temporary arrays (will convert to typed arrays at end)
  const atoms = [];       // { x, y, z, element, name, serial, resName, resSeq, chainId, bFactor, isHet, altLoc, iCode }
  const helices = [];     // { startChain, startSeq, startICode, endChain, endSeq, endICode }
  const sheets = [];      // { startChain, startSeq, startICode, endChain, endSeq, endICode }
  const conectMap = {};   // serial → [serial, serial, ...]

  // Header metadata — multi-line records get concatenated
  const header = { classification: '', pdbId: '', date: '', title: '', compound: '', source: '', method: '', resolution: null };
  const titleParts = [];
  const compndParts = [];
  const sourceParts = [];

  let inFirstModel = true;
  let seenModel = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length < 6) continue;
    const record = line.substring(0, 6);

    // ---- Header metadata records ----
    if (record === 'HEADER') {
      header.classification = line.substring(10, 50).trim();
      header.date = line.substring(50, 59).trim();
      header.pdbId = line.substring(62, 66).trim();
      continue;
    }
    if (record === 'TITLE ') {
      titleParts.push(line.substring(10).trim());
      continue;
    }
    if (record === 'COMPND') {
      compndParts.push(line.substring(10).trim());
      continue;
    }
    if (record === 'SOURCE') {
      sourceParts.push(line.substring(10).trim());
      continue;
    }
    if (record === 'EXPDTA') {
      header.method = line.substring(10).trim();
      continue;
    }
    if (record.startsWith('REMARK')) {
      // REMARK 2 — resolution
      const remarkNum = parseInt(line.substring(7, 10));
      if (remarkNum === 2 && line.includes('RESOLUTION')) {
        const match = line.match(/(\d+\.\d+)\s*ANGSTROM/);
        if (match) header.resolution = parseFloat(match[1]);
      }
      continue;
    }

    // MODEL/ENDMDL — only parse first model (NMR structures)
    if (record === 'MODEL ') {
      if (seenModel) { inFirstModel = false; continue; }
      seenModel = true;
      continue;
    }
    if (record === 'ENDMDL') {
      if (seenModel) inFirstModel = false;
      continue;
    }
    if (!inFirstModel) continue;

    // ATOM / HETATM
    if (record === 'ATOM  ' || record === 'HETATM') {
      // Skip alternate conformations other than 'A' or ' '
      const altLoc = line[16] || ' ';
      if (altLoc !== ' ' && altLoc !== 'A') continue;

      const serial = parseInt(line.substring(6, 11)) || 0;
      const atomName = line.substring(12, 16);
      const resName = line.substring(17, 20).trim();
      const chainId = line[21] || 'A';
      const resSeq = parseInt(line.substring(22, 26)) || 0;
      const iCode = line[26] || ' ';
      const x = parseFloat(line.substring(30, 38)) || 0;
      const y = parseFloat(line.substring(38, 46)) || 0;
      const z = parseFloat(line.substring(46, 54)) || 0;
      const bFactor = parseFloat(line.substring(60, 66)) || 0;

      // Element from columns 77-78, fallback to guess
      let element = (line.length >= 78) ? line.substring(76, 78).trim() : '';
      if (!element) element = guessElement(atomName, resName);
      element = element.toUpperCase();

      atoms.push({
        x, y, z,
        element,
        name: atomName.trim(),
        serial,
        resName,
        resSeq,
        chainId,
        bFactor,
        isHet: record === 'HETATM',
        altLoc,
        iCode,
      });
      continue;
    }

    // HELIX
    if (record === 'HELIX ') {
      helices.push({
        startChain: line[19] || '',
        startSeq: parseInt(line.substring(21, 25)) || 0,
        startICode: line[25] || ' ',
        endChain: line[31] || '',
        endSeq: parseInt(line.substring(33, 37)) || 0,
        endICode: line[37] || ' ',
      });
      continue;
    }

    // SHEET
    if (record === 'SHEET ') {
      sheets.push({
        startChain: line[21] || '',
        startSeq: parseInt(line.substring(22, 26)) || 0,
        startICode: line[26] || ' ',
        endChain: line[32] || '',
        endSeq: parseInt(line.substring(33, 37)) || 0,
        endICode: line[37] || ' ',
      });
      continue;
    }

    // CONECT
    if (record === 'CONECT') {
      const src = parseInt(line.substring(6, 11)) || 0;
      if (!conectMap[src]) conectMap[src] = [];
      for (let col = 11; col < 31 && col + 5 <= line.length; col += 5) {
        const tgt = parseInt(line.substring(col, col + 5));
        if (tgt && tgt !== src) conectMap[src].push(tgt);
      }
      continue;
    }
  }

  if (atoms.length === 0) {
    return null;
  }

  // Build serial → index map
  const serialToIdx = new Map();
  for (let i = 0; i < atoms.length; i++) {
    serialToIdx.set(atoms[i].serial, i);
  }

  // Build typed arrays
  const n = atoms.length;
  const positions = new Float32Array(n * 3);
  const bFactors = new Float32Array(n);
  const elements = new Uint8Array(n);     // element index
  const isHetArr = new Uint8Array(n);

  // Element string → index mapping
  const elementIndex = {};
  const elementList = [];

  for (let i = 0; i < n; i++) {
    const a = atoms[i];
    positions[i * 3] = a.x;
    positions[i * 3 + 1] = a.y;
    positions[i * 3 + 2] = a.z;
    bFactors[i] = a.bFactor;
    isHetArr[i] = a.isHet ? 1 : 0;

    if (!(a.element in elementIndex)) {
      elementIndex[a.element] = elementList.length;
      elementList.push(a.element);
    }
    elements[i] = elementIndex[a.element];
  }

  // Build residue list
  const residues = [];
  let prevKey = null;
  for (let i = 0; i < n; i++) {
    const a = atoms[i];
    const key = `${a.chainId}:${a.resSeq}:${a.iCode}`;
    if (key !== prevKey) {
      residues.push({
        name: a.resName,
        seq: a.resSeq,
        chainId: a.chainId,
        iCode: a.iCode,
        atomStart: i,
        atomEnd: i + 1,
        isStandard: STANDARD_AA.has(a.resName),
        oneLetterCode: AA_1LETTER[a.resName] || '?',
        ss: SS_COIL,
        caIndex: -1,
        cIndex: -1,
        nIndex: -1,
      });
      prevKey = key;
    } else {
      residues[residues.length - 1].atomEnd = i + 1;
    }
  }

  // Assign CA, C, N indices per residue
  // For nucleic acids (no CA), use C3' as the backbone trace atom
  for (const res of residues) {
    let c3Idx = -1;
    for (let j = res.atomStart; j < res.atomEnd; j++) {
      const name = atoms[j].name;
      if (name === 'CA') res.caIndex = j;
      else if (name === 'C' && atoms[j].element === 'C') res.cIndex = j;
      else if (name === 'N' && atoms[j].element === 'N') res.nIndex = j;
      else if (name === "C3'") c3Idx = j;
    }
    // Fallback: use C3' for nucleic acid residues
    if (res.caIndex < 0 && c3Idx >= 0) {
      res.caIndex = c3Idx;
    }
  }

  // Build chain list — split on consecutive chain ID changes
  const chains = [];
  if (residues.length > 0) {
    let curId = residues[0].chainId;
    let curStart = 0;
    for (let ri = 1; ri < residues.length; ri++) {
      if (residues[ri].chainId !== curId) {
        chains.push({ id: curId, residueStart: curStart, residueEnd: ri });
        curId = residues[ri].chainId;
        curStart = ri;
      }
    }
    chains.push({ id: curId, residueStart: curStart, residueEnd: residues.length });
  }

  // Assign secondary structure from HELIX/SHEET records
  for (const h of helices) {
    assignSS(residues, h.startChain, h.startSeq, h.startICode,
             h.endChain, h.endSeq, h.endICode, SS_HELIX);
  }
  for (const s of sheets) {
    assignSS(residues, s.startChain, s.startSeq, s.startICode,
             s.endChain, s.endSeq, s.endICode, SS_SHEET);
  }

  // Convert CONECT to index-based bonds
  const conectBonds = [];
  const conectSeen = new Set();
  for (const [srcStr, targets] of Object.entries(conectMap)) {
    const srcSerial = parseInt(srcStr);
    const srcIdx = serialToIdx.get(srcSerial);
    if (srcIdx === undefined) continue;
    for (const tgtSerial of targets) {
      const tgtIdx = serialToIdx.get(tgtSerial);
      if (tgtIdx === undefined) continue;
      const bondKey = Math.min(srcIdx, tgtIdx) + ':' + Math.max(srcIdx, tgtIdx);
      if (!conectSeen.has(bondKey)) {
        conectSeen.add(bondKey);
        conectBonds.push([srcIdx, tgtIdx]);
      }
    }
  }

  // Finalize header metadata
  header.title = titleParts.join(' ');
  header.compound = compndParts.join(' ');
  header.source = sourceParts.join(' ');

  return {
    atoms,           // full atom objects (for name/resName lookups)
    positions,       // Float32Array [x0,y0,z0, x1,y1,z1, ...]
    bFactors,        // Float32Array
    elements,        // Uint8Array (indices into elementList)
    elementList,     // string[] — element symbols
    isHet: isHetArr, // Uint8Array
    residues,        // [{name, seq, chainId, atomStart, atomEnd, ss, caIndex, ...}]
    chains,          // [{id, residueStart, residueEnd}]
    conectBonds,     // [[atomIdx, atomIdx], ...]
    atomCount: n,
    header,          // { classification, pdbId, date, title, compound, source, method, resolution }
  };
}

function assignSS(residues, startChain, startSeq, startICode, endChain, endSeq, endICode, ssType) {
  let inside = false;
  for (const res of residues) {
    if (res.chainId === startChain && res.seq === startSeq && res.iCode === startICode) {
      inside = true;
    }
    if (inside) {
      res.ss = ssType;
    }
    if (res.chainId === endChain && res.seq === endSeq && res.iCode === endICode) {
      inside = false;
    }
  }
}
