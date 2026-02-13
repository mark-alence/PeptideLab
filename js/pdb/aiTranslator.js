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
      'Get an overview of the loaded protein structure: chains, sequences, secondary structure breakdown, identical chain groups, and ligands/HETATM residues.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_residues',
    description:
      'List all residues in a specific chain as parallel arrays of residue numbers, residue names (3-letter codes), and secondary structure types.',
    input_schema: {
      type: 'object',
      properties: {
        chain_id: {
          type: 'string',
          description: 'Chain identifier (e.g. "A")',
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

function buildSystemPrompt(model, commandLog) {
  // Compact structure context so simple requests don't need tool calls
  let structureCtx = '';
  if (model) {
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

  return `You are an assistant for a PDB protein viewer with a PyMOL-style console.

You have tools to query the loaded structure. Use them when you need specific residue numbers, chain info, or to verify selections. For simple action requests (e.g. "color chain A red"), you can respond directly without tools.

If the user asks a QUESTION about the structure (e.g. "what chains are there?", "how many helices?"), use tools to look up the answer, then reply with a well-formatted markdown answer. Use headers, bold, lists, code blocks, and tables as appropriate. Do NOT emit commands for questions.

If the user requests an ACTION (e.g. "color even residues blue", "hide chain B"), respond with ONLY commands, one per line — no explanations, no markdown, no code fences.

If a request mentions "bonds" — consider whether the user wants to detect/add new bonds between selections (use the "bond" command) or just change visual representation (use "as sticks" etc.). When the context involves an interface, cross-chain contacts, or specific atom pairs, prefer the "bond" command.

If the user asks about interactions, hydrogen bonds, salt bridges, or contacts between selections, use the "contacts" command. This shows dashed-line overlays on top of any representation and is ideal for visualizing non-covalent interactions at interfaces.

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

Selection syntax:
  chain A                — Chain ID
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

When you execute visual commands (color, show/hide, represent, spectrum, util.cbc, util.ss, etc.), ALWAYS call the update_legend tool to describe what the visualization shows. Include all relevant color-to-meaning mappings.${structureCtx}

IMPORTANT: The console command history below shows commands already executed in this session (both user-typed and AI-generated). Use this to understand the current state of the visualization — what's visible, hidden, colored, selected, etc. — so you can build on it rather than starting from scratch.${buildCommandLogContext(commandLog)}`;
}

// ---- Tool handlers ----

function handleGetStructureInfo(model) {
  if (!model) return { error: 'No structure loaded' };

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

  return {
    ...meta,
    totalAtoms: model.atomCount,
    chains,
    identicalChainGroups: identicalGroups,
    ligands: Array.from(hetResidues.values()),
  };
}

function handleListResidues(model, chainId) {
  if (!model) return { error: 'No structure loaded' };

  const chain = model.chains.find(c => c.id === chainId);
  if (!chain) return { error: `Chain "${chainId}" not found` };

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
  const systemPrompt = buildSystemPrompt(model, commandLog);

  // Append user message to persistent history
  const messages = history || [];
  messages.push({ role: 'user', content: userText });

  // Commands may appear in tool_use turns (e.g. alongside update_legend).
  // Accumulate them so they aren't lost when the loop continues.
  const CMD_KEYWORDS = /^(select|color|show|hide|represent|rep|zoom|center|orient|turn|reset|bg_color|count_atoms|delete|selections|ls|help|spectrum|set_color|set|util\.cbc|util\.chainbow|util\.ss|lines|as|bond|unbond|contacts|distance|get_distance)\b/i;
  const accumulatedCommands = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        system: systemPrompt,
        tools: TOOLS,
        messages,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
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
            result = handleGetStructureInfo(model);
            break;
          case 'list_residues':
            result = handleListResidues(model, input.chain_id);
            break;
          case 'evaluate_selection':
            result = handleEvaluateSelection(input.expression, interpreter);
            break;
          case 'update_legend':
            if (onLegendUpdate) onLegendUpdate(input);
            result = { success: true };
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
