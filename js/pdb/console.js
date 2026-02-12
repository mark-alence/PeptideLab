// ============================================================
// console.js — PyMOL-style console React component
// Docked to bottom of viewport in viewer mode.
// Supports "Command" mode (direct PyMOL) and "Ask AI" mode
// (natural language → Claude API → commands).
// ============================================================

import { translateToCommands } from './aiTranslator.js';

const { useState, useEffect, useRef, useCallback } = React;
const h = React.createElement;

const API_KEY_STORAGE = 'peptidelab_claude_api_key';

/**
 * PDBConsole — interactive command console for the PDB viewer.
 *
 * @param {{ visible: boolean, interpreter: Object, onToggle: () => void }} props
 */
export function PDBConsole({ visible, interpreter, onToggle }) {
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

  // Execute a single command through the interpreter
  const execCommand = useCallback((cmd) => {
    if (!interpreter) return 'No interpreter available';
    const result = interpreter.execute(cmd);
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

      const { commands, message } = await translateToCommands(text, apiKey, interpreter, onProgress, aiHistoryRef.current);

      // Informational response — display as text
      if (message) {
        for (const line of message.split('\n')) {
          addLine('output', line);
        }
        return;
      }

      if (commands.length === 0) {
        addLine('error', 'AI returned no response.');
        return;
      }

      // Show generated commands header
      addLine('ai-label', 'Generated commands:');

      // Execute each command and collect output
      const outputLines = [];
      for (const cmd of commands) {
        outputLines.push({ type: 'ai-command', text: '  ' + cmd });
        const result = execCommand(cmd);
        if (result !== null) {
          for (const rl of result.split('\n')) {
            outputLines.push({ type: 'output', text: '  ' + rl });
          }
        }
      }
      addLines(outputLines);
    } catch (e) {
      addLine('error', 'AI error: ' + e.message);
    } finally {
      setBusy(false);
    }
  }, [apiKey, addLine, addLines, execCommand, interpreter]);

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
        if (result !== null && result !== undefined) {
          const resultLines = String(result).split('\n');
          for (const line of resultLines) {
            addLine('output', line);
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

  const handleModeToggle = useCallback(() => {
    setMode(prev => prev === 'command' ? 'ai' : 'command');
    if (inputRef.current) inputRef.current.focus();
  }, []);

  if (!visible) return null;

  const isAI = mode === 'ai';

  return h('div', { className: 'pdb-console' },
    // Output area
    h('div', {
      className: 'pdb-console-output',
      ref: outputRef,
    },
      ...lines.map((line, i) =>
        h('div', {
          key: i,
          className: `console-line console-${line.type}`,
        }, line.text)
      ),
    ),
    // Input row
    h('div', { className: 'pdb-console-input-row' },
      // Mode toggle
      h('button', {
        className: 'console-mode-toggle' + (isAI ? ' ai-active' : ''),
        onClick: handleModeToggle,
        title: isAI ? 'Switch to Command mode' : 'Switch to Ask AI mode',
      }, isAI ? 'AI' : 'CMD'),
      // Prompt
      h('span', { className: 'console-prompt' + (isAI ? ' ai-prompt' : '') },
        isAI ? 'Ask AI>' : 'PyMOL>'),
      // Input
      h('input', {
        ref: inputRef,
        className: 'pdb-console-input' + (isAI ? ' ai-input' : ''),
        type: 'text',
        value: input,
        placeholder: isAI ? 'Describe what you want in plain English...' : '',
        onChange: (e) => { setInput(e.target.value); setHistIdx(-1); },
        onKeyDown: handleKeyDown,
        spellCheck: isAI,
        autoComplete: 'off',
        disabled: busy,
      }),
      // Busy indicator
      busy && h('span', { className: 'console-busy' }, '...'),
      // Settings gear
      h('div', { className: 'console-settings-wrap', ref: settingsRef },
        h('button', {
          className: 'console-settings-btn' + (isAI && !apiKey ? ' needs-key' : ''),
          onClick: () => setShowSettings(v => !v),
          title: 'API key settings',
        }, '\u2699'),
        // Settings popover
        showSettings && h(ApiKeyPopover, {
          apiKey,
          onSave: handleApiKeySave,
          onClose: () => setShowSettings(false),
        }),
      ),
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
