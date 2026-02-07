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
    React.createElement('p', { className: 'subtitle' }, 'Build your own protein chain'),
    React.createElement('button', { onClick: handleStart, className: 'start-btn' }, 'Start Building'),
    React.createElement('p', { className: 'controls-hint' },
      'Right-drag to orbit  |  Middle-drag to pan  |  Scroll to zoom  |  Ctrl+Z to undo'
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
  );
}
