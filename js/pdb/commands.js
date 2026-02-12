// ============================================================
// commands.js — PyMOL-style command interpreter
// Parses command lines, dispatches to handlers.
// ============================================================

import { parseSelection, createSelectionStore } from './selection.js';
import { REP_TYPES } from './constants.js';
import { SS_HELIX, SS_SHEET } from './parser.js';

// Callback for notifying UI when representation changes from console
let _onRepChanged = null;
export function setRepChangedCallback(fn) { _onRepChanged = fn; }

// Representation name aliases (command name -> REP_TYPES value)
const REP_ALIASES = {
  ball_and_stick: REP_TYPES.BALL_AND_STICK,
  ballandstick:   REP_TYPES.BALL_AND_STICK,
  bas:            REP_TYPES.BALL_AND_STICK,
  spacefill:      REP_TYPES.SPACEFILL,
  spheres:        REP_TYPES.SPACEFILL,
  cpk:            REP_TYPES.SPACEFILL,
  sticks:         REP_TYPES.STICK,
  stick:          REP_TYPES.STICK,
  licorice:       REP_TYPES.STICK,
  cartoon:        REP_TYPES.CARTOON,
  ribbon:         REP_TYPES.CARTOON,
};

// ---- Color interpolation for spectrum command ----

const PALETTES = {
  rainbow: [[0, 0x0000FF], [0.25, 0x00FFFF], [0.5, 0x00FF00], [0.75, 0xFFFF00], [1, 0xFF0000]],
  blue_white_red: [[0, 0x0000FF], [0.5, 0xFFFFFF], [1, 0xFF0000]],
  red_white_blue: [[0, 0xFF0000], [0.5, 0xFFFFFF], [1, 0x0000FF]],
  blue_red: [[0, 0x0000FF], [1, 0xFF0000]],
  green_white_magenta: [[0, 0x00FF00], [0.5, 0xFFFFFF], [1, 0xFF00FF]],
  yellow_cyan_white: [[0, 0xFFFF00], [0.5, 0x00FFFF], [1, 0xFFFFFF]],
};

function interpolateColor(t, stops) {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < stops.length - 1; i++) {
    if (t <= stops[i + 1][0]) {
      const range = stops[i + 1][0] - stops[i][0];
      const f = range > 0 ? (t - stops[i][0]) / range : 0;
      const c1 = stops[i][1], c2 = stops[i + 1][1];
      const r = Math.round(((c1 >> 16) & 0xFF) * (1 - f) + ((c2 >> 16) & 0xFF) * f);
      const g = Math.round(((c1 >> 8) & 0xFF) * (1 - f) + ((c2 >> 8) & 0xFF) * f);
      const b = Math.round((c1 & 0xFF) * (1 - f) + (c2 & 0xFF) * f);
      return (r << 16) | (g << 8) | b;
    }
  }
  return stops[stops.length - 1][1];
}

// Distinct colors for util.cbc (color by chain)
const CHAIN_COLORS = [
  0x00FF00, 0x00FFFF, 0xFF00FF, 0xFFFF00, 0xFF8C00,
  0x00CED1, 0xFF69B4, 0x7B68EE, 0x32CD32, 0xFF6347,
  0x4169E1, 0xDDA0DD, 0x20B2AA, 0xFFA500, 0x778899,
];

// PyMOL color palette
const COLOR_NAMES = {
  red:        0xFF0000,
  green:      0x00FF00,
  blue:       0x0000FF,
  cyan:       0x00FFFF,
  magenta:    0xFF00FF,
  yellow:     0xFFFF00,
  white:      0xFFFFFF,
  orange:     0xFF8C00,
  pink:       0xFF69B4,
  salmon:     0xFA8072,
  slate:      0x708090,
  gray:       0x808080,
  grey:       0x808080,
  wheat:      0xF5DEB3,
  violet:     0xEE82EE,
  marine:     0x0000CD,
  olive:      0x808000,
  teal:       0x008080,
  forest:     0x228B22,
  firebrick:  0xB22222,
  chocolate:  0xD2691E,
  black:      0x000000,
  lime:       0x00FF00,
  purple:     0x800080,
  gold:       0xFFD700,
  hotpink:    0xFF69B4,
  skyblue:    0x87CEEB,
  lightblue:  0xADD8E6,
  deepblue:   0x00008B,
  carbon:     0x33FF33,
  nitrogen:   0x3333FF,
  oxygen:     0xFF4444,
  sulfur:     0xFFFF33,
};

/**
 * Create a command interpreter bound to a PDBViewer instance.
 *
 * @param {PDBViewer} viewer - The viewer instance
 * @returns {{ execute: (line: string) => string|null, namedSelections: Map }}
 */
export function createCommandInterpreter(viewer) {
  const namedSelections = createSelectionStore();

  function getModel() {
    return viewer.model;
  }

  function getBonds() {
    return viewer.bonds;
  }

  function sel(str) {
    const model = getModel();
    if (!model) throw new Error('No structure loaded');
    return parseSelection(str, model, namedSelections, getBonds());
  }

  // Split "color red, chain A" into ["color", "red, chain A"]
  // Split "hide chain A" into ["hide", "chain A"]
  function parseCommand(line) {
    const trimmed = line.trim();
    if (!trimmed) return null;

    const spaceIdx = trimmed.indexOf(' ');
    if (spaceIdx === -1) return { cmd: trimmed.toLowerCase(), args: '' };

    const cmd = trimmed.substring(0, spaceIdx).toLowerCase();
    const args = trimmed.substring(spaceIdx + 1).trim();
    return { cmd, args };
  }

  // Split args on first comma: "red, chain A" -> ["red", "chain A"]
  function splitComma(args) {
    const idx = args.indexOf(',');
    if (idx === -1) return [args.trim(), ''];
    return [args.substring(0, idx).trim(), args.substring(idx + 1).trim()];
  }

  const commands = {
    select(args) {
      // select name, selection
      const [name, selStr] = splitComma(args);
      if (!name) return 'Usage: select <name>, <selection>';
      if (!selStr) return 'Usage: select <name>, <selection>';
      const result = sel(selStr);
      namedSelections.set(name.toLowerCase(), result);
      return `Selection "${name}" created with ${result.size} atoms`;
    },

    color(args) {
      const [colorName, selStr] = splitComma(args);
      if (!colorName) return 'Usage: color <color>, [selection]';

      const model = getModel();
      if (!model) return 'No structure loaded';

      const indices = selStr ? sel(selStr) : sel('all');

      if (colorName.toLowerCase() === 'atomic') {
        viewer.resetColorsForAtoms(indices);
        return `Reset ${indices.size} atoms to element colors`;
      }

      const hex = COLOR_NAMES[colorName.toLowerCase()];
      if (hex === undefined) {
        // Try parsing as hex: 0xRRGGBB or #RRGGBB
        const parsed = parseHexColor(colorName);
        if (parsed === null) return `Unknown color: "${colorName}". Use "help" to see available colors.`;
        viewer.colorAtoms(indices, parsed);
        return `Colored ${indices.size} atoms`;
      }

      viewer.colorAtoms(indices, hex);
      return `Colored ${indices.size} atoms ${colorName}`;
    },

    show(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';
      const indices = args ? sel(args) : sel('all');
      viewer.showAtoms(indices);
      return `Showing ${indices.size} atoms`;
    },

    hide(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';
      const indices = args ? sel(args) : sel('all');
      viewer.hideAtoms(indices);
      return `Hid ${indices.size} atoms`;
    },

    zoom(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';
      const indices = args ? sel(args) : sel('all');
      if (indices.size === 0) return 'No atoms in selection';
      viewer.zoomToAtoms(indices);
      return `Zoomed to ${indices.size} atoms`;
    },

    center(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';
      const indices = args ? sel(args) : sel('all');
      if (indices.size === 0) return 'No atoms in selection';
      viewer.centerOnAtoms(indices);
      return `Centered on ${indices.size} atoms`;
    },

    represent(args) {
      const mode = (args || '').trim().toLowerCase();
      const valid = ['spheres', 'sticks', 'lines'];
      if (!valid.includes(mode)) {
        return `Usage: represent <${valid.join('|')}>\n  Current: ${viewer.getRepresentation()}`;
      }
      viewer.setRepresentation(mode);
      return `Representation set to ${mode}`;
    },

    // Alias
    rep(args) {
      return commands.represent(args);
    },

    reset() {
      viewer.resetAll();
      namedSelections.clear();
      return 'Reset colors, visibility, camera, and selections';
    },

    bg_color(args) {
      if (!args) return 'Usage: bg_color <color>';
      const colorName = args.trim().toLowerCase();
      let hex = COLOR_NAMES[colorName];
      if (hex === undefined) {
        hex = parseHexColor(args.trim());
        if (hex === null) return `Unknown color: "${args}"`;
      }
      viewer.setBackground(hex);
      return `Background set to ${colorName || args}`;
    },

    count_atoms(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';
      const indices = args ? sel(args) : sel('all');
      return `count_atoms: ${indices.size}`;
    },

    selections() {
      if (namedSelections.size === 0) return 'No named selections';
      const lines = [];
      for (const [name, set] of namedSelections) {
        lines.push(`  ${name}: ${set.size} atoms`);
      }
      return 'Named selections:\n' + lines.join('\n');
    },

    ls() {
      return commands.selections();
    },

    delete(args) {
      const name = args.trim().toLowerCase();
      if (!name) return 'Usage: delete <name>';
      if (name === 'all') {
        namedSelections.clear();
        return 'Deleted all named selections';
      }
      if (namedSelections.has(name)) {
        namedSelections.delete(name);
        return `Deleted selection "${name}"`;
      }
      return `Selection "${name}" not found`;
    },

    // Representation commands
    cartoon() {
      viewer.setRepresentation(REP_TYPES.CARTOON);
      if (_onRepChanged) _onRepChanged(REP_TYPES.CARTOON);
      return 'Switched to cartoon representation';
    },

    sticks() {
      viewer.setRepresentation(REP_TYPES.STICK);
      if (_onRepChanged) _onRepChanged(REP_TYPES.STICK);
      return 'Switched to sticks representation';
    },

    spheres() {
      viewer.setRepresentation(REP_TYPES.SPACEFILL);
      if (_onRepChanged) _onRepChanged(REP_TYPES.SPACEFILL);
      return 'Switched to spacefill representation';
    },

    ball_and_stick() {
      viewer.setRepresentation(REP_TYPES.BALL_AND_STICK);
      if (_onRepChanged) _onRepChanged(REP_TYPES.BALL_AND_STICK);
      return 'Switched to ball-and-stick representation';
    },

    as(args) {
      if (!args) return 'Usage: as <representation>\nAvailable: cartoon, sticks, spheres, ball_and_stick';
      const repName = args.trim().toLowerCase();
      const repType = REP_ALIASES[repName];
      if (!repType) return `Unknown representation: "${repName}". Available: cartoon, sticks, spheres, ball_and_stick`;
      viewer.setRepresentation(repType);
      if (_onRepChanged) _onRepChanged(repType);
      return `Switched to ${repName} representation`;
    },

    spectrum(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';

      const parts = args.split(',').map(s => s.trim());
      const property = (parts[0] || 'count').toLowerCase();
      const paletteName = (parts[1] || 'rainbow').toLowerCase();
      const selStr = parts.slice(2).join(',').trim();

      const palette = PALETTES[paletteName];
      if (!palette) return `Unknown palette: "${paletteName}". Available: ${Object.keys(PALETTES).join(', ')}`;

      const indices = selStr ? sel(selStr) : sel('all');
      if (indices.size === 0) return 'No atoms in selection';

      const colorMap = new Map();

      if (property === 'count' || property === 'residue') {
        const { residues } = model;
        const atomToRes = new Int32Array(model.atomCount);
        for (let ri = 0; ri < residues.length; ri++) {
          const res = residues[ri];
          for (let j = res.atomStart; j < res.atomEnd; j++) atomToRes[j] = ri;
        }
        let minR = Infinity, maxR = -Infinity;
        for (const i of indices) {
          if (atomToRes[i] < minR) minR = atomToRes[i];
          if (atomToRes[i] > maxR) maxR = atomToRes[i];
        }
        const range = maxR - minR || 1;
        for (const i of indices) {
          colorMap.set(i, interpolateColor((atomToRes[i] - minR) / range, palette));
        }
      } else if (property === 'b') {
        const { bFactors } = model;
        let minB = Infinity, maxB = -Infinity;
        for (const i of indices) {
          if (bFactors[i] < minB) minB = bFactors[i];
          if (bFactors[i] > maxB) maxB = bFactors[i];
        }
        const range = maxB - minB || 1;
        for (const i of indices) {
          colorMap.set(i, interpolateColor((bFactors[i] - minB) / range, palette));
        }
      } else if (property === 'chain') {
        const { atoms } = model;
        const chainIds = [...new Set(model.chains.map(c => c.id))];
        for (const i of indices) {
          const ci = chainIds.indexOf(atoms[i].chainId);
          const t = chainIds.length > 1 ? ci / (chainIds.length - 1) : 0.5;
          colorMap.set(i, interpolateColor(t, palette));
        }
      } else {
        return `Unknown property: "${property}". Use: count, b, chain`;
      }

      viewer.colorAtomsByMap(colorMap);
      return `Spectrum applied (${property}, ${paletteName}) to ${indices.size} atoms`;
    },

    set_color(args) {
      const [name, rgbStr] = splitComma(args);
      if (!name || !rgbStr) return 'Usage: set_color <name>, [r, g, b]';
      const nums = rgbStr.replace(/[\[\]]/g, '').split(',').map(s => parseFloat(s.trim()));
      if (nums.length !== 3 || nums.some(isNaN)) return 'Usage: set_color <name>, [r, g, b] (values 0-1 or 0-255)';
      let [r, g, b] = nums;
      if (r > 1 || g > 1 || b > 1) {
        r = Math.round(r); g = Math.round(g); b = Math.round(b);
      } else {
        r = Math.round(r * 255); g = Math.round(g * 255); b = Math.round(b * 255);
      }
      const hex = (r << 16) | (g << 8) | b;
      COLOR_NAMES[name.toLowerCase()] = hex;
      return `Color "${name}" defined as #${hex.toString(16).padStart(6, '0')}`;
    },

    orient(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';
      const indices = args ? sel(args) : sel('all');
      if (indices.size === 0) return 'No atoms in selection';
      viewer.orientToAtoms(indices);
      return `Oriented view on ${indices.size} atoms`;
    },

    turn(args) {
      if (!args) return 'Usage: turn <x|y|z>, <angle>';
      const [axisStr, angleStr] = splitComma(args);
      const axis = axisStr.toLowerCase();
      const angle = parseFloat(angleStr);
      if (!['x', 'y', 'z'].includes(axis) || isNaN(angle)) {
        return 'Usage: turn <x|y|z>, <angle>';
      }
      viewer.turnView(axis, angle);
      return `Rotated ${angle}\u00B0 around ${axis} axis`;
    },

    help() {
      return [
        'Commands:',
        '  select <name>, <sel>  Store named selection',
        '  color <color>, <sel>  Color atoms (default: all)',
        '  show <sel>            Unhide atoms (default: all)',
        '  hide <sel>            Hide atoms',
        '  represent <mode>      spheres | sticks | lines (alias: rep)',
        '  zoom <sel>            Fit camera to selection',
        '  center <sel>          Orbit around selection centroid',
        '  orient <sel>          Orient for best view of selection',
        '  turn <axis>, <angle>  Rotate view (x/y/z, degrees)',
        '  reset                 Reset all',
        '  bg_color <color>      Set background color',
        '  count_atoms <sel>     Count atoms in selection',
        '  selections / ls       List named selections',
        '  delete <name>         Delete named selection',
        '  spectrum <p>, <pal>, <sel>  Gradient color (p: count/b/chain)',
        '  set_color <name>, [r,g,b]  Define custom color',
        '  util.cbc <sel>        Color by chain (distinct colors)',
        '  util.ss <sel>         Color by secondary structure',
        '',
        'Representations:',
        '  as <name>             Switch representation mode',
        '  cartoon               Cartoon ribbon',
        '  sticks                Stick model',
        '  spheres               Spacefill (CPK)',
        '  ball_and_stick        Ball-and-stick (default)',
        '',
        'Selection syntax:',
        '  chain A               Chain ID',
        '  resi 1-10             Residue numbers (ranges: 1-10+20+30-40)',
        '  resn ALA+GLY          Residue names',
        '  name CA+CB            Atom names',
        '  elem C+N              Element symbols',
        '  ss H+S                Secondary structure (H=helix, S=sheet)',
        '  backbone / sidechain  Backbone or sidechain atoms',
        '  hetatm / polymer      HETATM or standard residue atoms',
        '  organic / inorganic   Non-polymer molecules (with/without carbon)',
        '  solvent / water       Water molecules',
        '  hydrogens / metals    Hydrogen atoms / metal ions',
        '  pepseq ACDE           Match amino acid sequence',
        '  b > 30 / b < 20      B-factor comparisons (>, <, >=, <=, =)',
        '  neighbor <sel>        Atoms bonded to selection',
        '  index 1-100 / id 1-100  By atom index or PDB serial',
        '  all / none            All or no atoms',
        '',
        'Boolean operators:',
        '  and, or, not          Combine selections',
        '  ( )                   Group expressions',
        '  byres <sel>           Expand to full residues',
        '  within 4.0 of <sel>   Atoms within distance (includes sel)',
        '  around 4.0 of <sel>   Atoms within distance (excludes sel)',
        '',
        'Colors: red green blue cyan magenta yellow white orange',
        '  pink salmon slate gray wheat violet marine olive teal',
        '  forest firebrick chocolate black, or "atomic"',
        'Palettes: rainbow blue_white_red red_white_blue blue_red',
        '  green_white_magenta yellow_cyan_white',
      ].join('\n');
    },
  };

  // util.* commands (dot notation requires bracket access)
  commands['util.cbc'] = function(args) {
    const model = getModel();
    if (!model) return 'No structure loaded';
    const indices = args ? sel(args) : sel('all');
    const { atoms } = model;
    const chainIds = [...new Set(model.chains.map(c => c.id))];
    const colorMap = new Map();
    for (const i of indices) {
      const ci = chainIds.indexOf(atoms[i].chainId);
      colorMap.set(i, CHAIN_COLORS[ci % CHAIN_COLORS.length]);
    }
    viewer.colorAtomsByMap(colorMap);
    return `Colored ${indices.size} atoms by chain (${chainIds.length} chains)`;
  };

  commands['util.chainbow'] = commands['util.cbc'];

  commands['util.ss'] = function(args) {
    const model = getModel();
    if (!model) return 'No structure loaded';
    const indices = args ? sel(args) : sel('all');
    const { residues } = model;
    const SS_COLORS = { [SS_HELIX]: 0xFF0000, [SS_SHEET]: 0xFFFF00 };
    const COIL_COLOR = 0x00FF00;
    const colorMap = new Map();
    for (const res of residues) {
      const hex = SS_COLORS[res.ss] || COIL_COLOR;
      for (let j = res.atomStart; j < res.atomEnd; j++) {
        if (indices.has(j)) colorMap.set(j, hex);
      }
    }
    viewer.colorAtomsByMap(colorMap);
    return `Colored ${indices.size} atoms by secondary structure`;
  };

  function execute(line) {
    const parsed = parseCommand(line);
    if (!parsed) return null;

    const handler = commands[parsed.cmd];
    if (!handler) return `Unknown command: "${parsed.cmd}". Type "help" for available commands.`;

    try {
      return handler(parsed.args);
    } catch (e) {
      return `Error: ${e.message}`;
    }
  }

  return { execute, namedSelections, getModel, getBonds };
}

function parseHexColor(str) {
  let s = str.trim();
  if (s.startsWith('#')) s = s.substring(1);
  else if (s.startsWith('0x') || s.startsWith('0X')) s = s.substring(2);
  if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16);
  return null;
}
