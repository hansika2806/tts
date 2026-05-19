import { escapeHtml } from "./utils.js";
import { progressPercent } from "./library.js";

// Curated gradient palettes for book covers (cycles by index)
const COVER_PALETTES = [
  { bg: "linear-gradient(145deg, #1a0533 0%, #3d1268 60%, #6b21a8 100%)", accent: "#c084fc" },
  { bg: "linear-gradient(145deg, #0c1a2e 0%, #1e3a5f 60%, #2563eb 100%)", accent: "#60a5fa" },
  { bg: "linear-gradient(145deg, #1a0a00 0%, #7c2d12 60%, #c2410c 100%)", accent: "#fb923c" },
  { bg: "linear-gradient(145deg, #001a15 0%, #064e3b 60%, #059669 100%)", accent: "#34d399" },
  { bg: "linear-gradient(145deg, #1a1505 0%, #713f12 60%, #ca8a04 100%)", accent: "#fbbf24" },
  { bg: "linear-gradient(145deg, #1a0020 0%, #701a75 60%, #a21caf 100%)", accent: "#e879f9" },
  { bg: "linear-gradient(145deg, #0d1117 0%, #161b22 60%, #21262d 100%)", accent: "#8b949e" },
  { bg: "linear-gradient(145deg, #0a0015 0%, #1e1b4b 60%, #3730a3 100%)", accent: "#818cf8" },
];

export function renderLibraryGrid(container, books, { onOpen, onDelete, onReimport }) {
  container.innerHTML = "";
  if (!books.length) {
    container.innerHTML = `
      <div class="library-empty">
        <div class="library-empty-icon">📚</div>
        <p>Your library is empty</p>
        <p class="library-empty-hint">Add a TXT, EPUB, or PDF above to start listening to your novels with AI-powered voices.</p>
      </div>`;
    return;
  }

  const grid = document.createElement("div");
  grid.className = "library-grid";

  books.forEach((book, i) => {
    const pct = progressPercent(book, book.totalChunks || 0);
    const needsReimport = book.type === "epub" && !book.text && !book.epubBlob;
    const isStarted = pct > 0;
    const isDone = pct >= 100;
    const palette = COVER_PALETTES[i % COVER_PALETTES.length];

    const card = document.createElement("article");
    card.className = "library-card";
    card.dataset.type = book.type || "txt";
    card.style.setProperty("--card-accent", palette.accent);
    card.style.animationDelay = `${0.05 + i * 0.08}s`;

    const progressLabel = isDone
      ? "✓ Finished"
      : isStarted
        ? `${pct}% complete`
        : "Not started";

    const actionLabel = needsReimport
      ? "Re-add EPUB"
      : isDone
        ? "▶ Read again"
        : isStarted
          ? "▶ Continue"
          : "▶ Start reading";

    // Generate initials for the cover art (filter out emojis/symbols)
    const cleanTitle = (book.title || "Book").replace(/[^a-zA-Z0-9\s]/g, "").trim();
    const initials = (cleanTitle || "B")
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0]?.toUpperCase() || "")
      .join("");

    const chapterCount = book.chapters?.length || book.totalChunks || 0;
    const chapterLabel = chapterCount
      ? `${chapterCount} ${book.chapters?.length ? "chapters" : "sections"}`
      : formatType(book.type);

    card.innerHTML = `
      <div class="library-card-cover" style="background: ${palette.bg};">
        <div class="library-card-initials" style="color:${palette.accent}">${initials}</div>
        <div class="library-card-cover-type">${typeIcon(book.type)}</div>
        <div class="library-card-cover-glow" style="background: radial-gradient(circle at 50% 120%, ${palette.accent}22 0%, transparent 60%);"></div>
        ${isDone ? '<div class="library-card-done-badge">✓</div>' : ""}
      </div>

      <div class="library-card-body">
        <div class="library-card-meta-top">
          <span class="library-card-format-badge">${formatType(book.type)}</span>
          <span class="library-card-chapter-count">${chapterLabel}</span>
        </div>
        <h3 class="library-card-title">${escapeHtml(book.title)}</h3>
        ${book.author ? `<p class="library-card-author">${escapeHtml(book.author)}</p>` : ""}

        <div class="library-card-progress-wrap">
          <div class="library-card-progress">
            <div class="library-card-progress-bar" style="width:${pct || 0}%; background: linear-gradient(90deg, ${palette.accent}99, ${palette.accent});"></div>
          </div>
          <span class="library-card-pct">${progressLabel}</span>
        </div>
      </div>

      <div class="library-card-actions">
        <button type="button" class="btn btn-primary btn-sm library-open-btn">${actionLabel}</button>
        <button type="button" class="library-delete-btn" title="Remove from library" aria-label="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14H6L5 6"></path><path d="M10 11v6M14 11v6"></path><path d="M9 6V4h6v2"></path></svg>
        </button>
      </div>
    `;

    card.querySelector(".library-open-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (needsReimport) onReimport?.(book);
      else onOpen(book);
    });
    card.querySelector(".library-delete-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      if (confirm(`Remove "${book.title}" from library?`)) onDelete(book);
    });

    // Click the card body itself also opens
    card.querySelector(".library-card-body").addEventListener("click", () => {
      if (needsReimport) onReimport?.(book);
      else onOpen(book);
    });
    card.querySelector(".library-card-cover").addEventListener("click", () => {
      if (needsReimport) onReimport?.(book);
      else onOpen(book);
    });

    grid.appendChild(card);
  });

  container.appendChild(grid);
}

function typeIcon(type) {
  if (type === "pdf")  return "📑";
  if (type === "epub") return "📘";
  if (type === "url")  return "🔗";
  return "📄";
}

function formatType(type) {
  return { txt: "Text", epub: "EPUB", pdf: "PDF", url: "Web" }[type] || type;
}
