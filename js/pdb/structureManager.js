// ============================================================
// structureManager.js — Multi-structure registry
// Manages multiple PDB structures loaded simultaneously.
// Each structure tracks its model, bonds, atom offset, and color.
// ============================================================

import * as THREE from 'three';

// Auto-color palette for additional structures (first keeps element colors)
const STRUCTURE_PALETTE = [
  0x00BFFF, 0xFF6347, 0xFFD700, 0xFF69B4, 0x7B68EE,
  0x20B2AA, 0xFF8C00, 0x32CD32, 0xDA70D6, 0x00CED1,
];

/**
 * StructureManager — registry for multiple loaded PDB structures.
 *
 * Each entry tracks:
 *  - name:       display name (deduplicated)
 *  - model:      parsePDB output for this structure
 *  - bonds:      Uint32Array of local bond pairs
 *  - atomOffset: position in the merged global arrays
 *  - atomCount:  number of atoms
 *  - color:      THREE.Color (null = element colors for first structure)
 */
export class StructureManager {
  constructor() {
    /** @type {Map<string, StructureEntry>} */
    this.structures = new Map();
    this._insertionOrder = [];
  }

  /**
   * Add a structure to the registry.
   * Deduplicates names ("1CRN" → "1CRN_2" on collision).
   *
   * @param {string} name - Desired display name
   * @param {Object} model - parsePDB output
   * @param {Uint32Array} bonds - Bond pairs [a0,b0, a1,b1, ...]
   * @returns {string} Actual name used (may be deduplicated)
   */
  addStructure(name, model, bonds) {
    const actualName = this._deduplicateName(name);

    // Compute offset: sum of all existing atom counts
    let offset = 0;
    for (const entry of this.structures.values()) {
      offset += entry.atomCount;
    }

    // Assign color: first structure keeps element colors (null),
    // subsequent get a uniform tint from the palette
    const index = this._insertionOrder.length;
    const color = index === 0
      ? null
      : new THREE.Color(STRUCTURE_PALETTE[(index - 1) % STRUCTURE_PALETTE.length]);

    const entry = {
      name: actualName,
      model,
      bonds,
      atomOffset: offset,
      atomCount: model.atomCount,
      color,
    };

    this.structures.set(actualName.toLowerCase(), entry);
    this._insertionOrder.push(actualName.toLowerCase());

    return actualName;
  }

  /**
   * Remove a structure by name.
   * Recalculates offsets for remaining structures.
   *
   * @param {string} name
   * @returns {boolean} true if removed
   */
  removeStructure(name) {
    const key = name.toLowerCase();
    if (!this.structures.has(key)) return false;

    this.structures.delete(key);
    this._insertionOrder = this._insertionOrder.filter(k => k !== key);
    this._recalculateOffsets();
    return true;
  }

  /**
   * Build a merged model by concatenating all structures' atoms, positions,
   * residues, chains, etc. Attaches _structureRanges for selection system.
   *
   * @returns {Object|null} Merged model or null if empty
   */
  buildMergedModel() {
    if (this.structures.size === 0) return null;

    // Single structure: return its model directly (with _structureRanges attached)
    if (this.structures.size === 1) {
      const entry = this.structures.values().next().value;
      const model = entry.model;
      model._structureRanges = new Map();
      model._structureRanges.set(entry.name.toLowerCase(), {
        atomOffset: 0,
        atomCount: entry.atomCount,
      });
      return model;
    }

    // Multiple structures: concatenate everything
    let totalAtoms = 0;
    let totalResidues = 0;
    let totalChains = 0;
    for (const entry of this._orderedEntries()) {
      totalAtoms += entry.model.atomCount;
      totalResidues += entry.model.residues.length;
      totalChains += entry.model.chains.length;
    }

    const mergedAtoms = [];
    const mergedPositions = new Float32Array(totalAtoms * 3);
    const mergedBFactors = new Float32Array(totalAtoms);
    const mergedElements = new Uint8Array(totalAtoms);
    const mergedIsHet = new Uint8Array(totalAtoms);
    const mergedResidues = [];
    const mergedChains = [];
    const elementListSet = new Set();
    const mergedConectBonds = [];
    const structureRanges = new Map();

    let atomOff = 0;
    let residueOff = 0;

    for (const entry of this._orderedEntries()) {
      const m = entry.model;
      const aOff = atomOff;

      // Record structure range
      structureRanges.set(entry.name.toLowerCase(), {
        atomOffset: aOff,
        atomCount: m.atomCount,
      });

      // Atoms
      for (let i = 0; i < m.atomCount; i++) {
        const atom = { ...m.atoms[i] };
        // Offset serial to avoid collisions
        atom._globalIndex = aOff + i;
        mergedAtoms.push(atom);
      }

      // Positions
      mergedPositions.set(m.positions, aOff * 3);

      // B-factors
      mergedBFactors.set(m.bFactors, aOff);

      // Elements
      mergedElements.set(m.elements, aOff);

      // isHet
      mergedIsHet.set(m.isHet, aOff);

      // Element list
      for (const el of m.elementList) elementListSet.add(el);

      // Residues (offset atomStart/atomEnd and special indices)
      const rOff = residueOff;
      for (const res of m.residues) {
        mergedResidues.push({
          ...res,
          atomStart: res.atomStart + aOff,
          atomEnd: res.atomEnd + aOff,
          caIndex: res.caIndex >= 0 ? res.caIndex + aOff : -1,
          cIndex: res.cIndex >= 0 ? res.cIndex + aOff : -1,
          nIndex: res.nIndex >= 0 ? res.nIndex + aOff : -1,
        });
      }

      // Chains (offset residueStart/residueEnd)
      for (const chain of m.chains) {
        mergedChains.push({
          ...chain,
          residueStart: chain.residueStart + rOff,
          residueEnd: chain.residueEnd + rOff,
        });
      }

      // CONECT bonds
      for (const [i, j] of m.conectBonds) {
        mergedConectBonds.push([i + aOff, j + aOff]);
      }

      atomOff += m.atomCount;
      residueOff += m.residues.length;
    }

    // Use header from first structure
    const firstEntry = this._orderedEntries()[0];

    const merged = {
      atoms: mergedAtoms,
      atomCount: totalAtoms,
      positions: mergedPositions,
      bFactors: mergedBFactors,
      elements: mergedElements,
      elementList: [...elementListSet],
      isHet: mergedIsHet,
      residues: mergedResidues,
      chains: mergedChains,
      conectBonds: mergedConectBonds,
      header: firstEntry.model.header,
      _structureRanges: structureRanges,
    };

    return merged;
  }

  /**
   * Build merged bond array by concatenating all structures' bonds
   * with atom offset adjustments.
   *
   * @returns {Uint32Array} Merged bond pairs
   */
  buildMergedBonds() {
    if (this.structures.size === 0) return new Uint32Array(0);

    if (this.structures.size === 1) {
      return this.structures.values().next().value.bonds;
    }

    let totalBondPairs = 0;
    for (const entry of this._orderedEntries()) {
      totalBondPairs += entry.bonds.length;
    }

    const merged = new Uint32Array(totalBondPairs);
    let pos = 0;

    for (const entry of this._orderedEntries()) {
      const off = entry.atomOffset;
      const b = entry.bonds;
      for (let i = 0; i < b.length; i++) {
        merged[pos++] = b[i] + off;
      }
    }

    return merged;
  }

  /**
   * Look up which structure owns a global atom index.
   *
   * @param {number} globalIndex
   * @returns {{ name: string, localIndex: number, entry: Object }|null}
   */
  getStructureForAtom(globalIndex) {
    for (const entry of this.structures.values()) {
      if (globalIndex >= entry.atomOffset &&
          globalIndex < entry.atomOffset + entry.atomCount) {
        return {
          name: entry.name,
          localIndex: globalIndex - entry.atomOffset,
          entry,
        };
      }
    }
    return null;
  }

  /**
   * Get ordered list of structure names.
   * @returns {string[]}
   */
  getStructureNames() {
    return this._insertionOrder.map(k => this.structures.get(k).name);
  }

  /**
   * Get total atom count across all structures.
   * @returns {number}
   */
  getTotalAtomCount() {
    let total = 0;
    for (const entry of this.structures.values()) {
      total += entry.atomCount;
    }
    return total;
  }

  /**
   * Get a structure entry by name.
   * @param {string} name
   * @returns {Object|null}
   */
  getStructure(name) {
    return this.structures.get(name.toLowerCase()) || null;
  }

  /**
   * Get number of loaded structures.
   * @returns {number}
   */
  get count() {
    return this.structures.size;
  }

  /**
   * Clear all structures.
   */
  clear() {
    this.structures.clear();
    this._insertionOrder = [];
  }

  // ---- Private helpers ----

  /**
   * Deduplicate name: if "1CRN" exists, return "1CRN_2", then "1CRN_3", etc.
   */
  _deduplicateName(name) {
    const base = name.toUpperCase();
    if (!this.structures.has(base.toLowerCase())) return base;
    let counter = 2;
    while (this.structures.has(`${base}_${counter}`.toLowerCase())) {
      counter++;
    }
    return `${base}_${counter}`;
  }

  /**
   * Recalculate atomOffset for all structures based on insertion order.
   */
  _recalculateOffsets() {
    let offset = 0;
    for (const key of this._insertionOrder) {
      const entry = this.structures.get(key);
      entry.atomOffset = offset;
      offset += entry.atomCount;
    }
  }

  /**
   * Get entries in insertion order.
   * @returns {Object[]}
   */
  _orderedEntries() {
    return this._insertionOrder.map(k => this.structures.get(k));
  }
}
