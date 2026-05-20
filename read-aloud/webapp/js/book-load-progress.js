/**
 * Progress UI while PDF text is extracted (overlay + status sidebar).
 */

import { markExtractionPage } from "./extraction-eta.js";
import { isPdfPreparingViewVisible, updatePdfPreparingView } from "./pdf-view-shell.js";

function updateStatusExtract({ page = 0, totalPages = 0, chaptersReady = 0, sectionsReady = 0, done = false }) {
  const block = document.getElementById("pdf-status-extract");
  if (!block) return;

  const eta = markExtractionPage(page, totalPages);
  const pct =
    page > 0 && totalPages > 0
      ? Math.max(1, Math.min(100, Math.round((page / totalPages) * 100)))
      : (eta.pct ?? (totalPages > 0 ? Math.min(100, Math.round((page / totalPages) * 100)) : done ? 100 : 0));
  const show = !done && (totalPages > 0 || page > 0);

  block.hidden = !show;
  if (!show) return;

  const pctEl = document.getElementById("pdf-status-extract-pct");
  const fillEl = document.getElementById("pdf-status-extract-fill");
  const metaEl = document.getElementById("pdf-status-extract-meta");

  if (pctEl) pctEl.textContent = `${pct}%`;
  if (fillEl) fillEl.style.width = `${pct}%`;
  if (metaEl) {
    const pageLine =
      page > 0 ? `Page ${page} of ${totalPages}` : `Scanning ${totalPages} pages…`;
    metaEl.textContent = `${pageLine} · ${eta.label} · ${chaptersReady} chapter${chaptersReady === 1 ? "" : "s"} · ${sectionsReady.toLocaleString()} sections ready`;
  }
}

export function ensureLoadProgressCard(hostId = "flipbook-container") {
  let el = document.getElementById("book-load-progress");
  const host = document.getElementById(hostId);
  if (!el && host) {
    el = document.createElement("div");
    el.id = "book-load-progress";
    el.className = "book-load-progress";
    el.hidden = true;
    el.innerHTML = `
      <div class="book-load-progress-card" role="status" aria-live="polite">
        <div class="book-load-progress-top">
          <strong class="book-load-progress-title">Preparing your novel</strong>
          <span class="book-load-progress-pct" id="book-load-progress-pct">0%</span>
        </div>
        <p class="book-load-progress-msg" id="book-load-progress-msg">Starting…</p>
        <div class="book-load-progress-track" aria-hidden="true">
          <span class="book-load-progress-fill" id="book-load-progress-fill"></span>
        </div>
        <p class="book-load-progress-meta" id="book-load-progress-meta">0 chapters ready</p>
        <p class="book-load-progress-hint">Flip pages in Read mode while we prepare Listen &amp; Advanced.</p>
      </div>
    `;
    host.appendChild(el);
  }
  return el;
}

export function updateLoadProgress({
  page = 0,
  totalPages = 0,
  chaptersReady = 0,
  sectionsReady = 0,
  done = false,
}) {
  const eta = markExtractionPage(page, totalPages);
  const pct =
    page > 0 && totalPages > 0
      ? Math.max(1, Math.min(100, Math.round((page / totalPages) * 100)))
      : (eta.pct ?? (totalPages > 0 ? Math.min(100, Math.round((page / totalPages) * 100)) : done ? 100 : 0));
  const show = !done && (totalPages > 0 || page > 0);

  updateStatusExtract({ page, totalPages, chaptersReady, sectionsReady, done });

  if (!done && (document.body.classList.contains("pdf-text-mode-active") || isPdfPreparingViewVisible())) {
    updatePdfPreparingView({
      mode: window.__pdfReaderMode === "advanced" ? "advanced" : "listen",
      page,
      totalPages,
      chaptersReady,
      sectionsReady,
      extracting: true,
    });
  }

  const root = ensureLoadProgressCard();
  if (!root) return;

  root.hidden = !show;

  const pctEl = document.getElementById("book-load-progress-pct");
  const msgEl = document.getElementById("book-load-progress-msg");
  const fillEl = document.getElementById("book-load-progress-fill");
  const metaEl = document.getElementById("book-load-progress-meta");

  if (pctEl) pctEl.textContent = `${pct}%`;
  if (msgEl) {
    msgEl.textContent =
      page > 0
        ? `Loaded page ${page} of ${totalPages}`
        : `Scanning ${totalPages} pages…`;
  }
  if (fillEl) fillEl.style.width = `${pct}%`;
  if (metaEl) {
    metaEl.textContent = `${eta.label} · ${chaptersReady} chapter${chaptersReady === 1 ? "" : "s"} ready · ${sectionsReady.toLocaleString()} sections`;
  }

  const statusEta = document.getElementById("pdf-status-extract-eta");
  if (statusEta) statusEta.textContent = eta.label;
}

export function hideLoadProgress() {
  const root = document.getElementById("book-load-progress");
  if (root) root.hidden = true;
  const block = document.getElementById("pdf-status-extract");
  if (block) block.hidden = true;
}
