// ============================================================
// ui.js — React UI: title screen, palette, chain display, info
// ============================================================

import { BIOMES, CAT, CAT_COLORS, CATEGORIES, BIOMES_BY_CATEGORY, BIOME_BY_LETTER } from './constants.js';
import { SCENES } from './scenes.js';

const { useState, useEffect, useCallback } = React;

// --- Event Bus ---
export const GameEvents = {
  _listeners: {},
  on(event, fn)  { (this._listeners[event] ||= []).push(fn); },
  off(event, fn) { this._listeners[event] = (this._listeners[event] || []).filter(f => f !== fn); },
  emit(event, data) { (this._listeners[event] || []).forEach(fn => fn(data)); },
};

// --- Title Screen ---
function TitleScreen({ onStart }) {
  const [fade, setFade] = useState(false);

  const handleStart = () => {
    setFade(true);
    setTimeout(onStart, 600);
  };

  return React.createElement('div', {
    className: 'title-screen' + (fade ? ' fade-out' : ''),
  },
    React.createElement('h1', null, 'PeptideLab'),
    React.createElement('p', { className: 'subtitle' }, 'Drag & drop amino acids to build your own protein chain'),
    React.createElement('button', { onClick: handleStart, className: 'start-btn' }, 'Start Building'),
    React.createElement('p', { className: 'controls-hint' },
      'Right-drag to orbit  |  Scroll to zoom  |  Ctrl+Z to undo'
    ),
  );
}

// --- Lessons (preset scenes) ---
function Lessons() {
  const [open, setOpen] = useState(true);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    const onLoaded = (data) => setActiveId(data.scene.id);
    GameEvents.on('sceneLoaded', onLoaded);
    return () => GameEvents.off('sceneLoaded', onLoaded);
  }, []);

  const handleLoad = (id) => {
    GameEvents.emit('loadScene', { id });
  };

  return React.createElement('div', { className: 'lessons-section' },
    React.createElement('button', {
      className: 'lessons-toggle',
      onClick: () => setOpen(!open),
    }, open ? 'Lessons \u25B4' : 'Lessons \u25BE'),
    open && React.createElement('div', { className: 'lessons-list' },
      ...SCENES.map(sc =>
        React.createElement('button', {
          key: sc.id,
          className: 'lesson-item' + (activeId === sc.id ? ' active' : ''),
          onClick: () => handleLoad(sc.id),
          title: sc.description,
        }, sc.name)
      ),
    ),
  );
}

// --- Palette (left sidebar) ---
function Palette() {
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    const onSel = (data) => setSelected(data.letter);
    GameEvents.on('selectionChanged', onSel);
    return () => GameEvents.off('selectionChanged', onSel);
  }, []);

  const handleClick = (letter) => {
    GameEvents.emit('selectAA', { letter });
  };

  const handleMouseDown = (letter, e) => {
    e.preventDefault();
    GameEvents.emit('startDrag', { letter });
  };

  return React.createElement('div', { className: 'palette' },
    React.createElement(Lessons),
    React.createElement('div', { className: 'palette-title' }, 'Amino Acids'),
    ...CATEGORIES.map(cat =>
      React.createElement('div', { key: cat.key, className: 'palette-group' },
        React.createElement('div', {
          className: 'palette-group-label',
          style: { color: CAT_COLORS[cat.key] },
        }, cat.label),
        React.createElement('div', { className: 'palette-items' },
          ...BIOMES_BY_CATEGORY[cat.key].map(biome =>
            React.createElement('button', {
              key: biome.letter,
              className: 'palette-item' + (selected === biome.letter ? ' selected' : ''),
              style: {
                borderColor: selected === biome.letter ? CAT_COLORS[cat.key] : 'transparent',
              },
              onClick: () => handleClick(biome.letter),
              onMouseDown: (e) => handleMouseDown(biome.letter, e),
              title: `${biome.name} (${biome.code3})`,
            },
              React.createElement('span', { className: 'palette-letter' }, biome.letter),
              React.createElement('span', { className: 'palette-name' }, biome.code3),
            )
          ),
        ),
      )
    ),
  );
}

// --- Chain Display (top bar) ---
function ChainDisplay() {
  const [sequence, setSequence] = useState('');
  const [length, setLength] = useState(0);

  useEffect(() => {
    const onChange = (data) => {
      setSequence(data.sequence);
      setLength(data.length);
    };
    GameEvents.on('chainChanged', onChange);
    return () => GameEvents.off('chainChanged', onChange);
  }, []);

  if (length === 0) return null;

  return React.createElement('div', { className: 'chain-display' },
    React.createElement('span', { className: 'chain-label' }, 'Chain: '),
    React.createElement('span', { className: 'chain-sequence' }, sequence),
    React.createElement('span', { className: 'chain-count' }, `(${length} residues)`),
    React.createElement('button', {
      className: 'chain-clear-btn',
      onClick: () => GameEvents.emit('clearScene'),
      title: 'Clear all residues',
    }, 'Clear'),
  );
}

// --- Info Panel (selected AA properties + scene description) ---
function InfoPanel() {
  const [letter, setLetter] = useState(null);
  const [sceneInfo, setSceneInfo] = useState(null);

  useEffect(() => {
    const onSel = (data) => { setLetter(data.letter); setSceneInfo(null); };
    const onFocus = (data) => { if (data.letter) { setLetter(data.letter); setSceneInfo(null); } };
    const onScene = (data) => { setSceneInfo(data.scene); setLetter(null); };
    GameEvents.on('selectionChanged', onSel);
    GameEvents.on('focusEntry', onFocus);
    GameEvents.on('sceneLoaded', onScene);
    return () => {
      GameEvents.off('selectionChanged', onSel);
      GameEvents.off('focusEntry', onFocus);
      GameEvents.off('sceneLoaded', onScene);
    };
  }, []);

  // Scene description mode
  if (sceneInfo) {
    return React.createElement('div', { className: 'info-panel' },
      React.createElement('div', { className: 'info-header' },
        React.createElement('h2', null, sceneInfo.name),
      ),
      React.createElement('p', { className: 'info-oneliner' }, sceneInfo.description),
      React.createElement('div', { className: 'info-hint' }, 'Click an amino acid to see its properties'),
    );
  }

  // AA info mode
  if (!letter) return null;
  const b = BIOME_BY_LETTER[letter];
  if (!b) return null;

  return React.createElement('div', { className: 'info-panel' },
    React.createElement('div', { className: 'info-header' },
      React.createElement('h2', null, b.name),
      React.createElement('span', { className: 'info-codes' }, `${b.code3} (${b.letter})`),
    ),
    React.createElement('p', { className: 'info-oneliner' }, b.oneLiner),
    React.createElement('div', { className: 'info-props' },
      React.createElement('div', null, `Charge: ${b.properties.charge}`),
      React.createElement('div', null, `pI: ${b.properties.pI}`),
      React.createElement('div', null, `MW: ${b.properties.mw}`),
      React.createElement('div', null, `Hydropathy: ${b.properties.hydropathy}`),
    ),
    React.createElement('div', { className: 'info-codons' },
      React.createElement('span', null, 'Codons: '),
      b.codons.join(', '),
    ),
    React.createElement('div', { className: 'info-legend' },
      React.createElement('span', null, 'Structure key: '),
      ...[['C', '#555555'], ['N', '#5588ff'], ['O', '#ff4444'], ['S', '#ddcc22']].map(([el, col]) =>
        React.createElement('span', { key: el, className: 'legend-atom' },
          React.createElement('span', { className: 'legend-dot', style: { backgroundColor: col } }),
          el,
        )
      ),
    ),
  );
}

// --- Help Modal ---
function HelpModal({ onClose }) {
  const section = (title, rows) =>
    React.createElement('div', { className: 'help-section' },
      React.createElement('h3', null, title),
      ...rows.map(([key, desc], i) =>
        React.createElement('div', { key: i, className: 'help-row' },
          React.createElement('span', { className: 'help-key' }, key),
          React.createElement('span', { className: 'help-desc' }, desc),
        )
      ),
    );

  return React.createElement('div', {
    className: 'help-overlay',
    onClick: (e) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', { className: 'help-modal' },
      React.createElement('h2', null, 'Controls'),
      section('Camera', [
        ['Right-drag', 'Orbit around scene'],
        ['Middle-drag', 'Pan camera'],
        ['Scroll wheel', 'Zoom in / out'],
      ]),
      section('Building', [
        ['Click palette item', 'Select amino acid'],
        ['Click on grid', 'Place selected amino acid'],
        ['Drag from palette', 'Drag & drop onto grid'],
      ]),
      section('Editing', [
        ['Click placed residue', 'Select it for editing'],
        ['Drag placed residue', 'Move it to a new cell'],
        ['\u2190 \u2192 \u2191 \u2193', 'Rotate selected residue'],
        ['R', 'Cycle side-chain rotamer'],
        ['Backspace / X', 'Delete selected residue'],
        ['Ctrl+Z / \u2318+Z', 'Undo (remove last placed)'],
        ['Escape', 'Deselect / unfocus'],
      ]),
      section('Other', [
        ['Lessons panel', 'Load preset peptide scenes'],
      ]),
      React.createElement('hr', { className: 'help-divider' }),
      React.createElement('h2', null, 'Visual Guide'),
      // Atom colors
      React.createElement('div', { className: 'help-section' },
        React.createElement('h3', null, 'Atom Colors'),
        ...[
          ['#909090', 'Carbon (C)', 'Backbone and sidechain skeleton'],
          ['#6699ff', 'Nitrogen (N)', 'Amino groups, ring nitrogens'],
          ['#ff5555', 'Oxygen (O)', 'Carboxyl groups, hydroxyls'],
          ['#eedd44', 'Sulfur (S)', 'Cysteine thiols, methionine thioethers'],
        ].map(([color, label, detail], i) =>
          React.createElement('div', { key: i, className: 'legend-row' },
            React.createElement('span', { className: 'legend-swatch', style: { backgroundColor: color } }),
            React.createElement('span', { className: 'legend-label' }, label),
            React.createElement('span', { className: 'legend-detail' }, detail),
          )
        ),
      ),
      // Charge fields
      React.createElement('div', { className: 'help-section' },
        React.createElement('h3', null, 'Charge Fields'),
        ...[
          ['radial-gradient(circle, #ffcc33 0%, transparent 70%)', 'Yellow glow', 'Positive charge (Lys, Arg)'],
          ['radial-gradient(circle, #ff5544 0%, transparent 70%)', 'Red glow', 'Negative charge (Asp, Glu)'],
          ['radial-gradient(circle, #4488ff 0%, transparent 70%)', 'Blue pulse', 'pH-sensitive (His switches charge near pH 6)'],
        ].map(([bg, label, detail], i) =>
          React.createElement('div', { key: i, className: 'legend-row' },
            React.createElement('span', { className: 'legend-swatch-field', style: { background: bg } }),
            React.createElement('span', { className: 'legend-label' }, label),
            React.createElement('span', { className: 'legend-detail' }, detail),
          )
        ),
      ),
      // Other visual elements
      React.createElement('div', { className: 'help-section' },
        React.createElement('h3', null, 'Other Elements'),
        React.createElement('div', { className: 'legend-row' },
          React.createElement('span', { className: 'legend-swatch-water' },
            React.createElement('span', { className: 'legend-swatch', style: { backgroundColor: '#4488ff', width: '10px', height: '10px' } }),
            React.createElement('span', { className: 'legend-swatch', style: { backgroundColor: '#ccddff', width: '7px', height: '7px' } }),
            React.createElement('span', { className: 'legend-swatch', style: { backgroundColor: '#ccddff', width: '7px', height: '7px' } }),
          ),
          React.createElement('span', { className: 'legend-label' }, 'Water molecules'),
          React.createElement('span', { className: 'legend-detail' }, 'Orbit polar/charged sidechains'),
        ),
        React.createElement('div', { className: 'legend-row' },
          React.createElement('span', { className: 'legend-swatch', style: { backgroundColor: '#ffdd55', width: '12px', height: '4px', borderRadius: '2px' } }),
          React.createElement('span', { className: 'legend-label' }, '+ / \u2013 symbols'),
          React.createElement('span', { className: 'legend-detail' }, 'Charge indicators floating above charged groups'),
        ),
        React.createElement('div', { className: 'legend-row' },
          React.createElement('span', { className: 'legend-swatch', style: { backgroundColor: '#777', width: '14px', height: '3px', borderRadius: '2px' } }),
          React.createElement('span', { className: 'legend-label' }, 'Bonds'),
          React.createElement('span', { className: 'legend-detail' }, 'Single bonds; double bonds shown as parallel lines'),
        ),
      ),
      React.createElement('button', { className: 'help-close', onClick: onClose }, 'Got it'),
    ),
  );
}

// --- Help Button ---
function HelpButton() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.code === 'Slash' && e.shiftKey) setOpen(o => !o);
      if (e.code === 'Escape' && open) { setOpen(false); e.stopPropagation(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      className: 'help-btn',
      onClick: () => setOpen(true),
      title: 'Controls (Shift+?)',
    }, '?'),
    open && React.createElement(HelpModal, { onClose: () => setOpen(false) }),
  );
}

// --- App Root ---
export function App() {
  const [started, setStarted] = useState(false);

  const handleStart = useCallback(() => {
    setStarted(true);
    GameEvents.emit('gameStart');
  }, []);

  if (!started) {
    return React.createElement(TitleScreen, { onStart: handleStart });
  }

  return React.createElement(React.Fragment, null,
    React.createElement(Palette),
    React.createElement(ChainDisplay),
    React.createElement(InfoPanel),
    React.createElement(HelpButton),
  );
}
