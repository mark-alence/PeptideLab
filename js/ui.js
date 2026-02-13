// ============================================================
// ui.js — React UI: title screen, palette, chain display, info
// ============================================================

import { BIOMES, CAT, CAT_COLORS, CATEGORIES, BIOMES_BY_CATEGORY, BIOME_BY_LETTER } from './constants.js';
import { SCENES } from './scenes.js';
import { PDBConsole } from './pdb/console.js';

const { useState, useEffect, useCallback, useRef } = React;

const isMobile = window.matchMedia('(max-width: 768px)').matches;

// --- Event Bus ---
export const GameEvents = {
  _listeners: {},
  on(event, fn)  { (this._listeners[event] ||= []).push(fn); },
  off(event, fn) { this._listeners[event] = (this._listeners[event] || []).filter(f => f !== fn); },
  emit(event, data) { (this._listeners[event] || []).forEach(fn => fn(data)); },
};

// --- Title Screen ---
function TitleScreen({ onStart, onOpenViewer }) {
  const [fade, setFade] = useState(false);
  const [pdbId, setPdbId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef(null);

  const handleStart = () => {
    setFade(true);
    setTimeout(onStart, 600);
  };

  // Load PDB text into viewer mode
  const loadPDB = (pdbText, name) => {
    setFade(true);
    setTimeout(() => onOpenViewer(pdbText, name), 600);
  };

  // Fetch from RCSB by ID
  const handleFetchPDB = async () => {
    const id = pdbId.trim().toUpperCase();
    if (!id || id.length !== 4) {
      setError('Enter a 4-character PDB ID (e.g. 1CRN)');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const url = `https://files.rcsb.org/download/${id}.pdb`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`PDB ID "${id}" not found`);
      const text = await resp.text();
      loadPDB(text, id);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleFetchPDB();
  };

  // Load example (crambin)
  const handleExample = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('https://files.rcsb.org/download/1CRN.pdb');
      if (!resp.ok) throw new Error('Failed to fetch example');
      const text = await resp.text();
      loadPDB(text, '1CRN');
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // File upload handling
  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadPDB(reader.result, file.name);
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => setDragOver(false);

  const handleFileInput = (e) => {
    handleFile(e.target.files[0]);
  };

  const subtitle = isMobile
    ? 'Tap amino acids to build your own protein chain'
    : 'Drag & drop amino acids to build your own protein chain';

  const hints = isMobile
    ? 'Tap to place  |  One-finger drag to orbit  |  Pinch to zoom'
    : 'Right-drag to orbit  |  Scroll to zoom  |  Ctrl+Z to undo';

  return React.createElement('div', {
    className: 'title-screen' + (fade ? ' fade-out' : ''),
  },
    React.createElement('h1', null, 'PeptideLab'),
    React.createElement('p', { className: 'subtitle' }, subtitle),
    React.createElement('button', { onClick: handleStart, className: 'start-btn' }, 'Start Building'),

    // Divider
    React.createElement('div', { className: 'title-divider' },
      React.createElement('span', null, 'or'),
    ),

    // PDB Viewer section
    React.createElement('div', { className: 'pdb-open-section' },
      // Drop zone
      React.createElement('div', {
        className: 'pdb-drop-zone' + (dragOver ? ' drag-over' : ''),
        onDrop: handleDrop,
        onDragOver: handleDragOver,
        onDragLeave: handleDragLeave,
        onClick: () => fileInputRef.current?.click(),
      },
        React.createElement('span', { className: 'pdb-drop-icon' }, '\u{1F4C2}'),
        React.createElement('span', { className: 'pdb-drop-text' },
          dragOver ? 'Drop PDB file here' : 'Open PDB File'
        ),
        React.createElement('input', {
          ref: fileInputRef,
          type: 'file',
          accept: '.pdb,.ent,.pdb1',
          style: { display: 'none' },
          onChange: handleFileInput,
        }),
      ),

      // PDB ID input
      React.createElement('div', { className: 'pdb-fetch-row' },
        React.createElement('input', {
          type: 'text',
          className: 'pdb-id-input',
          placeholder: 'PDB ID (e.g. 1CRN)',
          value: pdbId,
          maxLength: 4,
          onChange: (e) => setPdbId(e.target.value.toUpperCase()),
          onKeyDown: handleKeyDown,
          disabled: loading,
        }),
        React.createElement('button', {
          className: 'pdb-fetch-btn',
          onClick: handleFetchPDB,
          disabled: loading,
        }, loading ? 'Loading...' : 'Fetch'),
      ),

      // Example button
      React.createElement('button', {
        className: 'pdb-example-btn',
        onClick: handleExample,
        disabled: loading,
      }, 'Load Example (Crambin)'),

      // Error display
      error && React.createElement('p', { className: 'pdb-error' }, error),
    ),

    React.createElement('p', { className: 'controls-hint' }, hints),
  );
}

// ============================================================
// Desktop Components
// ============================================================

// --- Lessons (desktop: in sidebar) ---
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

// --- Palette (desktop: left sidebar) ---
function DesktopPalette() {
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

// --- Info Panel (desktop: full card) ---
function DesktopInfoPanel() {
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

  if (sceneInfo) {
    return React.createElement('div', { className: 'info-panel' },
      React.createElement('div', { className: 'info-header' },
        React.createElement('h2', null, sceneInfo.name),
      ),
      React.createElement('p', { className: 'info-oneliner' }, sceneInfo.description),
      React.createElement('div', { className: 'info-hint' }, 'Click an amino acid to see its properties'),
    );
  }

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

// --- Desktop Help Modal ---
function DesktopHelpModal({ onClose }) {
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

// ============================================================
// Mobile Components
// ============================================================

// --- Category tab labels ---
const CAT_TAB_LABELS = {
  [CAT.POSITIVE]:    '+Chg',
  [CAT.NEGATIVE]:    '\u2013Chg',
  [CAT.HYDROPHOBIC]: 'Hydro',
  [CAT.AROMATIC]:    'Arom',
  [CAT.POLAR]:       'Polar',
  [CAT.SPECIAL]:     'Spec',
};

// --- Mobile Palette (bottom bar with category tabs) ---
function MobilePalette() {
  const [selected, setSelected] = useState(null);
  const [activeCat, setActiveCat] = useState(CATEGORIES[0].key);

  useEffect(() => {
    const onSel = (data) => {
      setSelected(data.letter);
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

// --- Lessons Button (mobile: standalone dropdown) ---
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

// --- Info Toast (mobile: compact one-line) ---
function MobileInfoPanel() {
  const [letter, setLetter] = useState(null);
  const [sceneInfo, setSceneInfo] = useState(null);

  useEffect(() => {
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

// --- Mobile Help Modal ---
function MobileHelpModal({ onClose }) {
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

// --- Reset View Button ---
function ResetViewButton() {
  return React.createElement('button', {
    className: 'reset-view-btn',
    onClick: () => GameEvents.emit('resetView'),
    title: 'Reset camera view',
  }, '\u2302');
}

// --- Action Bar (mobile: floating delete/undo/deselect) ---
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

// ============================================================
// Shared Components
// ============================================================

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

  const HelpModal = isMobile ? MobileHelpModal : DesktopHelpModal;

  return React.createElement(React.Fragment, null,
    React.createElement('button', {
      className: 'help-btn',
      onClick: () => setOpen(true),
      title: 'Controls (Shift+?)',
    }, '?'),
    open && React.createElement(HelpModal, { onClose: () => setOpen(false) }),
  );
}

// ============================================================
// Viewer Mode Components
// ============================================================

// --- Viewer Info Bar (top bar showing protein stats + quality toggle) ---
function ViewerInfoBar({ info, name, onBack, quality, onQualityChange }) {
  if (!info) return null;
  const qualityLevels = ['off', 'low', 'high'];
  return React.createElement('div', { className: 'viewer-info-bar' },
    React.createElement('button', {
      className: 'viewer-back-btn',
      onClick: onBack,
      title: 'Back to title',
    }, '\u2190'),
    React.createElement('span', { className: 'viewer-name' }, name || 'PDB Viewer'),
    React.createElement('span', { className: 'viewer-stats' },
      `${info.atomCount.toLocaleString()} atoms \u00B7 ${info.residueCount} residues \u00B7 ${info.chainCount} chain${info.chainCount !== 1 ? 's' : ''}`
    ),
    React.createElement('div', { className: 'viewer-quality-toggle' },
      React.createElement('span', { className: 'viewer-quality-label' }, 'FX'),
      ...qualityLevels.map(q =>
        React.createElement('button', {
          key: q,
          className: 'viewer-quality-btn' + (quality === q ? ' active' : ''),
          onClick: () => onQualityChange(q),
          title: q === 'off' ? 'No post-processing' : q === 'low' ? 'SSAO + Bloom (balanced)' : 'SSAO + Bloom (full quality)',
        }, q.charAt(0).toUpperCase() + q.slice(1))
      ),
    ),
  );
}

// --- Viewer Error Toast ---
function ViewerError({ message }) {
  if (!message) return null;
  return React.createElement('div', { className: 'viewer-error-toast' }, message);
}

// --- Representation Toolbar (viewer mode) ---
const REP_BUTTONS = [
  { key: 'ball_and_stick', label: 'Ball&Stick' },
  { key: 'spacefill',      label: 'Spacefill' },
  { key: 'sticks',         label: 'Sticks' },
  { key: 'cartoon',        label: 'Cartoon' },
  { key: 'lines',          label: 'Lines' },
];

function RepToolbar({ currentRep, onRepChange, consoleVisible }) {
  return React.createElement('div', {
    className: 'rep-toolbar' + (consoleVisible ? ' console-open' : ''),
  },
    ...REP_BUTTONS.map(btn =>
      React.createElement('button', {
        key: btn.key,
        className: 'rep-btn' + (currentRep === btn.key ? ' active' : ''),
        onClick: () => onRepChange(btn.key),
      }, btn.label)
    ),
  );
}

// --- Load Structure Button (viewer mode: add additional structures) ---
function LoadStructureButton() {
  const [open, setOpen] = useState(false);
  const [pdbId, setPdbId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const popoverRef = useRef(null);
  const fileInputRef = useRef(null);

  // Close popover when clicking outside
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const handleFetch = async () => {
    const id = pdbId.trim().toUpperCase();
    if (!id || id.length !== 4) {
      setError('Enter a 4-character PDB ID');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const url = `https://files.rcsb.org/download/${id}.pdb`;
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`PDB ID "${id}" not found`);
      const text = await resp.text();
      GameEvents.emit('loadAdditionalStructure', { pdbText: text, name: id });
      setPdbId('');
      setOpen(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFile = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      GameEvents.emit('loadAdditionalStructure', { pdbText: reader.result, name: file.name.replace(/\.(pdb|ent|pdb1)$/i, '') });
      setOpen(false);
    };
    reader.onerror = () => setError('Failed to read file');
    reader.readAsText(file);
  };

  const handleKeyDown = (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') handleFetch();
    if (e.key === 'Escape') setOpen(false);
  };

  return React.createElement('div', { className: 'load-structure-wrap', ref: popoverRef },
    React.createElement('button', {
      className: 'load-structure-btn',
      onClick: () => setOpen(o => !o),
      title: 'Load additional structure',
    }, '+ Structure'),
    open && React.createElement('div', { className: 'load-structure-popover' },
      React.createElement('div', { className: 'load-structure-title' }, 'Load Structure'),
      React.createElement('div', { className: 'load-structure-row' },
        React.createElement('input', {
          type: 'text',
          className: 'load-structure-input',
          placeholder: 'PDB ID (e.g. 4HHB)',
          value: pdbId,
          maxLength: 4,
          onChange: (e) => setPdbId(e.target.value.toUpperCase()),
          onKeyDown: handleKeyDown,
          disabled: loading,
          autoFocus: true,
        }),
        React.createElement('button', {
          className: 'load-structure-fetch-btn',
          onClick: handleFetch,
          disabled: loading,
        }, loading ? '...' : 'Fetch'),
      ),
      React.createElement('button', {
        className: 'load-structure-file-btn',
        onClick: () => fileInputRef.current?.click(),
      }, 'Open PDB File'),
      React.createElement('input', {
        ref: fileInputRef,
        type: 'file',
        accept: '.pdb,.ent,.pdb1',
        style: { display: 'none' },
        onChange: (e) => handleFile(e.target.files[0]),
      }),
      error && React.createElement('div', { className: 'load-structure-error' }, error),
    ),
  );
}

// --- App Root ---
export function App() {
  // mode: 'title' | 'builder' | 'viewer'
  const [mode, setMode] = useState('title');
  const [faded, setFaded] = useState(false);
  const [viewerInfo, setViewerInfo] = useState(null);
  const [viewerName, setViewerName] = useState('');
  const [viewerError, setViewerError] = useState('');
  const [viewerQuality, setViewerQuality] = useState('low');
  const [consoleVisible, setConsoleVisible] = useState(false);
  const [currentRep, setCurrentRep] = useState('ball_and_stick');
  const [interpreter, setInterpreter] = useState(null);

  const handleStart = useCallback(() => {
    setMode('builder');
    GameEvents.emit('gameStart');
  }, []);

  const handleOpenViewer = useCallback((pdbText, name) => {
    setMode('viewer');
    setViewerName(name || 'Structure');
    setViewerError('');
    setViewerInfo(null);
    GameEvents.emit('enterViewerMode', { pdbText, name: name || 'Structure', quality: viewerQuality });
  }, [viewerQuality]);

  const handleBackToTitle = useCallback(() => {
    GameEvents.emit('exitViewerMode');
    setMode('title');
    setViewerInfo(null);
    setViewerName('');
    setViewerError('');
    setViewerQuality('low');
  }, []);

  const handleQualityChange = useCallback((q) => {
    setViewerQuality(q);
    GameEvents.emit('viewerQuality', { quality: q });
  }, []);

  // Listen for viewer events
  useEffect(() => {
    const onLoaded = (info) => setViewerInfo(info);
    const onError = (data) => setViewerError(data.message);
    const onReady = (data) => { setInterpreter(data.interpreter); };
    const onRepChanged = (data) => setCurrentRep(data.rep);
    GameEvents.on('viewerLoaded', onLoaded);
    GameEvents.on('viewerError', onError);
    GameEvents.on('viewerReady', onReady);
    GameEvents.on('viewerRepChanged', onRepChanged);
    return () => {
      GameEvents.off('viewerLoaded', onLoaded);
      GameEvents.off('viewerError', onError);
      GameEvents.off('viewerReady', onReady);
      GameEvents.off('viewerRepChanged', onRepChanged);
    };
  }, []);

  // Fade UI during camera gestures (mobile)
  useEffect(() => {
    if (!isMobile) return;
    const onGestureStart = () => setFaded(true);
    const onGestureEnd = () => setFaded(false);
    GameEvents.on('cameraGestureStart', onGestureStart);
    GameEvents.on('cameraGestureEnd', onGestureEnd);
    return () => {
      GameEvents.off('cameraGestureStart', onGestureStart);
      GameEvents.off('cameraGestureEnd', onGestureEnd);
    };
  }, []);

  // Backtick key toggles console in viewer mode
  useEffect(() => {
    if (mode !== 'viewer') return;
    const onKey = (e) => {
      if (e.code === 'Backquote' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setConsoleVisible(v => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode]);

  // Reset console state when leaving viewer
  const handleBackToTitleWithConsole = useCallback(() => {
    setConsoleVisible(false);
    setCurrentRep('ball_and_stick');
    setInterpreter(null);
    handleBackToTitle();
  }, [handleBackToTitle]);

  const toggleConsole = useCallback(() => {
    setConsoleVisible(v => !v);
  }, []);

  const handleRepChange = useCallback((rep) => {
    setCurrentRep(rep);
    GameEvents.emit('viewerRepChange', { rep });
  }, []);

  // Title screen
  if (mode === 'title') {
    return React.createElement(TitleScreen, {
      onStart: handleStart,
      onOpenViewer: handleOpenViewer,
    });
  }

  // Viewer mode
  if (mode === 'viewer') {
    return React.createElement(React.Fragment, null,
      React.createElement(ViewerInfoBar, {
        info: viewerInfo,
        name: viewerName,
        onBack: handleBackToTitleWithConsole,
        quality: viewerQuality,
        onQualityChange: handleQualityChange,
      }),
      React.createElement(ViewerError, { message: viewerError }),
      React.createElement(RepToolbar, {
        currentRep,
        onRepChange: handleRepChange,
        consoleVisible,
      }),
      React.createElement(LoadStructureButton),
      React.createElement('button', {
        className: 'console-toggle-btn' + (consoleVisible ? ' console-open' : ''),
        onClick: toggleConsole,
        title: 'Toggle console (`)',
      }, consoleVisible ? 'Close Console' : 'Console `'),
      React.createElement(PDBConsole, {
        visible: consoleVisible,
        interpreter: interpreter,
        onToggle: toggleConsole,
      }),
    );
  }

  // Builder mode
  if (isMobile) {
    return React.createElement('div', {
      className: faded ? 'ui-faded' : '',
      style: { display: 'contents' },
    },
      React.createElement(MobilePalette),
      React.createElement(ChainDisplay),
      React.createElement(MobileInfoPanel),
      React.createElement(LessonsButton),
      React.createElement(HelpButton),
      React.createElement(ResetViewButton),
      React.createElement(ActionBar),
    );
  }

  return React.createElement(React.Fragment, null,
    React.createElement(DesktopPalette),
    React.createElement(ChainDisplay),
    React.createElement(DesktopInfoPanel),
    React.createElement(HelpButton),
    React.createElement(ResetViewButton),
  );
}
