/**
 * PDF Advanced Mode — cinematic novel reader extracted from PDF text.
 *
 * Features:
 *  - Beautiful chapter-level rendering (one chapter at a time)
 *  - Double-tap paragraph → highlight color picker that saves persistently
 *  - Active word highlight during TTS playback
 *  - Smooth scroll to active line
 *  - Typography toolbar (font, size)
 */

import { escapeHtml, renderTextWithActiveWord } from "./utils.js";
import { applyNovelTypography, ensureNovelTypographyToolbar } from "./novel-typography.js";
import { setDearFlipVisible, setPdfTextMode } from "./pdf-view-shell.js";

let renderedChapter = -1;
let lastDblTapChunk = -1;

const HIGHLIGHT_COLORS = ["#facc15", "#34d399", "#60a5fa", "#f472b6", "#a78bfa", "#fb923c"];

// ─── Container ──────────────────────────────────────────────────────────────

export function ensurePdfAdvancedContainer() {
  let el = document.getElementById("pdf-advanced-reader");
  const host = document.getElementById("flipbook-container");
  if (!el && host) {
    el = document.createElement("div");
    el.id = "pdf-advanced-reader";
    el.className = "pdf-advanced-reader";
    el.setAttribute("aria-label", "Advanced novel reader");
    el.hidden = true;
    host.insertBefore(el, host.firstChild);
  }
  return el;
}

export function setPdfAdvancedVisible(visible, { hasContent = true } = {}) {
  const el = ensurePdfAdvancedContainer();
  if (!el) return;

  if (visible) {
    setPdfTextMode(true);
    setDearFlipVisible(false);
  }

  const showText = visible && hasContent;
  el.hidden = !showText;
  if (!showText) {
    el.innerHTML = "";
    renderedChapter = -1;
    return;
  }

  const settings = window.__novelTypographySettings || {};
  applyNovelTypography(el, settings);
  ensureNovelTypographyToolbar(el, {
    ...settings,
    onChange: (next) => {
      window.__novelTypographySettings = next;
      window.__onNovelTypographyChange?.(next);
      applyNovelTypography(el, next);
    },
  });

  const layer = document.getElementById("pdf-interaction-layer");
  const listen = document.getElementById("pdf-chapter-reader");
  if (layer) layer.hidden = true;
  if (listen) listen.hidden = true;

  el.classList.add("is-entering");
  window.setTimeout(() => el.classList.remove("is-entering"), 1300);
}

export function resetPdfAdvancedView() {
  renderedChapter = -1;
  lastDblTapChunk = -1;
  const el = document.getElementById("pdf-advanced-reader");
  if (el) {
    el.innerHTML = "";
    el.hidden = true;
  }
  closeHighlightPopup();
}

// ─── Highlight popup ─────────────────────────────────────────────────────────

function closeHighlightPopup() {
  document.getElementById("pdf-hl-popup")?.remove();
}

function showHighlightPopup(chunkIndex, anchorEl, callbacks) {
  closeHighlightPopup();

  const rect = anchorEl?.getBoundingClientRect?.();
  if (!rect) return;

  const saved = callbacks.getSavedHighlight?.(chunkIndex);

  const popup = document.createElement("div");
  popup.id = "pdf-hl-popup";
  popup.className = "pdf-hl-popup";
  popup.style.cssText = `
    position: fixed;
    left: ${Math.max(12, Math.min(rect.left, window.innerWidth - 280))}px;
    top: ${Math.max(64, rect.top - 80)}px;
    z-index: 9999;
  `;

  popup.innerHTML = `
    <div class="pdf-hl-popup-inner">
      <p class="pdf-hl-popup-label">Highlight colour</p>
      <div class="pdf-hl-swatches">
        ${HIGHLIGHT_COLORS.map(c =>
          `<button type="button" class="pdf-hl-swatch${saved?.color === c ? " is-active" : ""}"
            data-color="${c}" style="background:${c}" title="${c}"></button>`
        ).join("")}
      </div>
      <div class="pdf-hl-popup-actions">
        ${saved ? `<button type="button" class="pdf-hl-remove">Remove</button>` : ""}
        <button type="button" class="pdf-hl-cancel">Cancel</button>
      </div>
    </div>
  `;

  document.body.appendChild(popup);

  popup.querySelectorAll(".pdf-hl-swatch").forEach((btn) => {
    btn.addEventListener("click", () => {
      callbacks.onSaveHighlight?.(chunkIndex, btn.dataset.color);
      closeHighlightPopup();
    });
  });
  popup.querySelector(".pdf-hl-cancel")?.addEventListener("click", closeHighlightPopup);
  popup.querySelector(".pdf-hl-remove")?.addEventListener("click", () => {
    callbacks.onRemoveHighlight?.(chunkIndex);
    closeHighlightPopup();
  });

  // Click outside to dismiss
  const dismiss = (e) => {
    if (!popup.contains(e.target)) {
      closeHighlightPopup();
      document.removeEventListener("click", dismiss, true);
    }
  };
  setTimeout(() => document.addEventListener("click", dismiss, true), 10);
}

// ─── Chapter header ───────────────────────────────────────────────────────────

function buildChapterHero(chapterIndex, chapterTitle, totalChapters, callbacks) {
  const nav = document.createElement("div");
  nav.className = "pdf-advanced-nav";
  nav.innerHTML = `
    <button type="button" class="pdf-adv-nav-btn" id="pdf-adv-prev-ch" title="Previous chapter">← Prev</button>
    <span class="pdf-adv-nav-label">Chapter ${chapterIndex + 1} of ${totalChapters}</span>
    <button type="button" class="pdf-adv-nav-btn" id="pdf-adv-next-ch" title="Next chapter">Next →</button>
  `;
  nav.querySelector("#pdf-adv-prev-ch")?.addEventListener("click", () => callbacks.onAdjacentChapter?.(-1));
  nav.querySelector("#pdf-adv-next-ch")?.addEventListener("click", () => callbacks.onAdjacentChapter?.(1));

  const hero = document.createElement("header");
  hero.className = "pdf-advanced-hero";
  hero.innerHTML = `
    <p class="pdf-advanced-kicker">Chapter ${chapterIndex + 1}</p>
    <div class="pdf-advanced-ornament" aria-hidden="true"><span></span><span></span><span></span></div>
    <h1 class="pdf-advanced-title">${escapeHtml(chapterTitle)}</h1>
    <div class="pdf-advanced-divider" aria-hidden="true"></div>
  `;

  const wrapper = document.createElement("div");
  wrapper.className = "pdf-advanced-hero-wrap";
  wrapper.appendChild(nav);
  wrapper.appendChild(hero);
  return wrapper;
}

// ─── Main render ──────────────────────────────────────────────────────────────

export function updatePdfAdvancedReader(runtime, callbacks = {}) {
  const container = ensurePdfAdvancedContainer();
  if (!container || container.hidden) return;

  if (!runtime?.queue?.length) {
    container.hidden = true;
    container.innerHTML = "";
    renderedChapter = -1;
    return;
  }

  container.hidden = false;

  const chunkIndex =
    runtime.currentIndex >= 0 && runtime.currentIndex < runtime.queue.length
      ? runtime.currentIndex : 0;
  const chunk = runtime.queue[chunkIndex];
  if (!chunk) return;

  const currentChapter = chunk.chapterIndex ?? 0;
  const chapterTitle = chunk.chapterTitle || `Chapter ${currentChapter + 1}`;
  const totalChapters = runtime.chapters?.length || 1;
  const chapterObj = runtime.chapters?.find((c) => c.chapterIndex === currentChapter);

  const chapterChanged = renderedChapter !== currentChapter;

  if (chapterChanged) {
    renderedChapter = currentChapter;
    container.innerHTML = "";

    // Re-apply typography to the freshly wiped container
    const settings = window.__novelTypographySettings || {};
    applyNovelTypography(container, settings);
    ensureNovelTypographyToolbar(container, {
      ...settings,
      onChange: (next) => {
        window.__novelTypographySettings = next;
        window.__onNovelTypographyChange?.(next);
        applyNovelTypography(container, next);
      },
    });

    // Chapter header + navigation
    container.appendChild(buildChapterHero(currentChapter, chapterTitle, totalChapters, callbacks));

    // Article body — only this chapter's paragraphs
    const startIdx = chapterObj?.startChunk ?? chunkIndex;
    const endIdx   = chapterObj?.endChunk   ?? chunkIndex;

    const body = document.createElement("article");
    body.className = "pdf-advanced-body";

    for (let i = startIdx; i <= endIdx; i++) {
      const q = runtime.queue[i];
      if (!q) continue;

      const p = document.createElement("p");
      p.className = "advanced-verse";
      p.dataset.chunkIndex = String(i);
      p.textContent = q.text;

      // Double-tap → highlight popup
      p.addEventListener("click", (e) => {
        const idx = Number(p.dataset.chunkIndex);
        const now = Date.now();
        if (lastDblTapChunk === idx && now - (p._lastTap || 0) < 380) {
          e.preventDefault();
          showHighlightPopup(idx, p, callbacks);
          lastDblTapChunk = -1;
        } else {
          lastDblTapChunk = idx;
          p._lastTap = now;
        }
      });

      p.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const idx = Number(p.dataset.chunkIndex);
        showHighlightPopup(idx, p, callbacks);
      });

      body.appendChild(p);
    }

    container.appendChild(body);
  }

  // Update active paragraph + highlights
  const verses = container.querySelectorAll(".advanced-verse");
  let activeElement = null;

  verses.forEach((p) => {
    const idx = Number(p.dataset.chunkIndex);
    const isActive = idx === chunkIndex;
    p.classList.toggle("is-active-chunk", isActive);

    // Apply saved highlight color
    const saved = callbacks.getSavedHighlight?.(idx);
    if (saved?.color) {
      p.classList.add("is-saved-highlight");
      p.style.setProperty("--hl-color", saved.color);
    } else {
      p.classList.remove("is-saved-highlight");
      p.style.removeProperty("--hl-color");
    }

    if (isActive) {
      activeElement = p;
      if (runtime.activeWordRange?.chunkIndex === chunkIndex) {
        p.innerHTML = renderTextWithActiveWord(
          runtime.queue[idx].text,
          runtime.activeWordRange.start,
          runtime.activeWordRange.end
        );
      } else {
        p.textContent = runtime.queue[idx]?.text || "";
      }
    } else if (!p.querySelector(".active-word")) {
      p.textContent = runtime.queue[idx]?.text || "";
    }
  });

  if (activeElement && runtime.mode === "playing") {
    activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
