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
];

// ---- System prompt builder ----

function buildSystemPrompt(model) {
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

If the user asks a QUESTION about the structure (e.g. "what chains are there?", "how many helices?"), use tools to look up the answer, then reply with a short plain-text answer. Do NOT emit commands for questions.

If the user requests an ACTION (e.g. "color even residues blue", "hide chain B"), respond with ONLY commands, one per line — no explanations, no markdown, no code fences.

Available commands:
  select <name>, <sel>   — Store a named selection
  color <color>, <sel>   — Color atoms (default: all). "atomic" resets to element colors
  show <sel>             — Unhide atoms (default: all)
  hide <sel>             — Hide atoms
  represent <mode>       — spheres | sticks | lines (alias: rep)
  zoom <sel>             — Fit camera to selection
  center <sel>           — Orbit around selection centroid
  orient <sel>           — Orient camera for best view of selection
  turn <axis>, <angle>   — Rotate view (x/y/z, degrees)
  reset                  — Reset all colors/visibility/camera
  bg_color <color>       — Set background color
  count_atoms <sel>      — Count atoms
  spectrum <prop>, <palette>, <sel> — Gradient coloring. Properties: count (residue index), b (B-factor), chain. Palettes: rainbow, blue_white_red, red_white_blue, blue_red, green_white_magenta, yellow_cyan_white
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
  within 4.0 of <sel>    — Atoms within distance (Å), includes selection
  around 4.0 of <sel>    — Atoms within distance (Å), excludes selection

Colors: red green blue cyan magenta yellow white orange pink salmon slate gray wheat violet marine olive teal forest firebrick chocolate black lime purple gold hotpink skyblue lightblue deepblue carbon nitrogen oxygen sulfur. Also hex: #FF0000 or 0xFF0000.${structureCtx}`;
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
export async function translateToCommands(userText, apiKey, interpreter, onProgress, history) {
  const model = interpreter?.getModel() || null;
  const systemPrompt = buildSystemPrompt(model);

  // Append user message to persistent history
  const messages = history || [];
  messages.push({ role: 'user', content: userText });

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

      // Append tool results as a user message and continue the loop
      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    // stop_reason === 'end_turn' (or anything else): extract response
    const textBlocks = content.filter(b => b.type === 'text');
    const text = textBlocks.map(b => b.text).join('\n');
    const lines = text.split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('```'));

    // Detect if response is commands or informational text.
    // Commands start with a known keyword; plain text does not.
    const CMD_KEYWORDS = /^(select|color|show|hide|represent|rep|zoom|center|orient|turn|reset|bg_color|count_atoms|delete|selections|ls|help|spectrum|set_color|util\.cbc|util\.chainbow|util\.ss)\b/i;
    const isAllCommands = lines.length > 0 && lines.every(l => CMD_KEYWORDS.test(l));

    if (isAllCommands) {
      return { commands: lines, message: null };
    }
    // Informational response (or mixed) — show as message, don't execute
    return { commands: [], message: lines.join('\n') };
  }

  throw new Error('AI exceeded maximum tool-use turns');
}
