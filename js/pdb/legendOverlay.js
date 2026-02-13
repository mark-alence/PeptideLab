// ============================================================
// legendOverlay.js — AI-driven legend overlay for the PDB viewer
// Shows color-to-meaning mappings when the AI changes visualization.
// ============================================================

export function createLegendOverlay(container) {
  const el = document.createElement('div');
  el.className = 'viewer-legend';
  el.style.display = 'none';
  container.appendChild(el);

  return {
    update({ title, entries, representation }) {
      let html = '';
      if (representation) {
        html += `<div class="legend-rep">${escapeHtml(representation)}</div>`;
      }
      html += `<div class="legend-title">${escapeHtml(title)}</div>`;
      for (const { color, label } of entries) {
        html += `<div class="legend-entry">` +
          `<span class="legend-swatch" style="background:${escapeHtml(color)}"></span>` +
          `<span class="legend-label">${escapeHtml(label)}</span>` +
          `</div>`;
      }
      el.innerHTML = html;
      el.style.display = '';
    },
    hide() {
      el.style.display = 'none';
    },
    dispose() {
      el.remove();
    },
  };
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
