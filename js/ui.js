// ============================================================
// ui.js — React UI: title screen, palette, chain display, info
// ============================================================

import { BIOMES, CAT, CAT_COLORS, CATEGORIES, BIOMES_BY_CATEGORY, BIOME_BY_LETTER, STATION_ORDER } from './constants.js';
import { SCENES } from './scenes.js';

const { useState, useEffect, useCallback, useRef } = React;

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
    React.createElement('p', { className: 'subtitle' }, 'Tap amino acids to build your own protein chain'),
    React.createElement('button', { onClick: handleStart, className: 'start-btn' }, 'Start Building'),
    React.createElement('p', { className: 'controls-hint' },
      'Tap to place  |  One-finger drag to orbit  |  Pinch to zoom'
    ),
  );
}

// --- Lessons Button (top-right, opens dropdown) ---
function LessonsButton() {
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    const onLoaded = (data) => { setActiveId(data.scene.id); setOpen(false); };
    GameEvents.on('sceneLoaded', onLoaded);
    return () => GameEvents.off('sceneLoaded', onLoaded);
  }, []);

  const handleLoad = (id) => {
    GameEvents.emit('loadScene', { id });
  };

  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      className: 'lessons-btn',
      onClick: () => setOpen(o => !o),
      title: 'Lessons',
    }, '\u{1F4D6}'),
    open && React.createElement('div', {
      className: 'lessons-dropdown',
    },
      React.createElement('div', { className: 'lessons-dropdown-title' }, 'Lessons'),
      ...SCENES.map(sc =>
        React.createElement('button', {
          key: sc.id,
          className: 'lesson-item' + (activeId === sc.id ? ' active' : ''),
          onClick: () => handleLoad(sc.id),
        }, sc.name)
      ),
    ),
  );
}

// --- Category short labels for tabs ---
const CAT_TAB_LABELS = {
  [CAT.POSITIVE]:    '+Chg',
  [CAT.NEGATIVE]:    '\u2013Chg',
  [CAT.HYDROPHOBIC]: 'Hydro',
  [CAT.AROMATIC]:    'Arom',
  [CAT.POLAR]:       'Polar',
  [CAT.SPECIAL]:     'Spec',
};

// --- Palette (fixed bottom bar with category tabs) ---
function Palette() {
  const [selected, setSelected] = useState(null);
  const [activeCat, setActiveCat] = useState(CATEGORIES[0].key);

  useEffect(() => {
    const onSel = (data) => {
      setSelected(data.letter);
      // Switch to the category of the selected AA
      if (data.letter) {
        const biome = BIOME_BY_LETTER[data.letter];
        if (biome) setActiveCat(biome.category);
      }
    };
    GameEvents.on('selectionChanged', onSel);
    return () => GameEvents.off('selectionChanged', onSel);
  }, []);

  const handleClick = (letter) => {
    GameEvents.emit('selectAA', { letter });
  };

  const items = BIOMES_BY_CATEGORY[activeCat] || [];

  return React.createElement('div', { className: 'palette' },
    // AA buttons for active category
    React.createElement('div', { className: 'palette-items' },
      ...items.map(biome =>
        React.createElement('button', {
          key: biome.letter,
          className: 'palette-item' + (selected === biome.letter ? ' selected' : ''),
          style: {
            borderColor: selected === biome.letter ? CAT_COLORS[activeCat] : 'transparent',
          },
          onClick: () => handleClick(biome.letter),
        },
          React.createElement('span', { className: 'palette-letter' }, biome.letter),
          React.createElement('span', { className: 'palette-name' }, biome.code3),
        )
      ),
    ),
    // Category tabs
    React.createElement('div', { className: 'palette-tabs' },
      ...CATEGORIES.map(cat =>
        React.createElement('button', {
          key: cat.key,
          className: 'palette-tab' + (activeCat === cat.key ? ' active' : ''),
          style: activeCat === cat.key ? { color: CAT_COLORS[cat.key] } : {},
          onClick: () => setActiveCat(cat.key),
        }, CAT_TAB_LABELS[cat.key])
      ),
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

// --- Info Panel (compact toast — only for placed AA focus + scene load) ---
function InfoPanel() {
  const [letter, setLetter] = useState(null);
  const [sceneInfo, setSceneInfo] = useState(null);

  useEffect(() => {
    // Don't show on palette selection — only on placed-AA focus and scene load
    const onFocus = (data) => {
      if (data.letter) { setLetter(data.letter); setSceneInfo(null); }
      else { setLetter(null); }
    };
    const onScene = (data) => { setSceneInfo(data.scene); setLetter(null); };
    GameEvents.on('focusEntry', onFocus);
    GameEvents.on('sceneLoaded', onScene);
    return () => {
      GameEvents.off('focusEntry', onFocus);
      GameEvents.off('sceneLoaded', onScene);
    };
  }, []);

  const handleClose = () => {
    setLetter(null);
    setSceneInfo(null);
  };

  // Scene description
  if (sceneInfo) {
    return React.createElement('div', { className: 'info-toast' },
      React.createElement('span', { className: 'info-toast-text' },
        React.createElement('strong', null, sceneInfo.name),
        ' \u2014 ',
        sceneInfo.description,
      ),
      React.createElement('button', { className: 'info-toast-close', onClick: handleClose }, '\u00D7'),
    );
  }

  // AA info
  if (!letter) return null;
  const b = BIOME_BY_LETTER[letter];
  if (!b) return null;

  return React.createElement('div', { className: 'info-toast' },
    React.createElement('span', { className: 'info-toast-text' },
      React.createElement('strong', null, `${b.name} (${b.letter})`),
      ' \u2014 ',
      b.oneLiner,
    ),
    React.createElement('button', { className: 'info-toast-close', onClick: handleClose }, '\u00D7'),
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
      React.createElement('h2', null, 'Touch Controls'),
      section('Camera', [
        ['One-finger drag', 'Orbit around scene'],
        ['Two-finger drag', 'Pan camera'],
        ['Pinch', 'Zoom in / out'],
      ]),
      section('Building', [
        ['Tap palette item', 'Select amino acid'],
        ['Tap on grid', 'Place selected amino acid'],
      ]),
      section('Editing', [
        ['Tap placed residue', 'Select it (shows info + actions)'],
        ['Drag placed residue', 'Move it to a new cell'],
        ['Delete button', 'Remove selected residue'],
        ['Undo button', 'Remove last placed residue'],
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
      title: 'Controls',
    }, '?'),
    open && React.createElement(HelpModal, { onClose: () => setOpen(false) }),
  );
}

// --- Reset View Button (appears after camera has been focused on an AA) ---
function ResetViewButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onFocus = (data) => {
      if (data.index != null) setVisible(true);
    };
    const onReset = () => setVisible(false);
    GameEvents.on('focusEntry', onFocus);
    GameEvents.on('cameraReset', onReset);
    return () => {
      GameEvents.off('focusEntry', onFocus);
      GameEvents.off('cameraReset', onReset);
    };
  }, []);

  if (!visible) return null;

  return React.createElement('button', {
    className: 'reset-view-btn',
    onClick: () => GameEvents.emit('resetView'),
  }, '\u2302');
}

// --- Action Bar (floating buttons for delete/undo/deselect) ---
function ActionBar() {
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const onFocus = (data) => {
      setFocused(data.index !== null && data.index !== undefined);
    };
    GameEvents.on('focusEntry', onFocus);
    return () => GameEvents.off('focusEntry', onFocus);
  }, []);

  if (!focused) return null;

  return React.createElement('div', { className: 'action-bar' },
    React.createElement('button', {
      className: 'action-btn delete',
      onClick: () => GameEvents.emit('deleteEntry'),
      title: 'Delete selected',
    }, '\u2715'),
    React.createElement('button', {
      className: 'action-btn',
      onClick: () => GameEvents.emit('undoLast'),
      title: 'Undo last',
    }, '\u21A9'),
    React.createElement('button', {
      className: 'action-btn',
      onClick: () => GameEvents.emit('deselect'),
      title: 'Deselect',
    }, '\u2190'),
  );
}

// --- App Root ---
export function App() {
  const [started, setStarted] = useState(false);
  const [faded, setFaded] = useState(false);
  const uiRef = useRef(null);

  const handleStart = useCallback(() => {
    setStarted(true);
    GameEvents.emit('gameStart');
  }, []);

  // Listen for camera gesture start/end to fade UI
  useEffect(() => {
    const onGestureStart = () => setFaded(true);
    const onGestureEnd = () => setFaded(false);
    GameEvents.on('cameraGestureStart', onGestureStart);
    GameEvents.on('cameraGestureEnd', onGestureEnd);
    return () => {
      GameEvents.off('cameraGestureStart', onGestureStart);
      GameEvents.off('cameraGestureEnd', onGestureEnd);
    };
  }, []);

  if (!started) {
    return React.createElement(TitleScreen, { onStart: handleStart });
  }

  return React.createElement('div', {
    ref: uiRef,
    className: faded ? 'ui-faded' : '',
    style: { display: 'contents' },
  },
    React.createElement(Palette),
    React.createElement(ChainDisplay),
    React.createElement(InfoPanel),
    React.createElement(LessonsButton),
    React.createElement(HelpButton),
    React.createElement(ResetViewButton),
    React.createElement(ActionBar),
  );
}
