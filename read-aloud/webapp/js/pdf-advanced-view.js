/**
 * Advanced mode — cinematic novel reader extracted from PDF text.
 */

import { escapeHtml, renderTextWithActiveWord } from "./utils.js";
import { applyNovelTypography, ensureNovelTypographyToolbar } from "./novel-typography.js";
import { setDearFlipVisible, setPdfTextMode } from "./pdf-view-shell.js";

let renderedWindow = null;
let lastLineTap = { at: 0, chunk: -1 };
let userHighlightChunk = -1;

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
  renderedWindow = null;
  lastLineTap = { at: 0, chunk: -1 };
  userHighlightChunk = -1;
  const el = document.getElementById("pdf-advanced-reader");
  if (el) {
    el.innerHTML = "";
    el.hidden = true;
  }
}

function buildHero(chapterIndex, chapterTitle, meta) {
  const kicker = `Chapter ${chapterIndex + 1}`;
  const parts = meta?.partLabel || "";
  return `
    <header class="pdf-advanced-hero">
      <p class="pdf-advanced-kicker">${escapeHtml(kicker)}</p>
      <div class="pdf-advanced-ornament" aria-hidden="true"><span></span><span></span><span></span></div>
      <h1 class="pdf-advanced-title">${escapeHtml(chapterTitle)}</h1>
      ${parts ? `<p class="pdf-advanced-meta">${escapeHtml(parts)}</p>` : ""}
    </header>
  `;
}

export function updatePdfAdvancedReader(runtime, callbacks = {}) {
  const container = ensurePdfAdvancedContainer();
  if (!container || container.hidden) return;

  if (!runtime?.queue?.length) {
    container.hidden = true;
    container.innerHTML = "";
    renderedWindow = null;
    return;
  }

  container.hidden = false;

  const chunkIndex =
    runtime.currentIndex >= 0 && runtime.currentIndex < runtime.queue.length
      ? runtime.currentIndex
      : 0;
  const chunk = runtime.queue[chunkIndex];
  if (!chunk) return;

  const currentChapter = chunk.chapterIndex ?? 0;
  const chapterTitle = chunk.chapterTitle || `Chapter ${currentChapter + 1}`;
  const activeIndex = chunkIndex;

  const ch = runtime.chapters?.find((c) => c.chapterIndex === currentChapter);
  const partLabel =
    ch && activeIndex >= 0
      ? `${ch.endChunk - ch.startChunk + 1} parts in this chapter`
      : "";

  let needsRebuild = !container.querySelector(".advanced-verse");
  if (!needsRebuild && renderedWindow) {
    if (renderedWindow.chapter !== currentChapter) needsRebuild = true;
    if (activeIndex < renderedWindow.start) needsRebuild = true;
    if (
      activeIndex > renderedWindow.end - 5 &&
      renderedWindow.end < runtime.queue.length - 1 &&
      (runtime.queue[renderedWindow.end + 1].chapterIndex ?? 0) === currentChapter
    ) {
      needsRebuild = true;
    }
  } else {
    needsRebuild = true;
  }

  if (needsRebuild) {
    let startIndex = activeIndex;
    while (
      startIndex > 0 &&
      (runtime.queue[startIndex - 1].chapterIndex ?? 0) === currentChapter &&
      activeIndex - startIndex < 24
    ) {
      startIndex -= 1;
    }
    let endIndex = activeIndex;
    while (
      endIndex < runtime.queue.length - 1 &&
      (runtime.queue[endIndex + 1].chapterIndex ?? 0) === currentChapter &&
      endIndex - activeIndex < 180
    ) {
      endIndex += 1;
    }

    renderedWindow = { chapter: currentChapter, start: startIndex, end: endIndex };

    const hero = buildHero(currentChapter, chapterTitle, { partLabel });
    const body = document.createElement("article");
    body.className = "pdf-advanced-body";

    for (let i = startIndex; i <= endIndex; i += 1) {
      const p = document.createElement("p");
      p.className = "advanced-verse";
      p.dataset.chunkIndex = String(i);
      p.textContent = runtime.queue[i].text;

      p.addEventListener("click", () => {
        const idx = Number(p.dataset.chunkIndex);
        userHighlightChunk = idx;
        body.querySelectorAll(".advanced-verse").forEach((el) => {
          el.classList.toggle("is-user-selected", Number(el.dataset.chunkIndex) === idx);
        });
      });

      p.addEventListener("dblclick", (event) => {
        event.preventDefault();
        const idx = Number(p.dataset.chunkIndex);
        const text = runtime.queue[idx]?.text || p.textContent;
        callbacks.onHighlightVerse?.(text, idx, p);
      });

      body.appendChild(p);
    }

    container.innerHTML = hero;
    container.appendChild(body);
  }

  const heroEl = container.querySelector(".pdf-advanced-hero");
  if (heroEl && needsRebuild) {
    const titleEl = heroEl.querySelector(".pdf-advanced-title");
    if (titleEl) titleEl.textContent = chapterTitle;
  }

  const verses = container.querySelectorAll(".advanced-verse");
  let activeElement = null;

  verses.forEach((p) => {
    const idx = Number(p.dataset.chunkIndex);
    const isActive = idx === activeIndex;
    p.classList.toggle("is-active-chunk", isActive);
    p.classList.toggle("is-user-selected", idx === userHighlightChunk && !isActive);
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
      if (
        runtime.activeWordRange &&
        runtime.activeWordRange.chunkIndex === activeIndex
      ) {
        p.innerHTML = renderTextWithActiveWord(
          runtime.queue[idx].text,
          runtime.activeWordRange.start,
          runtime.activeWordRange.end
        );
      } else {
        p.textContent = runtime.queue[idx].text;
      }
    } else {
      p.textContent = runtime.queue[idx].text;
    }
  });

  if (activeElement && !runtime.activeWordRange && runtime.mode === "playing") {
    activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}
