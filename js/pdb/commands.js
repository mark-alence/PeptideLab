// ============================================================
// commands.js — PyMOL-style command interpreter
// Parses command lines, dispatches to handlers.
// ============================================================

import { parseSelection, createSelectionStore } from './selection.js';
import { findBondsBetween } from './bondInference.js';
import { REP_TYPES, ELEMENT_COLORS, DEFAULT_COLOR } from './constants.js';
import { SS_HELIX, SS_SHEET } from './parser.js';
import { INTERACTION_TYPES, detectHBonds, detectSaltBridges, detectCovalent, detectDistance } from './interactionDetector.js';
import { kabschAlign, pairCAAtoms, applyTransform } from './kabsch.js';
import { GameEvents } from '../ui.js';

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
  lines:          REP_TYPES.LINES,
  line:           REP_TYPES.LINES,
  wireframe:      REP_TYPES.LINES,
  wire:           REP_TYPES.LINES,
};

// All PyMOL representation names (including unsupported ones) so show/hide
// can recognize and strip them rather than passing them to the selection parser
const ALL_REP_NAMES = new Set([
  ...Object.keys(REP_ALIASES),
  'lines', 'dots', 'mesh', 'surface', 'nb_spheres', 'cell',
  'nonbonded', 'wire', 'everything', 'label', 'extent',
  'slice', 'dashes', 'putty',
]);

// Interaction type aliases (command name -> INTERACTION_TYPES value)
const CONTACT_TYPE_ALIASES = {
  hbond:        INTERACTION_TYPES.HBONDS,
  hbonds:       INTERACTION_TYPES.HBONDS,
  hydrogen:     INTERACTION_TYPES.HBONDS,
  h_bonds:      INTERACTION_TYPES.HBONDS,
  salt:         INTERACTION_TYPES.SALT_BRIDGES,
  saltbridge:   INTERACTION_TYPES.SALT_BRIDGES,
  saltbridges:  INTERACTION_TYPES.SALT_BRIDGES,
  salt_bridge:  INTERACTION_TYPES.SALT_BRIDGES,
  salt_bridges: INTERACTION_TYPES.SALT_BRIDGES,
  covalent:     INTERACTION_TYPES.COVALENT,
  cov:          INTERACTION_TYPES.COVALENT,
  distance:     INTERACTION_TYPES.DISTANCE,
  dist:         INTERACTION_TYPES.DISTANCE,
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

  /** Format an atom index as RES:SEQ:NAME label */
  function atomLabel(model, idx) {
    const a = model.atoms[idx];
    return `${a.resName}:${a.resSeq}:${a.name}`;
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
      // Handle PyMOL-style "show <representation>, <selection>"
      let repName = null, selStr = args;
      if (args) {
        const [first, rest] = splitComma(args);
        if (ALL_REP_NAMES.has(first.toLowerCase())) {
          repName = first.toLowerCase();
          selStr = rest || '';
        }
      }
      const indices = selStr ? sel(selStr) : sel('all');
      if (repName) {
        const repType = REP_ALIASES[repName];
        if (repType) {
          // Mark atoms visible without intermediate sync —
          // setRepresentationForAtoms will do the definitive sync
          for (const i of indices) viewer.atomVisible[i] = 1;
          viewer.setRepresentationForAtoms(repType, indices);
          if (_onRepChanged) _onRepChanged(viewer.getRepresentation());
          return `Showing ${indices.size} atoms as ${repName}`;
        }
      }
      viewer.showAtoms(indices);
      viewer.recenterOnVisible();
      return `Showing ${indices.size} atoms`;
    },

    hide(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';
      // Handle PyMOL-style "hide <representation>, <selection>"
      let repName = null, selStr = args;
      if (args) {
        const [first, rest] = splitComma(args);
        if (ALL_REP_NAMES.has(first.toLowerCase())) {
          repName = first.toLowerCase();
          selStr = rest || '';
        }
      }

      // "hide everything" — hide all atoms (PyMOL: hide all representations)
      if (repName === 'everything') {
        const indices = selStr ? sel(selStr) : sel('all');
        viewer.hideAtoms(indices);
        viewer.recenterOnVisible();
        return `Hid ${indices.size} atoms`;
      }

      if (repName && !selStr) {
        // "hide lines" / "hide cartoon" with no selection:
        // only hide atoms currently shown in that representation
        const repType = REP_ALIASES[repName];
        if (repType && viewer.atomRepType) {
          const indices = new Set();
          for (let i = 0; i < viewer.atomRepType.length; i++) {
            if (viewer.atomRepType[i] === repType) indices.add(i);
          }
          if (indices.size === 0) return `No atoms currently shown as ${repName}`;
          viewer.hideAtoms(indices);
          viewer.recenterOnVisible();
          return `Hid ${indices.size} atoms shown as ${repName}`;
        }
        // Unrecognized rep alias (e.g. "dots", "mesh") — no-op
        return `Representation "${repName}" not supported`;
      }

      const indices = selStr ? sel(selStr) : sel('all');
      viewer.hideAtoms(indices);
      viewer.recenterOnVisible();
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
      if (!args) {
        const available = Object.keys(REP_ALIASES).join(', ');
        return `Usage: represent <name>\n  Current: ${viewer.getRepresentation()}\n  Available: ${available}`;
      }
      // Handle PyMOL-style "represent <mode>" — global representation switch
      const [modeName] = splitComma(args);
      const mode = modeName.trim().toLowerCase();
      const repType = REP_ALIASES[mode];
      if (!repType) {
        const available = Object.keys(REP_ALIASES).join(', ');
        return `Usage: represent <name>\n  Current: ${viewer.getRepresentation()}\n  Available: ${available}`;
      }
      viewer.setRepresentation(repType);
      if (_onRepChanged) _onRepChanged(repType);
      return `Representation set to ${mode}`;
    },

    // Alias
    rep(args) {
      return commands.represent(args);
    },

    reset() {
      viewer.resetAll();
      namedSelections.clear();
      return 'Reset colors, visibility, scale, camera, contacts, and selections';
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

    lines() {
      viewer.setRepresentation(REP_TYPES.LINES);
      if (_onRepChanged) _onRepChanged(REP_TYPES.LINES);
      return 'Switched to lines (wireframe) representation';
    },

    as(args) {
      if (!args) return 'Usage: as <representation>\nAvailable: cartoon, sticks, spheres, ball_and_stick, lines';
      const repName = args.trim().toLowerCase();
      const repType = REP_ALIASES[repName];
      if (!repType) return `Unknown representation: "${repName}". Available: cartoon, sticks, spheres, ball_and_stick, lines`;
      viewer.setRepresentation(repType);
      if (_onRepChanged) _onRepChanged(repType);
      return `Switched to ${repName} representation`;
    },

    bond(args) {
      // bond <sel1>, <sel2>[, <cutoff>]
      const model = getModel();
      if (!model) return 'No structure loaded';
      if (!args) return 'Usage: bond <sel1>, <sel2>[, <cutoff>]\n  Detect and show bonds between two selections.\n  cutoff: distance in Angstroms (default: covalent radii)';

      const parts = args.split(',').map(s => s.trim());
      if (parts.length < 2) return 'Usage: bond <sel1>, <sel2>[, <cutoff>]';

      const sel1 = sel(parts[0]);
      const sel2 = sel(parts[1]);
      const cutoff = parts[2] ? parseFloat(parts[2]) : null;

      if (sel1.size === 0) return 'First selection matched 0 atoms';
      if (sel2.size === 0) return 'Second selection matched 0 atoms';
      if (cutoff !== null && (isNaN(cutoff) || cutoff <= 0)) return 'Cutoff must be a positive number';

      const newBonds = findBondsBetween(model, sel1, sel2, cutoff);
      if (newBonds.length === 0) {
        const method = cutoff ? `${cutoff} A cutoff` : 'covalent radii';
        return `No bonds found between selections (${method})`;
      }

      const added = viewer.addBonds(newBonds);
      const method = cutoff ? `${cutoff} A cutoff` : 'covalent radii';
      return `Added ${added} bond${added !== 1 ? 's' : ''} between selections (${method})`;
    },

    unbond(args) {
      // unbond <sel1>, <sel2>
      const model = getModel();
      if (!model) return 'No structure loaded';
      if (!args) return 'Usage: unbond <sel1>, <sel2>\n  Remove bonds between two selections.';

      const parts = args.split(',').map(s => s.trim());
      if (parts.length < 2) return 'Usage: unbond <sel1>, <sel2>';

      const sel1 = sel(parts[0]);
      const sel2 = sel(parts[1]);

      if (sel1.size === 0) return 'First selection matched 0 atoms';
      if (sel2.size === 0) return 'Second selection matched 0 atoms';

      const removed = viewer.removeBonds(sel1, sel2);
      if (removed === 0) return 'No bonds found between selections to remove';
      return `Removed ${removed} bond${removed !== 1 ? 's' : ''} between selections`;
    },

    contacts(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';
      if (!args) return 'Usage: contacts <type>, <sel1>, <sel2>[, <cutoff>]\n  contacts list [<type>]\n  contacts clear [<type>]\n  Types: hbonds, salt_bridges, covalent, distance';

      const trimmed = args.trim().toLowerCase();

      // Handle "contacts clear [type]"
      if (trimmed === 'clear') {
        viewer.clearAllInteractions();
        return 'Cleared all interaction overlays';
      }
      if (trimmed.startsWith('clear')) {
        const rest = args.trim().substring(5).trim();
        const typeName = rest.toLowerCase();
        const type = CONTACT_TYPE_ALIASES[typeName];
        if (!type) return `Unknown interaction type: "${rest}". Types: hbonds, salt_bridges, covalent, distance`;
        viewer.removeInteractions(type);
        return `Cleared ${type} overlay`;
      }

      // Handle "contacts list [type]"
      if (trimmed === 'list' || trimmed.startsWith('list ') || trimmed.startsWith('list,')) {
        const rest = trimmed.substring(4).replace(/^[\s,]+/, '');
        if (!rest) {
          // List all active layers
          const overlay = viewer.interactionOverlay;
          if (!overlay || !overlay.hasLayers()) return 'No active interaction overlays';
          const lines = [];
          for (const info of overlay.getLayerInfo()) {
            const pairs = viewer.getInteractionPairs(info.type);
            if (!pairs || pairs.length === 0) continue;
            lines.push(`${info.type} (${pairs.length} pairs):`);
            const sorted = [...pairs].sort((a, b) => a.distance - b.distance);
            const cap = Math.min(sorted.length, 50);
            for (let k = 0; k < cap; k++) {
              const p = sorted[k];
              lines.push(`  ${atomLabel(model, p.a)} \u2014 ${atomLabel(model, p.b)}   ${p.distance.toFixed(2)} A`);
            }
            if (sorted.length > 50) lines.push(`  ... and ${sorted.length - 50} more`);
          }
          return lines.length > 0 ? lines.join('\n') : 'No interaction pairs found';
        }
        // List specific type
        const typeName = rest.toLowerCase();
        const type = CONTACT_TYPE_ALIASES[typeName];
        if (!type) return `Unknown interaction type: "${rest}". Types: hbonds, salt_bridges, covalent, distance`;
        const pairs = viewer.getInteractionPairs(type);
        if (!pairs || pairs.length === 0) return `No ${type} pairs found (run "contacts ${typeName}, <sel1>, <sel2>" first)`;
        const sorted = [...pairs].sort((a, b) => a.distance - b.distance);
        const lines = [`${type} (${sorted.length} pairs):`];
        const cap = Math.min(sorted.length, 50);
        for (let k = 0; k < cap; k++) {
          const p = sorted[k];
          lines.push(`  ${atomLabel(model, p.a)} \u2014 ${atomLabel(model, p.b)}   ${p.distance.toFixed(2)} A`);
        }
        if (sorted.length > 50) lines.push(`  ... and ${sorted.length - 50} more`);
        return lines.join('\n');
      }

      // Parse: <type>, <sel1>, <sel2>[, <cutoff>]
      const parts = args.split(',').map(s => s.trim());
      if (parts.length < 3) return 'Usage: contacts <type>, <sel1>, <sel2>[, <cutoff>]';

      const typeName = parts[0].toLowerCase();
      const type = CONTACT_TYPE_ALIASES[typeName];
      if (!type) return `Unknown interaction type: "${parts[0]}". Types: hbonds, salt_bridges, covalent, distance`;

      const sel1 = sel(parts[1]);
      const sel2 = sel(parts[2]);
      const cutoffStr = parts[3] ? parts[3].trim() : null;

      if (sel1.size === 0) return 'First selection matched 0 atoms';
      if (sel2.size === 0) return 'Second selection matched 0 atoms';

      // Distance type requires a cutoff
      if (type === INTERACTION_TYPES.DISTANCE && !cutoffStr) {
        return 'Distance contacts require a cutoff: contacts distance, <sel1>, <sel2>, <cutoff>';
      }

      const cutoff = cutoffStr ? parseFloat(cutoffStr) : null;
      if (cutoff !== null && (isNaN(cutoff) || cutoff <= 0)) return 'Cutoff must be a positive number';

      let pairs;
      switch (type) {
        case INTERACTION_TYPES.HBONDS:
          pairs = detectHBonds(model, getBonds(), sel1, sel2, cutoff || undefined);
          break;
        case INTERACTION_TYPES.SALT_BRIDGES:
          pairs = detectSaltBridges(model, sel1, sel2, cutoff || undefined);
          break;
        case INTERACTION_TYPES.COVALENT:
          pairs = detectCovalent(model, sel1, sel2);
          break;
        case INTERACTION_TYPES.DISTANCE:
          pairs = detectDistance(model, sel1, sel2, cutoff);
          break;
        default:
          return `Unsupported interaction type: ${type}`;
      }

      if (pairs.length === 0) {
        return `No ${type} found between selections`;
      }

      viewer.addInteractions(type, pairs);
      return `Found ${pairs.length} ${type} between selections`;
    },

    distance(args) {
      const model = getModel();
      if (!model) return 'No structure loaded';
      if (!args) return 'Usage: distance <sel1>, <sel2>\n  Measure distance between two selections.';

      const parts = args.split(',').map(s => s.trim());
      if (parts.length < 2) return 'Usage: distance <sel1>, <sel2>';

      const sel1 = sel(parts[0]);
      const sel2 = sel(parts[1]);

      if (sel1.size === 0) return 'First selection matched 0 atoms';
      if (sel2.size === 0) return 'Second selection matched 0 atoms';

      const { positions } = model;

      let bestI, bestJ, dist;

      // Single atom in each selection — report direct distance
      if (sel1.size === 1 && sel2.size === 1) {
        bestI = sel1.values().next().value;
        bestJ = sel2.values().next().value;
        const dx = positions[bestI * 3] - positions[bestJ * 3];
        const dy = positions[bestI * 3 + 1] - positions[bestJ * 3 + 1];
        const dz = positions[bestI * 3 + 2] - positions[bestJ * 3 + 2];
        dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      } else {
        // Multiple atoms — find minimum distance pair
        let minDist = Infinity;
        bestI = -1; bestJ = -1;
        for (const i of sel1) {
          const ix = positions[i * 3], iy = positions[i * 3 + 1], iz = positions[i * 3 + 2];
          for (const j of sel2) {
            const dx = ix - positions[j * 3];
            const dy = iy - positions[j * 3 + 1];
            const dz = iz - positions[j * 3 + 2];
            const d = dx * dx + dy * dy + dz * dz;
            if (d < minDist) {
              minDist = d;
              bestI = i;
              bestJ = j;
            }
          }
        }
        dist = Math.sqrt(minDist);
      }

      // Visualize the measured pair as a dashed line overlay
      const pair = { a: Math.min(bestI, bestJ), b: Math.max(bestI, bestJ), distance: dist };
      viewer.addInteractions(INTERACTION_TYPES.DISTANCE, [pair]);

      const label = `Distance: ${dist.toFixed(2)} A  (${atomLabel(model, bestI)} \u2014 ${atomLabel(model, bestJ)})`;
      if (sel1.size === 1 && sel2.size === 1) return label;
      return label + `  [min of ${sel1.size}x${sel2.size} pairs]`;
    },

    get_distance(args) {
      return commands.distance(args);
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

    set(args) {
      if (!args) return 'Usage: set <setting>, <value>[, <sel>]\n  Settings: sphere_scale, stick_radius';
      const [setting, rest] = splitComma(args);
      if (!rest) return 'Usage: set <setting>, <value>[, <sel>]';
      const key = setting.trim().toLowerCase();
      if (key === 'sphere_scale' || key === 'stick_radius') {
        const [valStr, selStr] = splitComma(rest);
        const factor = parseFloat(valStr);
        if (isNaN(factor) || factor < 0) return `Usage: set ${key}, <factor>[, <sel>]`;
        const indices = selStr ? sel(selStr) : sel('all');
        viewer.scaleAtoms(indices, factor);
        return `Set ${key} to ${factor} for ${indices.size} atoms`;
      }
      return `Unknown setting: "${key}". Available: sphere_scale, stick_radius`;
    },

    // Multi-structure commands
    load(args) {
      const pdbId = (args || '').trim().toUpperCase();
      if (!pdbId || pdbId.length !== 4) {
        return 'Usage: load <4-char PDB ID> (e.g. load 4HHB)';
      }
      return (async () => {
        const url = `https://files.rcsb.org/download/${pdbId}.pdb`;
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`PDB ID "${pdbId}" not found on RCSB`);
        const pdbText = await resp.text();
        const actualName = viewer.addStructure(pdbText, pdbId);
        if (!actualName) throw new Error(`Failed to parse PDB data for ${pdbId}`);
        const info = viewer.getInfo();
        GameEvents.emit('viewerLoaded', info);
        return `Loaded ${actualName} (${viewer.structureManager.getStructure(actualName).atomCount} atoms)`;
      })();
    },

    fetch(args) {
      return commands.load(args);
    },

    align(args) {
      if (!args) return 'Usage: align <mobile>, <target>';
      const [mobileName, targetName] = splitComma(args);
      if (!mobileName || !targetName) return 'Usage: align <mobile>, <target>';

      const sm = viewer.structureManager;
      const mobileEntry = sm.getStructure(mobileName);
      const targetEntry = sm.getStructure(targetName);

      if (!mobileEntry) return `Structure "${mobileName}" not found. Use "list" to see loaded structures.`;
      if (!targetEntry) return `Structure "${targetName}" not found. Use "list" to see loaded structures.`;

      const { mobileIndices, targetIndices, count } = pairCAAtoms(mobileEntry.model, targetEntry.model);
      if (count < 3) return `Only ${count} matching CA atoms found — need at least 3 for alignment`;

      const mobileXYZ = new Float64Array(count * 3);
      const targetXYZ = new Float64Array(count * 3);
      for (let i = 0; i < count; i++) {
        const mi = mobileIndices[i];
        const ti = targetIndices[i];
        mobileXYZ[i * 3]     = mobileEntry.model.positions[mi * 3];
        mobileXYZ[i * 3 + 1] = mobileEntry.model.positions[mi * 3 + 1];
        mobileXYZ[i * 3 + 2] = mobileEntry.model.positions[mi * 3 + 2];
        targetXYZ[i * 3]     = targetEntry.model.positions[ti * 3];
        targetXYZ[i * 3 + 1] = targetEntry.model.positions[ti * 3 + 1];
        targetXYZ[i * 3 + 2] = targetEntry.model.positions[ti * 3 + 2];
      }

      const { rotation, mobileCenter, targetCenter, rmsd } = kabschAlign(mobileXYZ, targetXYZ, count);
      applyTransform(mobileEntry.model, rotation, mobileCenter, targetCenter);
      viewer._rebuildMergedState();

      return `Aligned ${mobileEntry.name} → ${targetEntry.name} (${count} CA pairs, RMSD: ${rmsd.toFixed(3)} Å)`;
    },

    remove(args) {
      const name = (args || '').trim();
      if (!name) return 'Usage: remove <structure_name>';
      const removed = viewer.removeStructure(name);
      if (!removed) return `Structure "${name}" not found. Use "list" to see loaded structures.`;
      const info = viewer.getInfo();
      if (info) GameEvents.emit('viewerLoaded', info);
      return `Removed structure "${name}"`;
    },

    list() {
      const sm = viewer.structureManager;
      if (sm.count === 0) return 'No structures loaded';
      const lines = ['Loaded structures:'];
      for (const entry of sm._orderedEntries()) {
        const colorStr = entry.color ? `#${entry.color.getHexString()}` : 'element colors';
        const chainIds = [...new Set(entry.model.chains.map(c => c.id))].join(',');
        lines.push(`  ${entry.name}: ${entry.atomCount} atoms, chains: ${chainIds}, color: ${colorStr}`);
      }
      return lines.join('\n');
    },

    help() {
      return [
        'Commands:',
        '  select <name>, <sel>  Store named selection',
        '  color <color>, <sel>  Color atoms (default: all)',
        '  show [rep,] <sel>     Show atoms; if rep given, assign that representation',
        '  hide <sel>            Hide atoms',
        '  represent <mode>      cartoon | sticks | spheres | ball_and_stick (alias: rep)',
        '  zoom <sel>            Fit camera to selection',
        '  center <sel>          Orbit around selection centroid',
        '  orient <sel>          Orient for best view of selection',
        '  turn <axis>, <angle>  Rotate view (x/y/z, degrees)',
        '  reset                 Reset all',
        '  bg_color <color>      Set background color',
        '  count_atoms <sel>     Count atoms in selection',
        '  selections / ls       List named selections',
        '  delete <name>         Delete named selection',
        '  bond <s1>, <s2>[, cut]  Add bonds between selections (covalent radii or cutoff)',
        '  unbond <s1>, <s2>     Remove bonds between selections',
        '  contacts <type>, <s1>, <s2>[, cut]  Show interaction overlay (hbonds/salt_bridges/covalent/distance)',
        '  contacts list [type]  List individual interaction distances',
        '  contacts clear [type] Clear interaction overlays',
        '  distance <s1>, <s2>   Measure distance between selections (alias: get_distance)',
        '  set <key>, <val>[, <sel>]  Set property (sphere_scale, stick_radius)',
        '  spectrum <p>, <pal>, <sel>  Gradient color (p: count/b/chain)',
        '  set_color <name>, [r,g,b]  Define custom color',
        '  util.cbc <sel>        Color by chain (distinct colors)',
        '  util.ss <sel>         Color by secondary structure',
        '',
        'Multi-structure:',
        '  load <PDB_ID>         Fetch & add structure from RCSB',
        '  align <mob>, <tgt>    Superpose mobile onto target (Kabsch on CAs)',
        '  remove <name>         Remove a loaded structure',
        '  list                  List all loaded structures',
        '',
        'Representations:',
        '  as <name>             Switch representation mode',
        '  cartoon               Cartoon ribbon',
        '  sticks                Stick model',
        '  spheres               Spacefill (CPK)',
        '  ball_and_stick        Ball-and-stick (default)',
        '  lines                 Wireframe (bonds only)',
        '',
        'Selection syntax:',
        '  chain A               Chain ID',
        '  resi 1-10             Residue numbers (ranges: 1-10+20+30-40)',
        '  resn ALA+GLY          Residue names',
        '  name CA+CB            Atom names',
        '  elem C+N              Element symbols',
        '  ss H+S                Secondary structure (H=helix, S=sheet)',
        '  model 1CRN            Select atoms from a specific structure',
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
        '  within 4.0 of <sel>   Atoms within distance (includes sel). Goes BEFORE target:',
        '                         e.g. "chain A and within 4.0 of chain B"',
        '  around 4.0 of <sel>   Like within but excludes the target selection',
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
      const result = handler(parsed.args);
      // If the handler returns a Promise (e.g. load command), wrap errors
      if (result && typeof result.then === 'function') {
        return result.catch(e => `Error: ${e.message}`);
      }
      return result;
    } catch (e) {
      return `Error: ${e.message}`;
    }
  }

  function getStructureManager() {
    return viewer.structureManager;
  }

  // ---- Visual state summary helpers ----

  function summarizeRepresentation() {
    const model = getModel();
    if (!model || !viewer.atomRepType || !viewer.atomVisible) return null;

    const repCounts = {};
    let hiddenCount = 0;

    for (let i = 0; i < model.atomCount; i++) {
      if (!viewer.atomVisible[i]) {
        hiddenCount++;
        continue;
      }
      const rep = viewer.atomRepType[i];
      repCounts[rep] = (repCounts[rep] || 0) + 1;
    }

    // Default: all visible, all ball_and_stick
    const repKeys = Object.keys(repCounts);
    if (hiddenCount === 0 && repKeys.length === 1 && repKeys[0] === REP_TYPES.BALL_AND_STICK) {
      return null;
    }

    if (repKeys.length === 0) return 'Rep: all hidden';

    const repStr = 'Rep: ' + Object.entries(repCounts).map(([r, c]) => `${r}(${c})`).join(', ');
    return hiddenCount > 0 ? repStr + `, hidden:${hiddenCount}` : repStr;
  }

  function summarizeVisibility() {
    const model = getModel();
    if (!model || !viewer.atomVisible) return null;

    const { atoms } = model;
    const hiddenByChain = {};
    const totalByChain = {};

    for (let i = 0; i < model.atomCount; i++) {
      const chain = atoms[i].chainId;
      totalByChain[chain] = (totalByChain[chain] || 0) + 1;
      if (!viewer.atomVisible[i]) {
        hiddenByChain[chain] = (hiddenByChain[chain] || 0) + 1;
      }
    }

    const parts = [];
    for (const chain of Object.keys(totalByChain)) {
      const hidden = hiddenByChain[chain] || 0;
      if (hidden === 0) continue;
      if (hidden === totalByChain[chain]) {
        parts.push(`${chain}:hidden`);
      } else {
        parts.push(`${chain}:${hidden}/${totalByChain[chain]} hidden`);
      }
    }

    return parts.length > 0 ? 'Visibility: ' + parts.join(', ') : null;
  }

  function summarizeColors() {
    const model = getModel();
    if (!model || !viewer.atomColors) return null;

    const { atoms } = model;
    const chainInfo = {}; // chainId -> { allDefault, colors: Set<hex> }

    for (let i = 0; i < model.atomCount; i++) {
      if (!viewer.atomVisible[i]) continue;
      const chain = atoms[i].chainId;
      if (!chainInfo[chain]) chainInfo[chain] = { allDefault: true, colors: new Set() };

      const currentHex = viewer.atomColors[i].getHex();
      const expectedHex = ELEMENT_COLORS[atoms[i].element] || DEFAULT_COLOR;

      chainInfo[chain].colors.add(currentHex);
      if (currentHex !== expectedHex) {
        chainInfo[chain].allDefault = false;
      }
    }

    const parts = [];
    for (const [chainId, info] of Object.entries(chainInfo)) {
      if (info.allDefault) continue;
      if (info.colors.size === 1) {
        const hex = [...info.colors][0];
        parts.push(`${chainId}:#${hex.toString(16).padStart(6, '0')}`);
      } else {
        parts.push(`${chainId}:mixed`);
      }
    }

    return parts.length > 0 ? 'Colors: ' + parts.join(', ') : null;
  }

  function summarizeInteractions() {
    if (!viewer.interactionOverlay) return null;
    const layers = viewer.interactionOverlay.getLayerInfo();
    if (!layers || layers.length === 0) return null;

    const parts = layers.map(l => `${l.type}(${l.count})`);
    return 'Contacts: ' + parts.join(', ');
  }

  function summarizeSelections() {
    if (namedSelections.size === 0) return null;
    const parts = [];
    for (const [name, set] of namedSelections) {
      parts.push(`${name}(${set.size})`);
    }
    return 'Selections: ' + parts.join(', ');
  }

  function summarizeScale() {
    const model = getModel();
    if (!model || !viewer.atomScale) return null;

    let hasNonDefault = false;
    let minScale = Infinity, maxScale = -Infinity;

    for (let i = 0; i < model.atomCount; i++) {
      const s = viewer.atomScale[i];
      if (s !== 1.0) {
        hasNonDefault = true;
        if (s < minScale) minScale = s;
        if (s > maxScale) maxScale = s;
      }
    }

    if (!hasNonDefault) return null;
    if (minScale === maxScale) return `Scale: ${minScale}`;
    return `Scale: ${minScale}-${maxScale}`;
  }

  function summarizeBackground() {
    const bg = viewer.scene?.background;
    if (!bg || !bg.isColor) return null; // still texture (default gradient)
    return `Background: #${bg.getHex().toString(16).padStart(6, '0')}`;
  }

  function getVisualState() {
    const model = getModel();
    if (!model) return '';

    const parts = [
      summarizeRepresentation(),
      summarizeVisibility(),
      summarizeColors(),
      summarizeInteractions(),
      summarizeSelections(),
      summarizeScale(),
      summarizeBackground(),
    ].filter(Boolean);

    return parts.length > 0 ? parts.join('\n') : '';
  }

  return { execute, namedSelections, getModel, getBonds, getStructureManager, getVisualState };
}

function parseHexColor(str) {
  let s = str.trim();
  if (s.startsWith('#')) s = s.substring(1);
  else if (s.startsWith('0x') || s.startsWith('0X')) s = s.substring(2);
  if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16);
  return null;
}
