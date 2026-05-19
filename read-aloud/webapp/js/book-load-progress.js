/**
 * Small progress card while PDF listen text is prepared in the background.
 */

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
          <strong class="book-load-progress-title">Preparing book mode</strong>
          <span class="book-load-progress-pct" id="book-load-progress-pct">0%</span>
        </div>
        <p class="book-load-progress-msg" id="book-load-progress-msg">Starting…</p>
        <div class="book-load-progress-track" aria-hidden="true">
          <span class="book-load-progress-fill" id="book-load-progress-fill"></span>
        </div>
        <p class="book-load-progress-meta" id="book-load-progress-meta">0 chapters ready</p>
        <p class="book-load-progress-hint">You can read and listen to chapters already loaded.</p>
      </div>
    `;
    host.appendChild(el);
  }
  return el;
}

export function updateLoadProgress({ page = 0, totalPages = 0, chaptersReady = 0, sectionsReady = 0, done = false }) {
  const root = ensureLoadProgressCard();
  if (!root) return;

  const pct = totalPages > 0 ? Math.min(100, Math.round((page / totalPages) * 100)) : done ? 100 : 0;
  const show = !done && totalPages > 0 && page < totalPages;

  root.hidden = !show;
  if (!show) return;

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
    metaEl.textContent = `${chaptersReady} chapter${chaptersReady === 1 ? "" : "s"} ready · ${sectionsReady.toLocaleString()} sections`;
  }
}

export function hideLoadProgress() {
  const root = document.getElementById("book-load-progress");
  if (root) root.hidden = true;
}
