// ============================================================
// aiTranslator.js — Natural language → PyMOL command translator
// Uses Claude's tool-use API in a multi-turn agentic loop so
// the AI can query the loaded structure before generating cmds.
// ============================================================

import { SS_HELIX, SS_SHEET } from './parser.js';
import { parseSelection } from './selection.js';

// ---- Tool schemas (Claude API format) ----

const TOOLS = [
  {
    name: 'get_structure_info',
    description:
      'Get an overview of a loaded protein structure: chains, sequences, secondary structure breakdown, identical chain groups, and ligands/HETATM residues. When multiple structures are loaded, pass structure_name to query a specific one; omit it to get info about the merged view.',
    input_schema: {
      type: 'object',
      properties: {
        structure_name: {
          type: 'string',
          description: 'Name of a specific loaded structure (e.g. "1CRN"). Omit to query the merged model.',
        },
      },
      required: [],
    },
  },
  {
    name: 'list_residues',
    description:
      'List all residues in a specific chain as parallel arrays of residue numbers, residue names (3-letter codes), and secondary structure types. When multiple structures are loaded, pass structure_name to query a specific one; omit it to query the merged model (where chain IDs may collide).',
    input_schema: {
      type: 'object',
      properties: {
        chain_id: {
          type: 'string',
          description: 'Chain identifier (e.g. "A")',
        },
        structure_name: {
          type: 'string',
          description: 'Name of a specific loaded structure (e.g. "1CRN"). Omit to query the merged model.',
        },
      },
      required: ['chain_id'],
    },
  },
  {
    name: 'evaluate_selection',
    description:
      'Test a PyMOL-style selection expression and return whether it is valid and how many atoms it matches. Use this to verify a selection before emitting commands.',
    input_schema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'PyMOL selection expression (e.g. "chain A and resi 1-10")',
        },
      },
      required: ['expression'],
    },
  },
  {
    name: 'update_legend',
    description:
      'Update the viewer legend overlay to describe the current visualization. Call this whenever you change colors, representations, or visibility so the user can understand what they are seeing.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title (e.g. "By Chain", "Secondary Structure")' },
        entries: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              color: { type: 'string', description: 'CSS color string (hex like #FF0000, or name)' },
              label: { type: 'string', description: 'What this color represents' },
            },
            required: ['color', 'label'],
          },
          description: 'Color legend entries (swatch + label pairs)',
        },
        representation: { type: 'string', description: 'Current representation mode if changed (e.g. "Cartoon", "Ball & Stick")' },
      },
      required: ['title', 'entries'],
    },
  },
  {
    name: 'list_structures',
    description:
      'List all currently loaded structures with their names, atom counts, chain IDs, and assigned colors. Use this to see what structures are available for alignment, coloring, or selection.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
];

// ---- Command log formatter ----

function buildCommandLogContext(commandLog) {
  if (!commandLog || commandLog.length === 0) return '';
  // Take last 50 commands to avoid token bloat
  const recent = commandLog.slice(-50);
  const logLines = recent.map(entry => {
    let line = `> ${entry.cmd}`;
    if (entry.result) line += `\n  ${entry.result}`;
    return line;
  });
  return `\n\nConsole command history (most recent last):\n${logLines.join('\n')}`;
}

// ---- System prompt builder ----

function buildSystemPrompt(model, commandLog, interpreter) {
  // Compact structure context so simple requests don't need tool calls
  let structureCtx = '';
  const sm = interpreter?.getStructureManager?.();
  if (sm && sm.count > 1) {
    // Multiple structures: show per-structure summaries
    const parts = [];
    for (const entry of sm._orderedEntries()) {
      const m = entry.model;
      const h = m.header || {};
      const lines = [];
      lines.push(`Structure: ${entry.name}`);
      if (h.pdbId) lines.push(`  PDB ID: ${h.pdbId}`);
      if (h.title) lines.push(`  Title: ${h.title}`);
      if (h.source) lines.push(`  Source organism: ${h.source}`);
      const chainSummaries = m.chains.map(c => {
        const count = c.residueEnd - c.residueStart;
        return `Chain ${c.id}: ${count} residues`;
      });
      lines.push(`  Chains: ${chainSummaries.join(', ')}`);
      lines.push(`  Atoms: ${m.atomCount}`);
      if (entry.color) lines.push(`  Color: #${entry.color.getHexString()}`);
      parts.push(lines.join('\n'));
    }
    structureCtx = `\n\nCurrently loaded structures (${sm.count}):\n${parts.join('\n\n')}`;
  } else if (model) {
    // Single structure: original compact format
    const h = model.header || {};
    const metaLines = [];
    if (h.pdbId) metaLines.push(`PDB ID: ${h.pdbId}`);
    if (h.title) metaLines.push(`Title: ${h.title}`);
    if (h.classification) metaLines.push(`Classification: ${h.classification}`);
    if (h.compound) metaLines.push(`Compound: ${h.compound}`);
    if (h.source) metaLines.push(`Source organism: ${h.source}`);
    if (h.method) metaLines.push(`Method: ${h.method}`);
    if (h.resolution) metaLines.push(`Resolution: ${h.resolution} \u00C5`);
    const chainSummaries = model.chains.map(c => {
      const count = c.residueEnd - c.residueStart;
      return `Chain ${c.id}: ${count} residues`;
    });
    metaLines.push(...chainSummaries);
    metaLines.push(`Total atoms: ${model.atomCount}`);
    structureCtx = `\n\nCurrently loaded structure:\n  ${metaLines.join('\n  ')}`;
  }

  // Build visual state snapshot
  let visualStateCtx = '';
  if (interpreter?.getVisualState) {
    const vs = interpreter.getVisualState();
    if (vs) visualStateCtx = `\n\nCurrent visual state:\n${vs}`;
  }

  return `You are an assistant for a PDB protein viewer with a PyMOL-style console.

You have tools to query the loaded structure(s). Use them when you need specific residue numbers, chain info, or to verify selections. For simple action requests (e.g. "color chain A red"), you can respond directly without tools.

When multiple structures are loaded, use the structure_name parameter on get_structure_info and list_residues to query a specific structure. Without structure_name, these tools query the merged model where chain IDs may collide across structures. Use list_structures to see all loaded structures. Use "model NAME" in selection expressions to target a specific structure.

If the user asks a QUESTION about the structure (e.g. "what chains are there?", "how many helices?"), use tools to look up the answer, then reply with a well-formatted markdown answer. Use headers, bold, lists, code blocks, and tables as appropriate. Do NOT emit commands for questions.

If the user requests an ACTION (e.g. "color even residues blue", "hide chain B"), respond with ONLY commands, one per line — no explanations, no markdown, no code fences. Follow the user's request literally — if they say "hide the rest" or "only show X", do NOT add extra elements (protein backbone, cartoon context, etc.) unless explicitly asked. Show exactly what was requested, nothing more.

CRITICAL: The commands listed below (color, show, hide, represent, zoom, etc.) are CONSOLE TEXT COMMANDS. Emit them as plain text lines in your response. Do NOT call them as tools — they are not tools. Your only callable tools are: get_structure_info, list_residues, evaluate_selection, update_legend, and list_structures.

If a request mentions "bonds" — consider whether the user wants to detect/add new bonds between selections (use the "bond" command) or just change visual representation (use "as sticks" etc.). When the context involves an interface, cross-chain contacts, or specific atom pairs, prefer the "bond" command.

If the user asks about interactions, hydrogen bonds, salt bridges, or contacts between selections, use the "contacts" command. This shows dashed-line overlays on top of any representation and is ideal for visualizing non-covalent interactions at interfaces.

When a request is ambiguous or involves choosing between multiple instances of a residue, ligand, or chain (e.g. "remove the 5MC that is far away"), ALWAYS use tools (list_residues, get_structure_info, evaluate_selection) to identify the specific residue numbers and chains BEFORE emitting commands. Then use direct selection (e.g. "hide resi 6 and chain B") rather than distance-based filtering ("within X of ..."). Distance filters like "within" operate on individual atoms, not whole residues, so they can clip residues in half. Use "byres" if you must filter by distance. If you still can't determine which instance the user means, ask them to clarify rather than guessing.

Available commands:
  select <name>, <sel>   — Store a named selection
  color <color>, <sel>   — Color atoms (default: all). "atomic" resets to element colors
  show [rep,] <sel>      — Show atoms. If rep provided, also switch those atoms to that representation. Different selections can have different representations (e.g., show cartoon, chain A then show sticks, chain B).
  hide [rep,] <sel>      — Hide atoms
  represent <mode>       — spheres | sticks | cartoon | ball_and_stick | lines (alias: rep). Global: switches ALL atoms.
  zoom <sel>             — Fit camera to selection
  center <sel>           — Orbit around selection centroid
  orient <sel>           — Orient camera for best view of selection
  turn <axis>, <angle>   — Rotate view (x/y/z, degrees)
  reset                  — Reset all colors/visibility/camera
  bg_color <color>       — Set background color
  count_atoms <sel>      — Count atoms
  bond <sel1>, <sel2>[, <cutoff>] — Detect and add bonds between two selections. Uses covalent radii by default; optional cutoff in Angstroms overrides. Example: bond chain A, chain B or bond elem ZN, chain A, 2.8
  unbond <sel1>, <sel2>  — Remove bonds between two selections. Example: unbond chain A, chain B
  contacts <type>, <sel1>, <sel2>[, <cutoff>] — Show non-covalent interaction overlay as dashed lines. Types: hbonds (H-bonds, 3.5A default), salt_bridges (charged groups, 4.0A), covalent (radii-based), distance (requires cutoff). Example: contacts hbonds, chain A, chain B
  contacts list [<type>]  — List individual interaction distances from active overlays, sorted by distance. If no type given, lists all. Example: contacts list hbonds
  contacts clear [<type>] — Remove interaction overlays. "contacts clear" removes all; "contacts clear hbonds" removes only H-bonds
  distance <sel1>, <sel2> — Measure distance between two selections. Single atoms: direct distance. Multiple atoms: minimum distance pair. Alias: get_distance. Example: distance name CA and resi 10, name CA and resi 20
  spectrum <prop>, <palette>, <sel> — Gradient coloring. Properties: count (residue index), b (B-factor), chain. Palettes: rainbow, blue_white_red, red_white_blue, blue_red, green_white_magenta, yellow_cyan_white
  set sphere_scale, <value>[, <sel>] — Scale atom sphere radius (multiplier, default all)
  set stick_radius, <value>[, <sel>] — Scale bond cylinder radius (multiplier, default all) (dont use this unless absolutely necessary)
  set_color <name>, [r,g,b] — Define custom color (0-1 float or 0-255 int)
  util.cbc <sel>         — Color by chain (automatic distinct colors)
  util.ss <sel>          — Color by secondary structure (helix=red, sheet=yellow, loop=green)
  load <PDB_ID>          — Fetch and add a structure from RCSB (async)
  align <mobile>, <target> — Superpose mobile structure onto target using Kabsch on CA atoms
  remove <sel>           — Permanently delete atoms matching selection (e.g., remove solvent, remove hydrogens, remove chain B). Also removes a loaded structure by name as fallback.
  list                   — List all loaded structures with atom counts and colors

Selection syntax:
  chain A                — Chain ID
  model 1CRN            — Select atoms from a specific loaded structure
  resi 1-10+20+30-40     — Residue number ranges
  resn ALA+GLY           — Residue names
  name CA+CB             — Atom names
  elem C+N               — Elements
  ss H+S                 — Secondary structure (H=helix, S=sheet)
  backbone / sidechain   — Backbone or sidechain atoms
  hetatm / polymer       — HETATM or standard residues
  organic                — Non-polymer HETATM with carbon (small molecules)
  inorganic              — Non-polymer HETATM without carbon (ions)
  solvent / water        — Water molecules (HOH, WAT, etc.)
  hydrogens              — Hydrogen atoms
  metals                 — Metal ions/atoms
  pepseq ACDE            — Residues matching amino acid sequence substring
  b > 30 / b < 20       — B-factor comparison (>, <, >=, <=, =)
  neighbor <sel>         — Atoms directly bonded to selection
  bound_to <sel>         — Alias for neighbor
  index 1-100            — Select by atom index
  id 1-100               — Select by PDB serial number
  all / none             — All or no atoms
  and, or, not, ( )      — Boolean operators
  byres <sel>            — Expand to full residues
  within 4.0 of <sel>    — Atoms within distance (Å), includes selection. IMPORTANT: "within/around" goes BEFORE the target, not after! Correct: "chain A and within 4.0 of chain B". Wrong: "chain A and chain B around 4.0"
  around 4.0 of <sel>    — Atoms within distance (Å), excludes selection. Same syntax as within.

Colors: red green blue cyan magenta yellow white orange pink salmon slate gray wheat violet marine olive teal forest firebrick chocolate black lime purple gold hotpink skyblue lightblue deepblue carbon nitrogen oxygen sulfur. Also hex: #FF0000 or 0xFF0000.

Color guidelines: Choose colors that are visually distinct from each other — never pair similar shades (e.g. blue/marine/skyblue, or red/salmon/firebrick) in the same visualization. Prefer high-contrast combinations like red+blue, green+magenta, cyan+orange, yellow+purple. Never change the background color (bg_color) unless the user explicitly asks for it.

Visualization principles — follow these like a structural biologist would:

Choosing representations:
  - Cartoon: overall fold, secondary structure, chain topology. Best for proteins >50 residues as the primary view.
  - Sticks: atomic detail for specific residues — active sites, ligand-binding residues, mutations. NOT for an entire large protein.
  - Ball-and-stick: small molecules, ligands, coordination chemistry, bond angles. Good default for non-polymer HETATM.
  - Spacefill: molecular volume, steric bulk, shape complementarity. Use when the question is about size/packing.
  - Lines: minimal context, background, or very large structures where detail is not needed.

Multi-representation scenes (the standard in structural biology):
  Different parts of the structure should often use different representations simultaneously. Use "show <rep>, <sel>" to set per-selection representations. Common patterns:
  - Protein overview: "show cartoon, polymer" then "color gray, polymer" — simple, clean starting point.
  - Ligand binding site: cartoon for protein (muted color like gray or wheat), sticks for ligand + nearby residues, zoom to site.
  - Active site highlight: cartoon for full protein, sticks for catalytic/key residues only.
  - Mutation site: cartoon for context, sticks (or spheres) for mutated residue in a hot color (red, magenta).
  - Multi-chain complex: cartoon for all, then util.cbc for chain distinction.

Focus/context visual hierarchy:
  Apply the 60-30-10 rule — 60% muted context, 30% region of interest, 10% accent highlight.
  - Context (bulk of protein): muted colors — gray, wheat, lightblue, or pale tones. Cartoon or lines.
  - Focus (region of interest): saturated distinct colors. Sticks or ball-and-stick.
  - Accent (ligand, mutation, key residue): bright saturated color. Sticks or spheres.
  When the user asks to "highlight" or "show" a specific region, default to making the rest muted (gray cartoon) and the focus vivid, UNLESS they've already set up a color scheme you'd be disrupting.

Carbon-only recoloring (standard convention):
  When distinguishing entities (e.g., ligand vs protein residues), recolor only carbon atoms to a highlight color while preserving element colors on N (blue), O (red), S (yellow) for chemical readability. Do this by:
  1. "color <highlight>, <sel> and elem C" — set carbons to the highlight color
  2. "color atomic, <sel> and not elem C" — reset non-carbons to element colors
  Use different carbon colors for different entities (e.g., green carbons on ligand, salmon carbons on protein active-site residues). This is the standard in every structural biology publication.

CRITICAL — always select whole residues:
  "within"/"around" select individual ATOMS, not residues. This causes half-colored, half-visible residues. ALWAYS wrap distance selections with "byres" when showing, hiding, or coloring residues:
    WRONG: color green, within 5 of organic           — clips residues, partial coloring
    RIGHT: color green, byres within 5 of organic     — complete residues
    WRONG: show sticks, polymer within 4 of resn ATP  — half-residues shown
    RIGHT: show sticks, byres polymer within 4 of resn ATP
  The ONLY exception is when you intentionally want per-atom granularity (rare). For virtually all visualization tasks, use "byres".

Avoid these common mistakes:
  - Showing an entire large protein as sticks or ball-and-stick — unreadable clutter. Use cartoon for the bulk.
  - Using more than 6-8 distinct colors in one scene — becomes noise. Mute the context.
  - Coloring everything in saturated bright colors — nothing stands out. Reserve bright colors for focal points.
  - Applying a single flat color to atoms you want chemical detail on — use element coloring or carbon-only recoloring.
  - Using "represent" (global) when you should use "show <rep>, <sel>" (targeted) — "represent" changes ALL atoms, overriding any multi-representation setup.

When you execute visual commands (color, show/hide, represent, spectrum, util.cbc, util.ss, etc.), ALWAYS call the update_legend tool to describe what the visualization shows. Include all relevant color-to-meaning mappings.${structureCtx}${visualStateCtx}

IMPORTANT: The "Current visual state" section above (if present) is the authoritative source for what's currently on screen — representations, visibility, colors, contacts, selections, and scale. Prefer it over inferring state from command history. Build incrementally on the current state — only change what the user asks to change. Do NOT reset or hide everything and start over unless the user explicitly asks to reset. If the user says "also show X" or "add Y", keep existing setup and add to it.

CAUTION: The "show" command makes hidden atoms visible. If some atoms were intentionally hidden (check the visual state), use targeted selections that won't re-reveal them. For example, if chain C's 5CM is hidden, use "show sticks, resn 5CM and chain B" instead of "show sticks, resn 5CM" which would show both.

The command history below shows commands already executed for additional context.${buildCommandLogContext(commandLog)}`;
}

// ---- Tool handlers ----

function handleGetStructureInfo(mergedModel, interpreter, structureName) {
  if (!mergedModel) return { error: 'No structure loaded' };

  // Resolve which model to inspect
  let model = mergedModel;
  if (structureName) {
    const sm = interpreter?.getStructureManager?.();
    if (!sm) return { error: 'Structure manager unavailable' };
    const entry = sm.getStructure(structureName);
    if (!entry) return { error: `Structure "${structureName}" not found. Use list_structures to see available names.` };
    model = entry.model;
  }

  const chains = model.chains.map(c => {
    const residues = model.residues.slice(c.residueStart, c.residueEnd);
    const seq = residues
      .filter(r => r.isStandard)
      .map(r => r.oneLetterCode)
      .join('');
    let helixCount = 0, sheetCount = 0, coilCount = 0;
    for (const r of residues) {
      if (r.ss === SS_HELIX) helixCount++;
      else if (r.ss === SS_SHEET) sheetCount++;
      else coilCount++;
    }
    return {
      id: c.id,
      residueCount: residues.length,
      sequence: seq,
      secondaryStructure: { helix: helixCount, sheet: sheetCount, coil: coilCount },
    };
  });

  // Detect identical chain groups (same sequence)
  const seqGroups = {};
  for (const c of chains) {
    if (!c.sequence) continue;
    if (!seqGroups[c.sequence]) seqGroups[c.sequence] = [];
    seqGroups[c.sequence].push(c.id);
  }
  const identicalGroups = Object.values(seqGroups).filter(g => g.length > 1);

  // Ligands / HETATM residues
  const hetResidues = new Map();
  for (const r of model.residues) {
    if (!r.isStandard) {
      const key = `${r.name}_${r.chainId}`;
      if (!hetResidues.has(key)) {
        hetResidues.set(key, { name: r.name, chain: r.chainId, count: 1 });
      } else {
        hetResidues.get(key).count++;
      }
    }
  }

  // Header metadata
  const h = model.header || {};
  const meta = {};
  if (h.pdbId) meta.pdbId = h.pdbId;
  if (h.title) meta.title = h.title;
  if (h.classification) meta.classification = h.classification;
  if (h.compound) meta.compound = h.compound;
  if (h.source) meta.source = h.source;
  if (h.method) meta.method = h.method;
  if (h.resolution) meta.resolution = h.resolution;

  const result = {
    ...meta,
    totalAtoms: model.atomCount,
    chains,
    identicalChainGroups: identicalGroups,
    ligands: Array.from(hetResidues.values()),
  };
  if (structureName) result.structureName = structureName;
  return result;
}

function handleListResidues(mergedModel, interpreter, chainId, structureName) {
  if (!mergedModel) return { error: 'No structure loaded' };

  // Resolve which model to inspect
  let model = mergedModel;
  if (structureName) {
    const sm = interpreter?.getStructureManager?.();
    if (!sm) return { error: 'Structure manager unavailable' };
    const entry = sm.getStructure(structureName);
    if (!entry) return { error: `Structure "${structureName}" not found. Use list_structures to see available names.` };
    model = entry.model;
  }

  const chain = model.chains.find(c => c.id === chainId);
  if (!chain) {
    const available = model.chains.map(c => c.id).join(', ');
    return { error: `Chain "${chainId}" not found${structureName ? ` in structure "${structureName}"` : ''}. Available chains: ${available}` };
  }

  const residues = model.residues.slice(chain.residueStart, chain.residueEnd);
  const residueNumbers = [];
  const residueNames = [];
  const secondaryStructure = [];

  for (const r of residues) {
    residueNumbers.push(r.seq);
    residueNames.push(r.name);
    secondaryStructure.push(
      r.ss === SS_HELIX ? 'helix' : r.ss === SS_SHEET ? 'sheet' : 'coil'
    );
  }

  return { residueNumbers, residueNames, secondaryStructure };
}

function handleEvaluateSelection(expression, interpreter) {
  try {
    const model = interpreter.getModel();
    if (!model) return { valid: false, atomCount: 0, error: 'No structure loaded' };
    const bonds = interpreter.getBonds ? interpreter.getBonds() : null;
    const indices = parseSelection(expression, model, interpreter.namedSelections, bonds);
    return { valid: true, atomCount: indices.size };
  } catch (e) {
    return { valid: false, atomCount: 0, error: e.message };
  }
}

function handleListStructures(interpreter) {
  const sm = interpreter?.getStructureManager?.();
  if (!sm || sm.count === 0) return { error: 'No structure loaded' };

  const structures = [];
  for (const entry of sm._orderedEntries()) {
    const m = entry.model;
    const h = m.header || {};
    const chainIds = m.chains.map(c => c.id);
    const info = {
      name: entry.name,
      atomCount: entry.atomCount,
      chains: chainIds,
    };
    if (h.pdbId) info.pdbId = h.pdbId;
    if (h.title) info.title = h.title;
    if (h.classification) info.classification = h.classification;
    if (h.source) info.source = h.source;
    if (entry.color) info.color = `#${entry.color.getHexString()}`;
    structures.push(info);
  }
  return { structures, count: structures.length };
}

// ---- Multi-turn agentic loop ----

const MAX_TURNS = 10;

/**
 * Translate a natural language request into PyMOL commands via the Claude API,
 * using tool-use to query the structure when needed.
 *
 * @param {string} userText - The user's plain English request
 * @param {string} apiKey - Anthropic API key
 * @param {Object} interpreter - Command interpreter (with getModel, namedSelections)
 * @param {(progress: {type: string, text: string}) => void} [onProgress] - Progress callback
 * @param {Object[]} [history] - Conversation history array (mutated in place)
 * @returns {Promise<{commands: string[], message: string|null}>} Commands to execute and/or info message
 */
export async function translateToCommands(userText, apiKey, interpreter, onProgress, history, onLegendUpdate, commandLog) {
  const model = interpreter?.getModel() || null;
  const systemPrompt = buildSystemPrompt(model, commandLog, interpreter);

  // Append user message to persistent history
  const messages = history || [];
  const historyLen = messages.length; // snapshot so we can rollback on error
  messages.push({ role: 'user', content: userText });

  // Commands may appear in tool_use turns (e.g. alongside update_legend).
  // Accumulate them so they aren't lost when the loop continues.
  const CMD_KEYWORDS = /^(select|color|show|hide|represent|rep|zoom|center|orient|turn|reset|bg_color|count_atoms|delete|selections|ls|help|spectrum|set_color|set|util\.cbc|util\.chainbow|util\.ss|lines|as|bond|unbond|contacts|distance|get_distance|load|fetch|align|remove|list)\b/i;
  const accumulatedCommands = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let resp;
    try {
      resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          system: systemPrompt,
          tools: TOOLS,
          messages,
        }),
      });
    } catch (e) {
      messages.length = historyLen;
      throw new Error(`Network error: ${e.message}`);
    }

    if (!resp.ok) {
      const body = await resp.text();
      messages.length = historyLen; // rollback so retries start clean
      if (resp.status === 401) throw new Error('Invalid API key');
      throw new Error(`API error ${resp.status}: ${body}`);
    }

    const data = await resp.json();
    const stopReason = data.stop_reason;
    const content = data.content || [];

    // Append the assistant message to conversation
    messages.push({ role: 'assistant', content });

    if (stopReason === 'tool_use') {
      // Execute each tool call locally, collect results
      const toolResults = [];
      for (const block of content) {
        if (block.type !== 'tool_use') continue;

        const { id, name, input } = block;

        if (onProgress) {
          onProgress({ type: 'tool-call', text: `Tool: ${name}(${JSON.stringify(input)})` });
        }

        let result;
        switch (name) {
          case 'get_structure_info':
            result = handleGetStructureInfo(model, interpreter, input.structure_name);
            break;
          case 'list_residues':
            result = handleListResidues(model, interpreter, input.chain_id, input.structure_name);
            break;
          case 'evaluate_selection':
            result = handleEvaluateSelection(input.expression, interpreter);
            break;
          case 'update_legend':
            if (onLegendUpdate) onLegendUpdate(input);
            result = { success: true };
            break;
          case 'list_structures':
            result = handleListStructures(interpreter);
            break;
          default:
            result = { error: `Unknown tool: ${name}` };
        }

        const resultStr = JSON.stringify(result);
        if (onProgress) {
          // Truncate for display
          const display = resultStr.length > 120 ? resultStr.slice(0, 117) + '...' : resultStr;
          onProgress({ type: 'tool-result', text: `  → ${display}` });
        }

        toolResults.push({
          type: 'tool_result',
          tool_use_id: id,
          content: resultStr,
        });
      }

      // Capture any commands from text blocks in this tool_use turn
      // (e.g. AI outputs commands alongside an update_legend call)
      const turnTextBlocks = content.filter(b => b.type === 'text');
      if (turnTextBlocks.length > 0) {
        const turnText = turnTextBlocks.map(b => b.text).join('\n');
        const turnLines = turnText.split('\n')
          .map(l => l.trim())
          .filter(l => l && !l.startsWith('```'));
        for (const l of turnLines) {
          if (CMD_KEYWORDS.test(l)) accumulatedCommands.push(l);
        }
      }

      // Append tool results as a user message and continue the loop
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // stop_reason === 'end_turn' (or anything else): extract response
    const textBlocks = content.filter(b => b.type === 'text');
    const rawText = textBlocks.map(b => b.text).join('\n');
    const lines = rawText.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('```'));

    const commandLines = [...accumulatedCommands, ...lines.filter(l => CMD_KEYWORDS.test(l))];
    const textLines = lines.filter(l => !CMD_KEYWORDS.test(l));

    if (commandLines.length > 0) {
      // Execute commands; attach any surrounding text as a message
      return {
        commands: commandLines,
        message: textLines.length > 0 ? textLines.join('\n') : null,
      };
    }
    // Purely informational response — preserve raw markdown
    return { commands: [], message: rawText.trim() };
  }

  throw new Error('AI exceeded maximum tool-use turns');
}
