// ============================================================
// console.js — Console panel React component
// Right-side chat panel for viewer mode.
// Supports "Command" mode (direct PyMOL) and "Ask AI" mode
// (natural language → Claude API → commands).
// ============================================================

import { translateToCommands } from './aiTranslator.js';

const { useState, useEffect, useRef, useCallback } = React;
const h = React.createElement;

// Configure marked for markdown rendering (loaded via CDN)
if (typeof marked !== 'undefined') {
  marked.setOptions({ breaks: true, gfm: true });
}

const API_KEY_STORAGE = 'peptidelab_claude_api_key';

// Categorize line types for bubble grouping
function getBubbleCategory(type) {
  if (type === 'command') return 'user';
  if (type === 'error') return 'error';
  if (type.startsWith('ai')) return 'ai';
  return 'system';
}

// Group consecutive lines of the same category into bubbles
function groupIntoBubbles(lines) {
  const bubbles = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cat = getBubbleCategory(line.type);

    if (!current || current.category !== cat) {
      if (current) bubbles.push(current);
      current = { category: cat, lines: [line], key: i };
    } else {
      current.lines.push(line);
    }
  }
  if (current) bubbles.push(current);
  return bubbles;
}

/**
 * PDBConsole — right-side chat panel for the PDB viewer.
 *
 * @param {{ visible: boolean, interpreter: Object, onToggle: () => void }} props
 */
export function PDBConsole({ visible, interpreter, onToggle, onLegendUpdate }) {
  const [lines, setLines] = useState([
    { type: 'output', text: 'PyMOL-style console. Type "help" for commands.' },
  ]);
  const [input, setInput] = useState('');
  const [history, setHistory] = useState([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [mode, setMode] = useState('command'); // 'command' | 'ai'
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(API_KEY_STORAGE) || '');
  const outputRef = useRef(null);
  const inputRef = useRef(null);
  const settingsRef = useRef(null);
  const aiHistoryRef = useRef([]);
  const commandLogRef = useRef([]);

  // Auto-scroll output to bottom
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [lines]);

  // Focus input when console becomes visible
  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  // Close settings popover when clicking outside
  useEffect(() => {
    if (!showSettings) return;
    const onClick = (e) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target)) {
        setShowSettings(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showSettings]);

  const addLine = useCallback((type, text) => {
    setLines(prev => [...prev, { type, text }]);
  }, []);

  const addLines = useCallback((newLines) => {
    setLines(prev => [...prev, ...newLines]);
  }, []);

  const handleClear = useCallback(() => {
    setLines([{ type: 'output', text: 'Console cleared.' }]);
    aiHistoryRef.current = [];
  }, []);

  // Execute a single command through the interpreter
  const execCommand = useCallback(async (cmd) => {
    if (!interpreter) return 'No interpreter available';
    const result = interpreter.execute(cmd);
    // Handle async commands (e.g. load)
    if (result && typeof result.then === 'function') {
      const resolved = await result;
      if (resolved !== null && resolved !== undefined) return String(resolved);
      return null;
    }
    if (result !== null && result !== undefined) return String(result);
    return null;
  }, [interpreter]);

  // Handle AI mode submission
  const handleAISubmit = useCallback(async (text) => {
    if (!apiKey) {
      addLine('error', 'No API key set. Click the gear icon to add your Anthropic API key.');
      setShowSettings(true);
      return;
    }

    addLine('ai-thinking', 'Thinking...');
    setBusy(true);

    try {
      const onProgress = ({ type, text: msg }) => {
        if (type === 'tool-call') {
          addLine('ai-tool-call', msg);
        } else if (type === 'tool-result') {
          addLine('ai-tool-result', msg);
        }
      };

      const { commands, message } = await translateToCommands(text, apiKey, interpreter, onProgress, aiHistoryRef.current, onLegendUpdate, commandLogRef.current);

      // Show informational text if present
      if (message) {
        addLine('ai-message', message);
      }

      if (commands.length === 0 && !message) {
        addLine('error', 'AI returned no response.');
        return;
      }

      if (commands.length > 0) {
        addLine('ai-label', 'Generated commands:');
        const outputLines = [];
        for (const cmd of commands) {
          outputLines.push({ type: 'ai-command', text: '  ' + cmd });
          const result = await execCommand(cmd);
          commandLogRef.current.push({ cmd, result });
          if (result !== null) {
            for (const rl of result.split('\n')) {
              outputLines.push({ type: 'output', text: '  ' + rl });
            }
          }
        }
        addLines(outputLines);
      }
    } catch (e) {
      addLine('error', 'AI error: ' + e.message);
    } finally {
      setBusy(false);
    }
  }, [apiKey, addLine, addLines, execCommand, interpreter, onLegendUpdate]);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed || busy) return;

    const isAI = mode === 'ai';

    // Echo the user input
    addLine('command', (isAI ? 'Ask AI> ' : 'PyMOL> ') + trimmed);

    // Update history
    setHistory(prev => {
      const next = prev.filter(h => h !== trimmed);
      next.push(trimmed);
      return next;
    });
    setHistIdx(-1);
    setInput('');

    if (isAI) {
      handleAISubmit(trimmed);
    } else {
      // Direct command execution
      if (interpreter) {
        const result = interpreter.execute(trimmed);
        // Handle async commands (e.g. load)
        if (result && typeof result.then === 'function') {
          setBusy(true);
          addLine('output', 'Loading...');
          result.then(msg => {
            const resultStr = (msg !== null && msg !== undefined) ? String(msg) : null;
            commandLogRef.current.push({ cmd: trimmed, result: resultStr });
            if (resultStr) {
              for (const line of resultStr.split('\n')) {
                addLine('output', line);
              }
            }
          }).catch(e => {
            commandLogRef.current.push({ cmd: trimmed, result: `Error: ${e.message}` });
            addLine('error', `Error: ${e.message}`);
          }).finally(() => {
            setBusy(false);
          });
        } else {
          const resultStr = (result !== null && result !== undefined) ? String(result) : null;
          commandLogRef.current.push({ cmd: trimmed, result: resultStr });
          if (resultStr) {
            for (const line of resultStr.split('\n')) {
              addLine('output', line);
            }
          }
        }
      } else {
        addLine('error', 'No interpreter available');
      }
    }
  }, [input, mode, busy, interpreter, addLine, handleAISubmit]);

  const handleKeyDown = useCallback((e) => {
    // Prevent Three.js from receiving keyboard events
    e.stopPropagation();

    if (e.key === 'Enter') {
      handleSubmit();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHistory(prev => {
        setHistIdx(idx => {
          const newIdx = idx === -1 ? prev.length - 1 : Math.max(0, idx - 1);
          if (newIdx >= 0 && newIdx < prev.length) {
            setInput(prev[newIdx]);
          }
          return newIdx;
        });
        return prev;
      });
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHistory(prev => {
        setHistIdx(idx => {
          const newIdx = idx + 1;
          if (newIdx >= prev.length) {
            setInput('');
            return -1;
          }
          setInput(prev[newIdx]);
          return newIdx;
        });
        return prev;
      });
    } else if (e.key === 'Escape') {
      onToggle();
    }
  }, [handleSubmit, onToggle]);

  const handleApiKeySave = useCallback((key) => {
    const trimmed = key.trim();
    setApiKey(trimmed);
    if (trimmed) {
      localStorage.setItem(API_KEY_STORAGE, trimmed);
    } else {
      localStorage.removeItem(API_KEY_STORAGE);
    }
  }, []);

  const isAI = mode === 'ai';
  const bubbles = groupIntoBubbles(lines);

  return h('div', { className: 'pdb-console-panel' + (visible ? ' open' : '') },
    // Header
    h('div', { className: 'console-panel-header' },
      h('span', { className: 'console-panel-title' }, 'Console'),
      h('button', {
        className: 'console-panel-btn',
        onClick: handleClear,
        title: 'Clear output',
      }, '\u232B'),
      // Settings
      h('div', { className: 'console-settings-wrap', ref: settingsRef },
        h('button', {
          className: 'console-settings-btn' + (isAI && !apiKey ? ' needs-key' : ''),
          onClick: () => setShowSettings(v => !v),
          title: 'API key settings',
        }, '\u2699'),
        showSettings && h(ApiKeyPopover, {
          apiKey,
          onSave: handleApiKeySave,
          onClose: () => setShowSettings(false),
        }),
      ),
      h('button', {
        className: 'console-panel-btn',
        onClick: onToggle,
        title: 'Close (Esc)',
      }, '\u00D7'),
    ),
    // Tabs
    h('div', { className: 'console-tabs' },
      h('button', {
        className: 'console-tab' + (mode === 'command' ? ' active-cmd' : ''),
        onClick: () => { setMode('command'); if (inputRef.current) inputRef.current.focus(); },
      }, 'Command'),
      h('button', {
        className: 'console-tab' + (mode === 'ai' ? ' active-ai' : ''),
        onClick: () => { setMode('ai'); if (inputRef.current) inputRef.current.focus(); },
      }, 'Ask AI'),
    ),
    // Output area with chat bubbles
    h('div', { className: 'pdb-console-output', ref: outputRef },
      ...bubbles.map(bubble =>
        h('div', { key: bubble.key, className: 'console-bubble ' + bubble.category },
          ...bubble.lines.map((line, j) => {
            if (line.type === 'ai-message' && typeof marked !== 'undefined' && typeof DOMPurify !== 'undefined') {
              return h('div', {
                key: j,
                className: 'console-line console-ai-message',
                dangerouslySetInnerHTML: {
                  __html: DOMPurify.sanitize(marked.parse(line.text)),
                },
              });
            }
            return h('div', {
              key: j,
              className: `console-line console-${line.type}`,
            }, line.text);
          }),
        )
      ),
    ),
    // Input area
    h('div', { className: 'console-input-area' },
      h('div', { className: 'console-input-wrap' + (isAI ? ' ai' : '') },
        h('input', {
          ref: inputRef,
          className: 'pdb-console-input' + (isAI ? ' ai-input' : ''),
          type: 'text',
          value: input,
          placeholder: isAI ? 'Ask about this structure...' : 'Enter PyMOL command...',
          onChange: (e) => { setInput(e.target.value); setHistIdx(-1); },
          onKeyDown: handleKeyDown,
          spellCheck: isAI,
          autoComplete: 'off',
          disabled: busy,
        }),
      ),
      h('button', {
        className: 'console-send-btn' + (isAI ? ' ai' : ''),
        onClick: handleSubmit,
        disabled: busy || !input.trim(),
        title: 'Send (Enter)',
      }, busy ? '\u2026' : '\u2192'),
    ),
  );
}

/**
 * ApiKeyPopover — small popover for entering the Anthropic API key.
 */
function ApiKeyPopover({ apiKey, onSave, onClose }) {
  const [value, setValue] = useState(apiKey);
  const inputRef = useRef(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const handleKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      onSave(value);
      onClose();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return h('div', { className: 'api-key-popover' },
    h('div', { className: 'api-key-popover-title' }, 'Anthropic API Key'),
    h('input', {
      ref: inputRef,
      className: 'api-key-input',
      type: 'password',
      value,
      placeholder: 'sk-ant-...',
      onChange: (e) => setValue(e.target.value),
      onKeyDown: handleKeyDown,
      spellCheck: false,
      autoComplete: 'off',
    }),
    h('div', { className: 'api-key-actions' },
      h('button', {
        className: 'api-key-save-btn',
        onClick: () => { onSave(value); onClose(); },
      }, 'Save'),
      h('button', {
        className: 'api-key-clear-btn',
        onClick: () => { onSave(''); setValue(''); },
      }, 'Clear'),
    ),
    h('div', { className: 'api-key-hint' },
      'Key is stored in localStorage only. Never sent anywhere except the Anthropic API.'
    ),
  );
}
