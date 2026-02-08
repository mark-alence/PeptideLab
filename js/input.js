// ============================================================
// input.js — Mouse/keyboard/touch handling for sandbox builder
// ============================================================

import { updateHover, getHoveredCell, setHighlightValid, setDragMode, updatePointerCoords, hideHighlight } from './grid3d.js';
import { placeAminoAcid, removeLastAminoAcid, removeAminoAcid, isOccupied, getSequence, getChainLength, getChain, getEntryAt, moveAminoAcid } from './chain.js';
import { setRotamer } from './structures3d.js';
import { cycleRotamer, getRotamerIndex, getRotamerCount } from './rotamers.js';
import { GameEvents } from './ui.js';
import { getCanvas, controls } from './renderer3d.js';

let selectedAA = null;    // letter selected in palette
let paletteDrag = null;   // letter being dragged from palette
let gridDrag = null;      // { chainIndex, originCol, originRow, startX, startY }
let focusedIndex = null;  // chain index of clicked placed AA (for arrow rotation)
let canvasPointerDown = false; // true while mouse/touch is active on canvas

const DRAG_THRESHOLD = 5; // px movement before it counts as a drag
const ROTATE_STEP = Math.PI / 12; // 15 degrees per arrow press

// --- Touch constants ---
const TOUCH_DRAG_THRESHOLD = 10; // px
const TAP_TIME_LIMIT = 250;      // ms

// --- Touch state ---
let touchState = null; // { id, startX, startY, startTime, moved, isPlacedAA, chainIndex, originCol, originRow }

// --- Listen for palette selection (click/tap) ---
GameEvents.on('selectAA', (data) => {
  selectedAA = data.letter;
  GameEvents.emit('selectionChanged', { letter: selectedAA });
});

// --- Listen for delete/undo from ActionBar ---
GameEvents.on('deleteEntry', () => {
  if (focusedIndex !== null) {
    const removed = removeAminoAcid(focusedIndex);
    if (removed) {
      focusedIndex = null;
      GameEvents.emit('focusEntry', { index: null });
      GameEvents.emit('chainChanged', {
        sequence: getSequence(),
        length: getChainLength(),
      });
    }
  }
});

GameEvents.on('undoLast', () => {
  const removed = removeLastAminoAcid();
  if (removed) {
    focusedIndex = null;
    GameEvents.emit('chainChanged', {
      sequence: getSequence(),
      length: getChainLength(),
    });
  }
});

GameEvents.on('deselect', () => {
  if (focusedIndex !== null) {
    focusedIndex = null;
    GameEvents.emit('focusEntry', { index: null });
  } else {
    selectedAA = null;
    GameEvents.emit('selectionChanged', { letter: null });
  }
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
    // Haptic feedback on successful placement
    if (navigator.vibrate) navigator.vibrate(15);
    // Deselect after placing so user must pick again
    selectedAA = null;
    GameEvents.emit('selectionChanged', { letter: null });
    return true;
  }
  return false;
}

// --- Mousedown on canvas: prepare for click or drag on placed AA ---
function onMouseDown(e) {
  if (e.button !== 0) return;
  if (e.target.closest('#ui-root')) return;
  canvasPointerDown = true;

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
    setDragMode(true); controls.enabled = false;
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
  canvasPointerDown = false;
  if (gridDrag) {
    if (gridDrag.moved) {
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
      focusedIndex = gridDrag.chainIndex;
      const focusedEntry = getChain()[focusedIndex];
      GameEvents.emit('focusEntry', { index: focusedIndex, letter: focusedEntry.letter });
    }
    setDragMode(false); controls.enabled = true;
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

// ============================================================
// Touch handlers
// ============================================================

function onTouchStart(e) {
  // Only handle single-finger touches; multi-finger → let OrbitControls handle
  if (e.touches.length !== 1) {
    touchState = null;
    canvasPointerDown = false;
    return;
  }

  canvasPointerDown = true;
  const touch = e.touches[0];
  updatePointerCoords(touch.clientX, touch.clientY);
  updateHover();

  const cell = getHoveredCell();
  let isPlacedAA = false;
  let chainIndex = null;
  let originCol = null;
  let originRow = null;

  if (cell) {
    const idx = getEntryAt(cell.col, cell.row);
    if (idx !== null) {
      isPlacedAA = true;
      chainIndex = idx;
      originCol = cell.col;
      originRow = cell.row;
    }
  }

  touchState = {
    id: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    startTime: performance.now(),
    moved: false,
    isPlacedAA,
    chainIndex,
    originCol,
    originRow,
  };
}

function onTouchMove(e) {
  if (!touchState) return;
  if (e.touches.length !== 1) {
    // Multi-finger started — abandon touch state
    if (touchState.moved && touchState.isPlacedAA) {
      setDragMode(false); controls.enabled = true;
    }
    touchState = null;
    return;
  }

  const touch = e.touches[0];
  if (touch.identifier !== touchState.id) return;

  const dx = touch.clientX - touchState.startX;
  const dy = touch.clientY - touchState.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);

  if (!touchState.moved && dist > TOUCH_DRAG_THRESHOLD) {
    touchState.moved = true;
    if (touchState.isPlacedAA) {
      // Enter grid drag mode for this placed AA
      setDragMode(true); controls.enabled = false;
    }
    // If not on a placed AA, movement means orbit — OrbitControls handles it
  }

  if (touchState.moved && touchState.isPlacedAA) {
    // Update raycast for grid drag
    updatePointerCoords(touch.clientX, touch.clientY);
    updateHover();
  }
}

function onTouchEnd(e) {
  canvasPointerDown = false;
  if (!touchState) return;

  // Find the ended touch
  let ended = null;
  for (let i = 0; i < e.changedTouches.length; i++) {
    if (e.changedTouches[i].identifier === touchState.id) {
      ended = e.changedTouches[i];
      break;
    }
  }
  if (!ended) return;

  const elapsed = performance.now() - touchState.startTime;
  const dx = ended.clientX - touchState.startX;
  const dy = ended.clientY - touchState.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const isTap = dist < TOUCH_DRAG_THRESHOLD && elapsed < TAP_TIME_LIMIT;

  if (isTap) {
    // Update coords for final position
    updatePointerCoords(ended.clientX, ended.clientY);
    updateHover();

    if (touchState.isPlacedAA) {
      // Tap on placed AA → select/focus it
      focusedIndex = touchState.chainIndex;
      const focusedEntry = getChain()[focusedIndex];
      GameEvents.emit('focusEntry', { index: focusedIndex, letter: focusedEntry.letter });
    } else if (selectedAA) {
      // Tap on empty grid → place selected AA
      tryPlace(selectedAA);
    }
  } else if (touchState.moved && touchState.isPlacedAA) {
    // Drag ended on a placed AA → try to move it
    updatePointerCoords(ended.clientX, ended.clientY);
    updateHover();
    const cell = getHoveredCell();
    if (cell && !(cell.col === touchState.originCol && cell.row === touchState.originRow)) {
      if (moveAminoAcid(touchState.chainIndex, cell.col, cell.row)) {
        if (navigator.vibrate) navigator.vibrate(15);
        GameEvents.emit('chainChanged', {
          sequence: getSequence(),
          length: getChainLength(),
        });
      }
    }
    setDragMode(false); controls.enabled = true;
  }

  touchState = null;
}

function onTouchCancel() {
  canvasPointerDown = false;
  if (touchState && touchState.moved && touchState.isPlacedAA) {
    setDragMode(false); controls.enabled = true;
  }
  touchState = null;
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
  const isDragging = (gridDrag && gridDrag.moved) || (touchState && touchState.moved && touchState.isPlacedAA);

  // Only show highlight when pointer is actively on canvas AND there's something to place/drag
  if (!canvasPointerDown && !isDragging) {
    hideHighlight();
    return;
  }

  updateHover();
  const cell = getHoveredCell();
  if (!cell || (!selectedAA && !paletteDrag && !isDragging)) {
    hideHighlight();
    return;
  }

  if (isDragging) {
    const originCol = gridDrag ? gridDrag.originCol : touchState.originCol;
    const originRow = gridDrag ? gridDrag.originRow : touchState.originRow;
    const sameCell = cell.col === originCol && cell.row === originRow;
    setHighlightValid(sameCell || !isOccupied(cell.col, cell.row));
  } else {
    setHighlightValid(!isOccupied(cell.col, cell.row));
  }
}

// --- Init ---
export function initInput() {
  const canvas = getCanvas();

  // Mouse events (still work on desktop)
  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('click', onClick);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
  window.addEventListener('keydown', onKeyDown);

  // Touch events — passive so OrbitControls receives them too
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchmove', onTouchMove, { passive: true });
  canvas.addEventListener('touchend', onTouchEnd, { passive: true });
  canvas.addEventListener('touchcancel', onTouchCancel, { passive: true });
}

export function getSelectedAA() {
  return selectedAA;
}
