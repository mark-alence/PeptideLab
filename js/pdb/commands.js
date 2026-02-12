// ============================================================
// commands.js — PyMOL-style command interpreter
// Parses command lines, dispatches to handlers.
// ============================================================

import { parseSelection, createSelectionStore } from './selection.js';
import { REP_TYPES } from './constants.js';

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

  function sel(str) {
    const model = getModel();
    if (!model) throw new Error('No structure loaded');
    return parseSelection(str, model, namedSelections);
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

    help() {
      return [
        'Commands:',
        '  select <name>, <sel>  Store named selection',
        '  color <color>, <sel>  Color atoms (default: all)',
        '  show <sel>            Unhide atoms (default: all)',
        '  hide <sel>            Hide atoms',
        '  zoom <sel>            Fit camera to selection',
        '  center <sel>          Orbit around selection centroid',
        '  reset                 Reset all',
        '  bg_color <color>      Set background color',
        '  count_atoms <sel>     Count atoms in selection',
        '  selections / ls       List named selections',
        '  delete <name>         Delete named selection',
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
        '  all / none            All or no atoms',
        '',
        'Boolean operators:',
        '  and, or, not          Combine selections',
        '  ( )                   Group expressions',
        '  byres <sel>           Expand to full residues',
        '',
        'Colors: red green blue cyan magenta yellow white orange',
        '  pink salmon slate gray wheat violet marine olive teal',
        '  forest firebrick chocolate black, or "atomic"',
      ].join('\n');
    },
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

  return { execute, namedSelections };
}

function parseHexColor(str) {
  let s = str.trim();
  if (s.startsWith('#')) s = s.substring(1);
  else if (s.startsWith('0x') || s.startsWith('0X')) s = s.substring(2);
  if (/^[0-9a-fA-F]{6}$/.test(s)) return parseInt(s, 16);
  return null;
}
