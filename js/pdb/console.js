// ============================================================
// console.js — PyMOL-style console React component
// Docked to bottom of viewport in viewer mode.
// ============================================================

const { useState, useEffect, useRef, useCallback } = React;
const h = React.createElement;

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
  const outputRef = useRef(null);
  const inputRef = useRef(null);

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

  const addLine = useCallback((type, text) => {
    setLines(prev => [...prev, { type, text }]);
  }, []);

  const handleSubmit = useCallback(() => {
    const trimmed = input.trim();
    if (!trimmed) return;

    // Add command echo
    addLine('command', 'PyMOL> ' + trimmed);

    // Update history
    setHistory(prev => {
      const next = prev.filter(h => h !== trimmed);
      next.push(trimmed);
      return next;
    });
    setHistIdx(-1);

    // Execute
    if (interpreter) {
      const result = interpreter.execute(trimmed);
      if (result !== null && result !== undefined) {
        // Split multi-line results
        const resultLines = String(result).split('\n');
        for (const line of resultLines) {
          addLine('output', line);
        }
      }
    } else {
      addLine('error', 'No interpreter available');
    }

    setInput('');
  }, [input, interpreter, addLine]);

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

  if (!visible) return null;

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
      h('span', { className: 'console-prompt' }, 'PyMOL>'),
      h('input', {
        ref: inputRef,
        className: 'pdb-console-input',
        type: 'text',
        value: input,
        onChange: (e) => { setInput(e.target.value); setHistIdx(-1); },
        onKeyDown: handleKeyDown,
        spellCheck: false,
        autoComplete: 'off',
      }),
    ),
  );
}
