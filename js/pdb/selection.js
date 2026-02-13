// ============================================================
// selection.js — PyMOL-style selection algebra engine
// Recursive descent parser: pure logic, no DOM/Three.js deps.
//
// Grammar:
//   expr      = or_expr
//   or_expr   = and_expr ("or" and_expr)*
//   and_expr  = not_expr ("and" not_expr)*
//   not_expr  = "not" not_expr | primary
//   primary   = "(" expr ")" | "byres" primary
//             | "within" NUM "of" primary | "around" NUM "of" primary
//             | "neighbor" primary | "bound_to" primary | selector | named_sel
//   selector  = "chain" ids | "resi" ranges | "resn" ids | "name" ids
//             | "elem" ids | "ss" types | "hetatm" | "polymer"
//             | "backbone" | "sidechain" | "organic" | "inorganic"
//             | "solvent" | "water" | "hydrogens" | "h" | "metals"
//             | "pepseq" WORD | "b" COMP NUM | "index" ranges | "id" ranges
//             | "all" | "none"
//   ids       = ID ("+" ID)*
//   ranges    = INT ("-" INT)? ("+" INT ("-" INT)?)*
//   COMP      = ">" | "<" | ">=" | "<=" | "="
// ============================================================

import { SS_HELIX, SS_SHEET } from './parser.js';

// ---- Token types ----
const T_WORD   = 'WORD';
const T_NUMBER = 'NUMBER';
const T_LPAREN = '(';
const T_RPAREN = ')';
const T_PLUS   = '+';
const T_DASH   = '-';
const T_COMP   = 'COMP';  // >, <, >=, <=, =
const T_EOF    = 'EOF';

// Backbone atom names (standard protein backbone)
const BACKBONE_NAMES = new Set(['N', 'CA', 'C', 'O', 'OXT', 'H', 'HA']);

// Water residue names
const WATER_NAMES = new Set(['HOH', 'WAT', 'H2O', 'DOD', 'TIP', 'TIP3', 'TIP4', 'SPC']);

// Metal elements (common in PDB structures)
const METAL_ELEMENTS = new Set([
  'LI', 'BE', 'NA', 'MG', 'AL', 'K', 'CA', 'SC', 'TI', 'V', 'CR', 'MN',
  'FE', 'CO', 'NI', 'CU', 'ZN', 'MO', 'AG', 'CD', 'W', 'AU', 'HG', 'PT', 'PB',
]);

// ---- Tokenizer ----
function tokenize(input) {
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (ch === ' ' || ch === '\t' || ch === ',') { i++; continue; }
    if (ch === '(') { tokens.push({ type: T_LPAREN, value: '(' }); i++; continue; }
    if (ch === ')') { tokens.push({ type: T_RPAREN, value: ')' }); i++; continue; }
    if (ch === '+') { tokens.push({ type: T_PLUS, value: '+' }); i++; continue; }
    if (ch === '-') { tokens.push({ type: T_DASH, value: '-' }); i++; continue; }
    // Number (integer or decimal) — but if digits are immediately followed by
    // letters (e.g. "5CM", "3HP"), emit as a WORD token (common in PDB residue/ligand names)
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (i < input.length && input[i] >= '0' && input[i] <= '9') { num += input[i]; i++; }
      if (i < input.length && input[i] === '.') {
        num += input[i]; i++;
        while (i < input.length && input[i] >= '0' && input[i] <= '9') { num += input[i]; i++; }
        // Check for trailing letters (e.g. unlikely but handle 1.5X)
        if (i < input.length && /[A-Za-z_]/.test(input[i])) {
          while (i < input.length && /[A-Za-z0-9_*']/.test(input[i])) { num += input[i]; i++; }
          tokens.push({ type: T_WORD, value: num });
        } else {
          tokens.push({ type: T_NUMBER, value: parseFloat(num) });
        }
      } else if (i < input.length && /[A-Za-z_]/.test(input[i])) {
        // Digits followed by letters: treat as identifier (e.g. "5CM", "3HP")
        while (i < input.length && /[A-Za-z0-9_*']/.test(input[i])) { num += input[i]; i++; }
        tokens.push({ type: T_WORD, value: num });
      } else {
        tokens.push({ type: T_NUMBER, value: parseInt(num) });
      }
      continue;
    }
    // Word (alphanumeric + underscore + *)
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_' || ch === '*') {
      let word = '';
      while (i < input.length && /[A-Za-z0-9_*']/.test(input[i])) { word += input[i]; i++; }
      tokens.push({ type: T_WORD, value: word });
      continue;
    }
    // Comparison operators
    if (ch === '>' || ch === '<') {
      if (i + 1 < input.length && input[i + 1] === '=') {
        tokens.push({ type: T_COMP, value: ch + '=' }); i += 2;
      } else {
        tokens.push({ type: T_COMP, value: ch }); i++;
      }
      continue;
    }
    if (ch === '=') { tokens.push({ type: T_COMP, value: '=' }); i++; continue; }
    // Skip unknown characters
    i++;
  }
  tokens.push({ type: T_EOF, value: null });
  return tokens;
}

// ---- Parser ----
class Parser {
  constructor(tokens, model, namedSelections, bonds) {
    this.tokens = tokens;
    this.pos = 0;
    this.model = model;
    this.named = namedSelections || new Map();
    this.bonds = bonds || null;
    this._adjacency = null;
  }

  peek() { return this.tokens[this.pos]; }
  advance() { return this.tokens[this.pos++]; }

  expect(type) {
    const t = this.advance();
    if (t.type !== type) throw new Error(`Expected ${type}, got ${t.type} "${t.value}"`);
    return t;
  }

  match(type, value) {
    const t = this.peek();
    if (t.type === type && (value === undefined || t.value === value)) {
      this.advance();
      return true;
    }
    return false;
  }

  matchWord(value) {
    const t = this.peek();
    if (t.type === T_WORD && t.value.toLowerCase() === value) {
      this.advance();
      return true;
    }
    return false;
  }

  // expr = or_expr
  parseExpr() {
    return this.parseOr();
  }

  // or_expr = and_expr ("or" and_expr)*
  parseOr() {
    let left = this.parseAnd();
    while (this.matchWord('or')) {
      const right = this.parseAnd();
      left = union(left, right);
    }
    return left;
  }

  // and_expr = not_expr (("and" | implicit) not_expr)*
  // Implicit "and": when the next token can start a primary (a selector keyword,
  // LPAREN, or "not"/"byres"/"within"/"around"/"neighbor"/"bound_to"),
  // treat adjacent primaries as intersection — matching PyMOL behavior.
  parseAnd() {
    let left = this.parseNot();
    while (true) {
      if (this.matchWord('and')) {
        left = intersection(left, this.parseNot());
        continue;
      }
      // Check for implicit "and": next token can start a not_expr
      const t = this.peek();
      if (t.type === T_LPAREN || (t.type === T_WORD && this._canStartPrimary(t.value.toLowerCase()))) {
        left = intersection(left, this.parseNot());
        continue;
      }
      break;
    }
    return left;
  }

  // Check if a keyword can begin a primary expression (for implicit "and" detection)
  _canStartPrimary(kw) {
    return [
      'not', 'byres', 'within', 'around', 'neighbor', 'bound_to',
      'chain', 'resi', 'resn', 'name', 'elem', 'ss',
      'hetatm', 'polymer', 'backbone', 'bb', 'sidechain', 'sc',
      'organic', 'inorganic', 'solvent', 'water', 'hydrogens', 'h', 'metals',
      'pepseq', 'b', 'index', 'id', 'all', 'none',
    ].includes(kw);
  }

  // not_expr = "not" not_expr | primary
  parseNot() {
    if (this.matchWord('not')) {
      const inner = this.parseNot();
      return complement(inner, this.model.atomCount);
    }
    return this.parsePrimary();
  }

  // primary = "(" expr ")" | "byres" primary | selector | named_sel
  parsePrimary() {
    const t = this.peek();

    // Parenthesized expression
    if (t.type === T_LPAREN) {
      this.advance();
      const result = this.parseExpr();
      this.expect(T_RPAREN);
      return result;
    }

    // byres
    if (t.type === T_WORD && t.value.toLowerCase() === 'byres') {
      this.advance();
      const inner = this.parsePrimary();
      return this.expandByResidue(inner);
    }

    // within / around X of <sel>
    if (t.type === T_WORD && (t.value.toLowerCase() === 'within' || t.value.toLowerCase() === 'around')) {
      const kw = t.value.toLowerCase();
      this.advance();
      const distToken = this.expect(T_NUMBER);
      const distance = distToken.value;
      // "of" is optional: "within 4.0 of chain A" and "within 4.0 chain A" both work
      this.matchWord('of');
      if (this.peek().type === T_EOF || this.peek().type === T_RPAREN) {
        throw new Error(`${kw} ${distance} needs a target selection, e.g.: ${kw} ${distance} of chain A`);
      }
      const targetSel = this.parsePrimary();
      const result = this.selectWithin(distance, targetSel);
      // "around" excludes the original selection; "within" includes it
      if (kw === 'around') {
        for (const idx of targetSel) result.delete(idx);
      }
      return result;
    }

    // Selectors
    if (t.type === T_WORD) {
      const kw = t.value.toLowerCase();
      switch (kw) {
        case 'chain':   this.advance(); return this.selectChain();
        case 'resi':    this.advance(); return this.selectResi();
        case 'resn':    this.advance(); return this.selectResn();
        case 'name':    this.advance(); return this.selectName();
        case 'elem':    this.advance(); return this.selectElem();
        case 'ss':      this.advance(); return this.selectSS();
        case 'hetatm':  this.advance(); return this.selectHetatm();
        case 'polymer': this.advance(); return this.selectPolymer();
        case 'backbone':
        case 'bb':      this.advance(); return this.selectBackbone();
        case 'sidechain':
        case 'sc':      this.advance(); return this.selectSidechain();
        case 'organic':   this.advance(); return this.selectOrganic();
        case 'inorganic': this.advance(); return this.selectInorganic();
        case 'solvent':
        case 'water':     this.advance(); return this.selectSolvent();
        case 'hydrogens':
        case 'h':         this.advance(); return this.selectHydrogens();
        case 'metals':    this.advance(); return this.selectMetals();
        case 'pepseq':    this.advance(); return this.selectPepseq();
        case 'b':         this.advance(); return this.selectBFactor();
        case 'neighbor':
        case 'bound_to':  this.advance(); return this.selectNeighbor(this.parsePrimary());
        case 'model':     this.advance(); return this.selectModel();
        case 'index':     this.advance(); return this.selectIndex();
        case 'id':        this.advance(); return this.selectId();
        case 'all':     this.advance(); return allAtoms(this.model.atomCount);
        case 'none':    this.advance(); return new Set();
        default: {
          // Check named selections
          if (this.named.has(kw)) {
            this.advance();
            return new Set(this.named.get(kw));
          }
          // Try as implicit "all" for single unknown word at top level
          throw new Error(`Unknown selector: "${t.value}"`);
        }
      }
    }

    throw new Error(`Unexpected token: ${t.type} "${t.value}"`);
  }

  // Parse comma-separated or plus-separated IDs
  parseIds() {
    const ids = [];
    const t = this.peek();
    if (t.type === T_WORD || t.type === T_NUMBER) {
      ids.push(String(this.advance().value).toUpperCase());
      while (this.match(T_PLUS)) {
        const next = this.peek();
        if (next.type === T_WORD || next.type === T_NUMBER) {
          ids.push(String(this.advance().value).toUpperCase());
        }
      }
    }
    return ids;
  }

  // Parse residue ranges: INT ("-" INT)? ("+" INT ("-" INT)?)*
  parseRanges() {
    const ranges = [];
    const parseOneRange = () => {
      const t = this.peek();
      if (t.type !== T_NUMBER) return null;
      const start = this.advance().value;
      if (this.match(T_DASH)) {
        const endT = this.peek();
        if (endT.type === T_NUMBER) {
          return { start, end: this.advance().value };
        }
        // Negative number - treat as just start
        return { start, end: start };
      }
      return { start, end: start };
    };

    const first = parseOneRange();
    if (first) ranges.push(first);
    while (this.match(T_PLUS)) {
      const r = parseOneRange();
      if (r) ranges.push(r);
    }
    return ranges;
  }

  // ---- Selector implementations ----

  selectChain() {
    const ids = this.parseIds();
    const set = new Set();
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      if (ids.includes(atoms[i].chainId.toUpperCase())) set.add(i);
    }
    return set;
  }

  selectResi() {
    const ranges = this.parseRanges();
    const set = new Set();
    const { residues } = this.model;
    for (const res of residues) {
      for (const r of ranges) {
        if (res.seq >= r.start && res.seq <= r.end) {
          for (let j = res.atomStart; j < res.atomEnd; j++) set.add(j);
          break;
        }
      }
    }
    return set;
  }

  selectResn() {
    const ids = this.parseIds();
    const set = new Set();
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      if (ids.includes(atoms[i].resName.toUpperCase())) set.add(i);
    }
    return set;
  }

  selectName() {
    const ids = this.parseIds();
    const set = new Set();
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      if (ids.includes(atoms[i].name.toUpperCase())) set.add(i);
    }
    return set;
  }

  selectElem() {
    const ids = this.parseIds();
    const set = new Set();
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      if (ids.includes(atoms[i].element.toUpperCase())) set.add(i);
    }
    return set;
  }

  selectSS() {
    const ids = this.parseIds();
    const ssTypes = new Set();
    for (const id of ids) {
      if (id === 'H') ssTypes.add(SS_HELIX);
      else if (id === 'S') ssTypes.add(SS_SHEET);
    }
    const set = new Set();
    const { residues } = this.model;
    for (const res of residues) {
      if (ssTypes.has(res.ss)) {
        for (let j = res.atomStart; j < res.atomEnd; j++) set.add(j);
      }
    }
    return set;
  }

  selectHetatm() {
    const set = new Set();
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      if (atoms[i].isHet) set.add(i);
    }
    return set;
  }

  selectPolymer() {
    const set = new Set();
    const { residues } = this.model;
    for (const res of residues) {
      if (res.isStandard) {
        for (let j = res.atomStart; j < res.atomEnd; j++) set.add(j);
      }
    }
    return set;
  }

  selectBackbone() {
    const set = new Set();
    const { atoms, residues } = this.model;
    for (const res of residues) {
      if (!res.isStandard) continue;
      for (let j = res.atomStart; j < res.atomEnd; j++) {
        if (BACKBONE_NAMES.has(atoms[j].name)) set.add(j);
      }
    }
    return set;
  }

  selectSidechain() {
    const set = new Set();
    const { atoms, residues } = this.model;
    for (const res of residues) {
      if (!res.isStandard) continue;
      for (let j = res.atomStart; j < res.atomEnd; j++) {
        if (!BACKBONE_NAMES.has(atoms[j].name)) set.add(j);
      }
    }
    return set;
  }

  // ---- New PyMOL-parity selectors ----

  selectOrganic() {
    const set = new Set();
    const { residues, atoms } = this.model;
    for (const res of residues) {
      if (res.isStandard || WATER_NAMES.has(res.name)) continue;
      let hasCarbon = false;
      for (let j = res.atomStart; j < res.atomEnd; j++) {
        if (atoms[j].element === 'C') { hasCarbon = true; break; }
      }
      if (hasCarbon) {
        for (let j = res.atomStart; j < res.atomEnd; j++) set.add(j);
      }
    }
    return set;
  }

  selectInorganic() {
    const set = new Set();
    const { residues, atoms } = this.model;
    for (const res of residues) {
      if (res.isStandard || WATER_NAMES.has(res.name)) continue;
      let hasCarbon = false;
      for (let j = res.atomStart; j < res.atomEnd; j++) {
        if (atoms[j].element === 'C') { hasCarbon = true; break; }
      }
      if (!hasCarbon) {
        for (let j = res.atomStart; j < res.atomEnd; j++) set.add(j);
      }
    }
    return set;
  }

  selectSolvent() {
    const set = new Set();
    const { residues } = this.model;
    for (const res of residues) {
      if (WATER_NAMES.has(res.name)) {
        for (let j = res.atomStart; j < res.atomEnd; j++) set.add(j);
      }
    }
    return set;
  }

  selectHydrogens() {
    const set = new Set();
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      if (atoms[i].element === 'H') set.add(i);
    }
    return set;
  }

  selectMetals() {
    const set = new Set();
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      if (METAL_ELEMENTS.has(atoms[i].element)) set.add(i);
    }
    return set;
  }

  selectPepseq() {
    const t = this.peek();
    if (t.type !== T_WORD) throw new Error('Expected sequence after "pepseq"');
    const target = this.advance().value.toUpperCase();
    const { residues, chains } = this.model;
    const result = new Set();
    for (const chain of chains) {
      const chainRes = [];
      for (let ri = chain.residueStart; ri < chain.residueEnd; ri++) {
        if (residues[ri].isStandard) chainRes.push(ri);
      }
      const seq = chainRes.map(ri => residues[ri].oneLetterCode).join('');
      let pos = 0;
      while ((pos = seq.indexOf(target, pos)) !== -1) {
        for (let k = pos; k < pos + target.length; k++) {
          const res = residues[chainRes[k]];
          for (let j = res.atomStart; j < res.atomEnd; j++) result.add(j);
        }
        pos++;
      }
    }
    return result;
  }

  selectBFactor() {
    const t = this.peek();
    if (t.type !== T_COMP) throw new Error('Expected comparison (>, <, >=, <=, =) after "b"');
    const op = this.advance().value;
    let value;
    if (this.peek().type === T_DASH) {
      this.advance();
      value = -this.expect(T_NUMBER).value;
    } else {
      value = this.expect(T_NUMBER).value;
    }
    const { bFactors, atomCount } = this.model;
    const set = new Set();
    for (let i = 0; i < atomCount; i++) {
      const v = bFactors[i];
      if ((op === '>' && v > value) || (op === '<' && v < value) ||
          (op === '>=' && v >= value) || (op === '<=' && v <= value) ||
          (op === '=' && v === value)) {
        set.add(i);
      }
    }
    return set;
  }

  _getAdjacency() {
    if (this._adjacency) return this._adjacency;
    if (!this.bonds) return null;
    const adj = new Map();
    for (let i = 0; i < this.bonds.length; i += 2) {
      const a = this.bonds[i], b = this.bonds[i + 1];
      if (!adj.has(a)) adj.set(a, []);
      if (!adj.has(b)) adj.set(b, []);
      adj.get(a).push(b);
      adj.get(b).push(a);
    }
    this._adjacency = adj;
    return adj;
  }

  selectNeighbor(innerSet) {
    const adj = this._getAdjacency();
    if (!adj) throw new Error('Bond data not available for neighbor selection');
    const result = new Set();
    for (const idx of innerSet) {
      const neighbors = adj.get(idx);
      if (neighbors) {
        for (const n of neighbors) {
          if (!innerSet.has(n)) result.add(n);
        }
      }
    }
    return result;
  }

  selectIndex() {
    const ranges = this.parseRanges();
    const set = new Set();
    const { atomCount } = this.model;
    for (const r of ranges) {
      for (let i = Math.max(0, r.start); i <= r.end && i < atomCount; i++) {
        set.add(i);
      }
    }
    return set;
  }

  selectId() {
    const ranges = this.parseRanges();
    const set = new Set();
    const { atoms } = this.model;
    for (let i = 0; i < atoms.length; i++) {
      const serial = atoms[i].serial;
      for (const r of ranges) {
        if (serial >= r.start && serial <= r.end) {
          set.add(i);
          break;
        }
      }
    }
    return set;
  }

  selectModel() {
    const t = this.peek();
    if (t.type !== T_WORD) throw new Error('Expected model name after "model"');
    const name = this.advance().value.toLowerCase();
    const ranges = this.model._structureRanges;
    if (!ranges) throw new Error('No structure ranges available (single structure loaded?)');
    const range = ranges.get(name);
    if (!range) {
      const available = [...ranges.keys()].join(', ');
      throw new Error(`Model "${name}" not found. Available: ${available}`);
    }
    const set = new Set();
    for (let i = range.atomOffset; i < range.atomOffset + range.atomCount; i++) {
      set.add(i);
    }
    return set;
  }

  // Select all atoms within `distance` angstroms of any atom in targetSet
  selectWithin(distance, targetSet) {
    const { positions, atomCount } = this.model;
    const distSq = distance * distance;
    const result = new Set(targetSet); // target atoms are within distance 0 of themselves

    // Flat array of target positions for fast iteration
    const tp = new Float32Array(targetSet.size * 3);
    let k = 0;
    for (const idx of targetSet) {
      tp[k++] = positions[idx * 3];
      tp[k++] = positions[idx * 3 + 1];
      tp[k++] = positions[idx * 3 + 2];
    }

    for (let i = 0; i < atomCount; i++) {
      if (result.has(i)) continue;
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      for (let j = 0; j < tp.length; j += 3) {
        const dx = x - tp[j], dy = y - tp[j + 1], dz = z - tp[j + 2];
        if (dx * dx + dy * dy + dz * dz <= distSq) {
          result.add(i);
          break;
        }
      }
    }
    return result;
  }

  // Expand selection to full residues
  expandByResidue(atomSet) {
    const { residues } = this.model;
    const result = new Set();
    for (const res of residues) {
      let hasAny = false;
      for (let j = res.atomStart; j < res.atomEnd; j++) {
        if (atomSet.has(j)) { hasAny = true; break; }
      }
      if (hasAny) {
        for (let j = res.atomStart; j < res.atomEnd; j++) result.add(j);
      }
    }
    return result;
  }
}

// ---- Set operations ----
function union(a, b) {
  const result = new Set(a);
  for (const v of b) result.add(v);
  return result;
}

function intersection(a, b) {
  const result = new Set();
  for (const v of a) {
    if (b.has(v)) result.add(v);
  }
  return result;
}

function complement(set, totalCount) {
  const result = new Set();
  for (let i = 0; i < totalCount; i++) {
    if (!set.has(i)) result.add(i);
  }
  return result;
}

function allAtoms(count) {
  const set = new Set();
  for (let i = 0; i < count; i++) set.add(i);
  return set;
}

// ---- Public API ----

/**
 * Parse a PyMOL-style selection string into a set of atom indices.
 *
 * @param {string} str - Selection expression (e.g. "chain A and resi 1-10")
 * @param {Object} model - Parsed PDB model from parser.js
 * @param {Map<string, Set<number>>} [namedSelections] - Named selection store
 * @param {Uint32Array} [bonds] - Bond pairs for neighbor/bound_to selections
 * @returns {Set<number>} Set of matching atom indices
 */
export function parseSelection(str, model, namedSelections, bonds) {
  const trimmed = str.trim();
  if (!trimmed) return new Set();

  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens, model, namedSelections, bonds);
  const result = parser.parseExpr();

  // Ensure we consumed everything (or just EOF remains)
  const remaining = parser.peek();
  if (remaining.type !== T_EOF) {
    throw new Error(`Unexpected token after expression: "${remaining.value}"`);
  }

  return result;
}

/**
 * Create a new named selection store.
 * @returns {Map<string, Set<number>>}
 */
export function createSelectionStore() {
  return new Map();
}
