// ============================================================
// engine.js — Game loop
// ============================================================

import { TICK_RATE } from './constants.js';

// --- Game loop ---
let running = false;
let accumulator = 0;
let lastTime = 0;
let updateFn = null;
let renderFn = null;

function frame(timestamp) {
  if (!running) return;
  const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
  lastTime = timestamp;
  accumulator += dt;

  while (accumulator >= TICK_RATE) {
    if (updateFn) updateFn(TICK_RATE);
    accumulator -= TICK_RATE;
  }

  const alpha = accumulator / TICK_RATE;
  if (renderFn) renderFn(alpha);

  requestAnimationFrame(frame);
}

export function startLoop(update, render) {
  updateFn = update;
  renderFn = render;
  running = true;
  lastTime = performance.now();
  requestAnimationFrame(frame);
}

export function stopLoop() {
  running = false;
}
