// ============================================================
// selection.js — PyMOL-style selection algebra engine
// Recursive descent parser: pure logic, no DOM/Three.js deps.
//
// Grammar:
//   expr      = or_expr
//   or_expr   = and_expr ("or" and_expr)*
//   and_expr  = not_expr ("and" not_expr)*
//   not_expr  = "not" not_expr | primary
//   primary   = "(" expr ")" | "byres" primary | selector | named_sel
//   selector  = "chain" ids | "resi" ranges | "resn" ids | "name" ids
//             | "elem" ids | "ss" types | "hetatm" | "polymer"
//             | "backbone" | "sidechain" | "all" | "none"
//   ids       = ID ("+" ID)*
//   ranges    = INT ("-" INT)? ("+" INT ("-" INT)?)*
// ============================================================

import { SS_HELIX, SS_SHEET } from './parser.js';

// ---- Token types ----
const T_WORD   = 'WORD';
const T_NUMBER = 'NUMBER';
const T_LPAREN = '(';
const T_RPAREN = ')';
const T_PLUS   = '+';
const T_DASH   = '-';
const T_EOF    = 'EOF';

// Backbone atom names (standard protein backbone)
const BACKBONE_NAMES = new Set(['N', 'CA', 'C', 'O', 'OXT', 'H', 'HA']);

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
    // Number
    if (ch >= '0' && ch <= '9') {
      let num = '';
      while (i < input.length && input[i] >= '0' && input[i] <= '9') { num += input[i]; i++; }
      tokens.push({ type: T_NUMBER, value: parseInt(num) });
      continue;
    }
    // Word (alphanumeric + underscore + *)
    if ((ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z') || ch === '_' || ch === '*') {
      let word = '';
      while (i < input.length && /[A-Za-z0-9_*']/.test(input[i])) { word += input[i]; i++; }
      tokens.push({ type: T_WORD, value: word });
      continue;
    }
    // Skip unknown characters
    i++;
  }
  tokens.push({ type: T_EOF, value: null });
  return tokens;
}

// ---- Parser ----
class Parser {
  constructor(tokens, model, namedSelections) {
    this.tokens = tokens;
    this.pos = 0;
    this.model = model;
    this.named = namedSelections || new Map();
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

  // and_expr = not_expr ("and" not_expr)*
  parseAnd() {
    let left = this.parseNot();
    while (this.matchWord('and')) {
      const right = this.parseNot();
      left = intersection(left, right);
    }
    return left;
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
 * @returns {Set<number>} Set of matching atom indices
 */
export function parseSelection(str, model, namedSelections) {
  const trimmed = str.trim();
  if (!trimmed) return new Set();

  const tokens = tokenize(trimmed);
  const parser = new Parser(tokens, model, namedSelections);
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
