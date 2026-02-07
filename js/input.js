// ============================================================
// input.js — Mouse/keyboard handling for sandbox builder
// ============================================================

import { updateHover, getHoveredCell, setHighlightValid, setDragMode } from './grid3d.js';
import { placeAminoAcid, removeLastAminoAcid, removeAminoAcid, isOccupied, getSequence, getChainLength, getChain, getEntryAt, moveAminoAcid } from './chain.js';
import { setRotamer } from './structures3d.js';
import { cycleRotamer, getRotamerIndex, getRotamerCount } from './rotamers.js';
import { GameEvents } from './ui.js';
import { getCanvas } from './renderer3d.js';

let selectedAA = null;    // letter selected in palette
let paletteDrag = null;   // letter being dragged from palette
let gridDrag = null;      // { chainIndex, originCol, originRow, startX, startY }
let focusedIndex = null;  // chain index of clicked placed AA (for arrow rotation)

const DRAG_THRESHOLD = 5; // px movement before it counts as a drag
const ROTATE_STEP = Math.PI / 12; // 15 degrees per arrow press

// --- Listen for palette selection (click) ---
GameEvents.on('selectAA', (data) => {
  selectedAA = data.letter;
  GameEvents.emit('selectionChanged', { letter: selectedAA });
});

// --- Listen for drag start from palette ---
GameEvents.on('startDrag', (data) => {
  paletteDrag = data.letter;
  selectedAA = data.letter;
  GameEvents.emit('selectionChanged', { letter: selectedAA });
});

// --- Place helper ---
function tryPlace(letter) {
  const cell = getHoveredCell();
  if (!cell) return false;
  if (isOccupied(cell.col, cell.row)) return false;

  const entry = placeAminoAcid(letter, cell.col, cell.row);
  if (entry) {
    GameEvents.emit('chainChanged', {
      sequence: getSequence(),
      length: getChainLength(),
    });
    return true;
  }
  return false;
}

// --- Mousedown on canvas: prepare for click or drag on placed AA ---
function onMouseDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('#ui-root')) return;

  const cell = getHoveredCell();
  if (!cell) return;

  const idx = getEntryAt(cell.col, cell.row);
  if (idx !== null) {
    gridDrag = {
      chainIndex: idx,
      originCol: cell.col,
      originRow: cell.row,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
    };
    e.preventDefault();
  }
}

function onMouseMove(e) {
  if (!gridDrag || gridDrag.moved) return;
  const dx = e.clientX - gridDrag.startX;
  const dy = e.clientY - gridDrag.startY;
  if (dx * dx + dy * dy > DRAG_THRESHOLD * DRAG_THRESHOLD) {
    gridDrag.moved = true;
    setDragMode(true);
  }
}

// --- Click to place (when AA selected, no drag active) ---
function onClick(e) {
  if (e.button !== 0) return;
  if (e.target.closest('#ui-root')) return;
  if (paletteDrag || gridDrag) return;
  if (!selectedAA) return;

  tryPlace(selectedAA);
}

// --- Mouse up: end drag or select placed AA ---
function onMouseUp(e) {
  if (gridDrag) {
    if (gridDrag.moved) {
      // Was a drag — try to move
      const cell = getHoveredCell();
      if (cell && !(cell.col === gridDrag.originCol && cell.row === gridDrag.originRow)) {
        if (moveAminoAcid(gridDrag.chainIndex, cell.col, cell.row)) {
          GameEvents.emit('chainChanged', {
            sequence: getSequence(),
            length: getChainLength(),
          });
        }
      }
    } else {
      // Was a click — select this AA for rotation + show info
      focusedIndex = gridDrag.chainIndex;
      const focusedEntry = getChain()[focusedIndex];
      GameEvents.emit('focusEntry', { index: focusedIndex, letter: focusedEntry.letter });
    }
    setDragMode(false);
    gridDrag = null;
    return;
  }

  if (paletteDrag) {
    const letter = paletteDrag;
    paletteDrag = null;
    if (e.target.closest('#ui-root')) return;
    tryPlace(letter);
    return;
  }
}

// --- Keyboard ---
function onKeyDown(e) {
  // Arrow keys → rotate focused placed AA
  if (focusedIndex !== null) {
    const ch = getChain();
    if (focusedIndex >= 0 && focusedIndex < ch.length) {
      const entry = ch[focusedIndex];
      if (e.code === 'ArrowLeft') {
        e.preventDefault();
        entry.group.rotation.y += ROTATE_STEP;
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        entry.group.rotation.y -= ROTATE_STEP;
      } else if (e.code === 'ArrowUp') {
        e.preventDefault();
        entry.group.rotation.x += ROTATE_STEP;
      } else if (e.code === 'ArrowDown') {
        e.preventDefault();
        entry.group.rotation.x -= ROTATE_STEP;
      }
    }
  }

  // Backspace / X → delete focused AA
  if (focusedIndex !== null && (e.code === 'Backspace' || e.code === 'KeyX')) {
    e.preventDefault();
    const removed = removeAminoAcid(focusedIndex);
    if (removed) {
      focusedIndex = null;
      GameEvents.emit('focusEntry', { index: null });
      GameEvents.emit('chainChanged', {
        sequence: getSequence(),
        length: getChainLength(),
      });
    }
    return;
  }

  // Ctrl+Z / Cmd+Z / Delete → undo (remove last)
  if ((e.ctrlKey && e.code === 'KeyZ') || (e.metaKey && e.code === 'KeyZ') || e.code === 'Delete') {
    e.preventDefault();
    const removed = removeLastAminoAcid();
    if (removed) {
      focusedIndex = null;
      GameEvents.emit('chainChanged', {
        sequence: getSequence(),
        length: getChainLength(),
      });
    }
  }

  // Escape → deselect / unfocus
  if (e.code === 'Escape') {
    if (focusedIndex !== null) {
      focusedIndex = null;
      GameEvents.emit('focusEntry', { index: null });
    } else {
      selectedAA = null;
      paletteDrag = null;
      gridDrag = null;
      GameEvents.emit('selectionChanged', { letter: null });
    }
  }

  // R → cycle rotamer on focused or last placed structure
  if (e.code === 'KeyR') {
    const ch = getChain();
    const targetIdx = focusedIndex !== null ? focusedIndex : ch.length - 1;
    if (targetIdx >= 0 && targetIdx < ch.length) {
      const entry = ch[targetIdx];
      const count = getRotamerCount(entry.letter);
      if (count > 0) {
        const idx = cycleRotamer(entry.letter);
        setRotamer(entry.letter, idx, entry.refKey);
      }
    }
  }
}

// --- Per-frame hover update ---
export function updateInput() {
  updateHover();
  const cell = getHoveredCell();
  const active = paletteDrag || (gridDrag && gridDrag.moved) || selectedAA;
  if (cell && active) {
    if (gridDrag && gridDrag.moved) {
      const sameCell = cell.col === gridDrag.originCol && cell.row === gridDrag.originRow;
      setHighlightValid(sameCell || !isOccupied(cell.col, cell.row));
    } else {
      setHighlightValid(!isOccupied(cell.col, cell.row));
    }
  }
}

// --- Init ---
export function initInput() {
  const canvas = getCanvas();
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('click', onClick);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);
}

export function getSelectedAA() {
  return selectedAA;
}
