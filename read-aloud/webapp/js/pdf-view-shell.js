/**
 * Controls DearFlip vs text-mode overlays (Listen / Advanced / preparing).
 */

import { estimateExtractionEta, markExtractionPage } from "./extraction-eta.js";

const PREPARING_ID = "pdf-preparing-view";

export function isPdfPreparingViewVisible() {
  const el = document.getElementById(PREPARING_ID);
  return !!(el && !el.hidden);
}

function displayExtractionPct(page, totalPages, extracting) {
  if (!totalPages || totalPages <= 0) return extracting ? 0 : 100;
  if (page <= 0) return extracting ? 0 : 100;
  // Avoid showing 0% for page 1 of large PDFs (round(1/464*100) === 0).
  return Math.max(1, Math.min(100, Math.round((page / totalPages) * 100)));
}

export function setPdfTextMode(active) {
  const host = document.getElementById("flipbook-container");
  if (host) host.classList.toggle("is-text-mode", !!active);
  document.body.classList.toggle("pdf-text-mode-active", !!active);
}

export function setDearFlipVisible(show) {
  const host = document.getElementById("flipbook-container");
  if (!host) return;
  host.classList.toggle("is-flipbook-visible", !!show);
  const book = document.getElementById("df-book");
  if (book) book.style.display = show ? "" : "none";
}

export function showPdfPreparingView({
  mode = "listen",
  page = 0,
  totalPages = 0,
  chaptersReady = 0,
  sectionsReady = 0,
  extracting = true,
  empty = false,
} = {}) {
  setPdfTextMode(true);
  setDearFlipVisible(false);

  const host = document.getElementById("flipbook-container");
  if (!host) return;

  let el = document.getElementById(PREPARING_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = PREPARING_ID;
    el.className = "pdf-preparing-view";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    host.appendChild(el);
  }

  el.hidden = false;
  el.classList.toggle("is-warming", !!(extracting && totalPages > 0 && page <= 0));

  const eta = extracting && totalPages > 0 ? markExtractionPage(page, totalPages) : estimateExtractionEta(page, totalPages);
  const fallbackPct = displayExtractionPct(page, totalPages, extracting);
  const pct =
    page > 0 && totalPages > 0
      ? Math.max(eta.pct ?? 0, fallbackPct)
      : (eta.pct ?? fallbackPct);
  const ringOffset = 283 - (283 * pct) / 100;
  const modeLabel = mode === "advanced" ? "Advanced reader" : "Listen mode";
  const title = empty
    ? "No extractable text found"
    : extracting
      ? `Preparing ${modeLabel}`
      : modeLabel;

  const msg = empty
    ? "This PDF may be scanned images only. Use Read mode to view pages."
    : page > 0
      ? `Extracting page ${page} of ${totalPages}…`
      : totalPages > 0
        ? `Ready to scan ${totalPages} pages — starting now…`
        : "Starting text extraction…";

  el.innerHTML = `
    <div class="pdf-preparing-veil" aria-hidden="true"></div>
    <div class="pdf-preparing-glow" aria-hidden="true"></div>
    <div class="pdf-preparing-card">
      <p class="pdf-preparing-kicker">${mode === "advanced" ? "Novel view" : "Audiobook"}</p>
      <div class="pdf-preparing-ornament" aria-hidden="true"><span></span><span></span><span></span></div>
      <h2 class="pdf-preparing-title">${title}</h2>
      <p class="pdf-preparing-msg">${msg}</p>
      ${
        empty
          ? ""
          : `
      <div class="pdf-preparing-ring-wrap" aria-hidden="true">
        <svg class="pdf-preparing-ring" viewBox="0 0 100 100">
          <circle class="pdf-preparing-ring-bg" cx="50" cy="50" r="45"></circle>
          <circle class="pdf-preparing-ring-fg" cx="50" cy="50" r="45"
            style="stroke-dashoffset:${ringOffset}"></circle>
        </svg>
        <div class="pdf-preparing-ring-center">
          <strong id="pdf-preparing-pct">${pct}%</strong>
          <span class="pdf-preparing-eta" id="pdf-preparing-eta">${eta.label}</span>
        </div>
      </div>
      <div class="pdf-preparing-track" aria-hidden="true">
        <span class="pdf-preparing-fill" id="pdf-preparing-fill" style="width:${pct}%"></span>
      </div>
      <p class="pdf-preparing-meta" id="pdf-preparing-meta">
        ${chaptersReady} chapter${chaptersReady === 1 ? "" : "s"} · ${sectionsReady.toLocaleString()} sections ready
      </p>
      `
      }
      <p class="pdf-preparing-hint">Use Read mode to flip pages while we prepare this view.</p>
    </div>
  `;
}

export function updatePdfPreparingView(opts) {
  const el = document.getElementById(PREPARING_ID);
  if (!el || el.hidden) return;

  const {
    mode = "listen",
    page = 0,
    totalPages = 0,
    chaptersReady = 0,
    sectionsReady = 0,
    extracting = true,
    empty = false,
  } = opts;

  const eta = extracting && totalPages > 0 ? markExtractionPage(page, totalPages) : estimateExtractionEta(page, totalPages);
  const fallbackPct = displayExtractionPct(page, totalPages, extracting);
  const pct =
    page > 0 && totalPages > 0
      ? Math.max(eta.pct ?? 0, fallbackPct)
      : (eta.pct ?? fallbackPct);

  const pctEl = document.getElementById("pdf-preparing-pct");
  if (pctEl) {
    pctEl.textContent = `${pct}%`;
    const etaEl = document.getElementById("pdf-preparing-eta");
    if (etaEl) etaEl.textContent = eta.label;
    const fillEl = document.getElementById("pdf-preparing-fill");
    if (fillEl) fillEl.style.width = `${pct}%`;
    const metaEl = document.getElementById("pdf-preparing-meta");
    if (metaEl) {
      metaEl.textContent = `${chaptersReady} chapter${chaptersReady === 1 ? "" : "s"} · ${sectionsReady.toLocaleString()} sections ready`;
    }
    const msgEl = el.querySelector(".pdf-preparing-msg");
    if (msgEl) {
      msgEl.textContent = empty
        ? "This PDF may be scanned images only. Use Read mode to view pages."
        : page > 0
          ? `Extracting page ${page} of ${totalPages}…`
          : totalPages > 0
            ? `Ready to scan ${totalPages} pages — starting now…`
            : "Starting text extraction…";
    }
    const ringFg = el.querySelector(".pdf-preparing-ring-fg");
    if (ringFg) ringFg.style.strokeDashoffset = `${283 - (283 * pct) / 100}`;
    return;
  }

  showPdfPreparingView({ mode, page, totalPages, chaptersReady, sectionsReady, extracting, empty });
}

export function hidePdfPreparingView() {
  const el = document.getElementById(PREPARING_ID);
  if (el) {
    el.hidden = true;
    el.innerHTML = "";
  }
}
