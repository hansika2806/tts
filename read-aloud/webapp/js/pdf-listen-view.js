/**
 * PDF Listen Mode — chapter-by-chapter scrollable reader.
 *
 * Features:
 *  - Shows one chapter at a time (not the whole book)
 *  - Sliding chapter TOC panel with + / − toggle
 *  - Double-tap any paragraph → starts playback from that line
 *  - Active word highlight during TTS
 *  - Cinematic chapter transition card on chapter change
 */

import { escapeHtml, renderTextWithActiveWord } from "./utils.js";
import { setDearFlipVisible, setPdfTextMode } from "./pdf-view-shell.js";

let renderedChapter = -1;   // which chapter is currently rendered
let lastLineTap = { at: 0, chunk: -1 };
let tocOpen = false;        // whether the sliding TOC is expanded

// ─── Container wiring ──────────────────────────────────────────────────────

export function ensurePdfListenContainer() {
  let el = document.getElementById("pdf-chapter-reader");
  const host = document.getElementById("flipbook-container");
  if (!el && host) {
    el = document.createElement("div");
    el.id = "pdf-chapter-reader";
    el.className = "pdf-chapter-reader";
    el.setAttribute("aria-label", "Chapter text");
    el.hidden = true;
    host.insertBefore(el, host.firstChild);
  }
  return el;
}

export function setPdfListenVisible(visible, { hasContent = true } = {}) {
  const el = ensurePdfListenContainer();
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
  }

  const layer = document.getElementById("pdf-interaction-layer");
  const advanced = document.getElementById("pdf-advanced-reader");
  if (layer) layer.hidden = true;
  if (advanced && visible) advanced.hidden = true;
}

// ─── Chapter-level TOC panel (sliding, +/−) ────────────────────────────────

function buildTocPanel(runtime, callbacks) {
  const chapters = runtime.chapters || [];
  const currentChunk = runtime.currentIndex >= 0 ? runtime.currentIndex : 0;
  const currentChapter = runtime.queue[currentChunk]?.chapterIndex ?? 0;

  const panel = document.createElement("div");
  panel.id = "pdf-listen-toc-panel";
  panel.className = "pdf-listen-toc-panel" + (tocOpen ? " is-open" : "");
  panel.setAttribute("aria-label", "Chapter list");

  // Toggle button
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "pdf-listen-toc-toggle";
  toggle.setAttribute("aria-expanded", String(tocOpen));
  toggle.setAttribute("title", tocOpen ? "Hide chapters" : "Show chapters");
  toggle.textContent = tocOpen ? "−" : "+";
  toggle.addEventListener("click", () => {
    tocOpen = !tocOpen;
    panel.classList.toggle("is-open", tocOpen);
    toggle.textContent = tocOpen ? "−" : "+";
    toggle.setAttribute("aria-expanded", String(tocOpen));
    toggle.setAttribute("title", tocOpen ? "Hide chapters" : "Show chapters");
    body.hidden = !tocOpen;
  });

  // Body (chapter list)
  const body = document.createElement("div");
  body.className = "pdf-listen-toc-body";
  body.hidden = !tocOpen;

  const heading = document.createElement("p");
  heading.className = "pdf-listen-toc-heading";
  heading.textContent = `${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`;
  body.appendChild(heading);

  const list = document.createElement("ul");
  list.className = "pdf-listen-toc-list";
  chapters.forEach((ch, i) => {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pdf-listen-toc-item" + (ch.chapterIndex === currentChapter ? " is-active" : "");
    btn.dataset.startChunk = String(ch.startChunk);
    btn.innerHTML = `<span class="toc-num">${String(i + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(ch.title || `Chapter ${i + 1}`)}</strong>`;
    btn.addEventListener("click", () => {
      callbacks.onChapterJump?.(ch.startChunk);
      // Close TOC after navigation
      tocOpen = false;
      panel.classList.remove("is-open");
      toggle.textContent = "+";
      toggle.setAttribute("aria-expanded", "false");
      body.hidden = true;
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
  body.appendChild(list);

  panel.appendChild(toggle);
  panel.appendChild(body);
  return panel;
}

// ─── Chapter header card ────────────────────────────────────────────────────

function buildChapterHeader(chapterTitle, chapterNum, totalChapters) {
  const header = document.createElement("header");
  header.className = "pdf-listen-chapter-header";
  header.innerHTML = `
    <p class="pdf-listen-kicker">Chapter ${chapterNum} of ${totalChapters}</p>
    <div class="pdf-listen-ornament" aria-hidden="true"><span></span><span></span><span></span></div>
    <h2 class="pdf-listen-chapter-title">${escapeHtml(chapterTitle)}</h2>
  `;
  return header;
}

// ─── Cinematic chapter transition ───────────────────────────────────────────

let transitionActive = false;

export function playPdfChapterTransition(chunk, { completedPrevious = false } = {}) {
  if (transitionActive) return Promise.resolve();

  // Reuse the global chapter-transition overlay used by EPUB reader
  const overlay = document.getElementById("chapter-transition");
  if (!overlay) return Promise.resolve();

  const kicker = document.getElementById("chapter-transition-kicker");
  const title = document.getElementById("chapter-transition-title");
  const meta = document.getElementById("chapter-transition-meta");

  if (kicker) kicker.textContent = completedPrevious ? "Next chapter" : "Chapter";
  if (title) title.textContent = chunk?.chapterTitle || `Chapter ${(chunk?.chapterIndex ?? 0) + 1}`;
  if (meta) meta.textContent = chunk?.text?.slice(0, 80) || "";

  transitionActive = true;
  overlay.hidden = false;
  overlay.classList.add("is-active");

  return new Promise((resolve) => {
    setTimeout(() => {
      overlay.classList.remove("is-active");
      setTimeout(() => {
        overlay.hidden = true;
        transitionActive = false;
        resolve();
      }, 600);
    }, 1800);
  });
}

// ─── Main render ────────────────────────────────────────────────────────────

export function updatePdfListenReader(runtime, callbacks = {}) {
  const container = ensurePdfListenContainer();
  if (!container || container.hidden) return;

  if (!runtime.queue?.length) {
    container.hidden = true;
    container.innerHTML = "";
    renderedChapter = -1;
    return;
  }

  const chunkIndex =
    runtime.currentIndex >= 0 && runtime.currentIndex < runtime.queue.length
      ? runtime.currentIndex
      : 0;
  const chunk = runtime.queue[chunkIndex];
  if (!chunk) return;

  const currentChapter = chunk.chapterIndex ?? 0;
  const chapterObj = runtime.chapters?.find((c) => c.chapterIndex === currentChapter);
  const chapterTitle = chunk.chapterTitle || `Chapter ${currentChapter + 1}`;
  const totalChapters = runtime.chapters?.length || 1;

  // Rebuild when chapter changes
  const chapterChanged = renderedChapter !== currentChapter;
  if (chapterChanged) {
    renderedChapter = currentChapter;
    container.innerHTML = "";

    // TOC panel (top)
    const tocPanel = buildTocPanel(runtime, {
      onChapterJump: callbacks.onChapterJump,
    });
    container.appendChild(tocPanel);

    // Chapter header
    const chapterNum = (runtime.chapters?.findIndex((c) => c.chapterIndex === currentChapter) ?? 0) + 1;
    container.appendChild(buildChapterHeader(chapterTitle, chapterNum, totalChapters));

    // Paragraphs — only this chapter's chunks
    const startIdx = chapterObj?.startChunk ?? chunkIndex;
    const endIdx = chapterObj?.endChunk ?? chunkIndex;

    const body = document.createElement("div");
    body.className = "pdf-listen-body";

    for (let i = startIdx; i <= endIdx; i++) {
      const p = document.createElement("p");
      p.className = "reader-paragraph";
      p.dataset.chunkIndex = String(i);
      p.textContent = runtime.queue[i]?.text || "";

      // Double-tap → play from this line
      p.addEventListener("click", (event) => {
        event.preventDefault();
        const idx = Number(p.dataset.chunkIndex);
        const now = Date.now();
        if (lastLineTap.chunk === idx && now - lastLineTap.at < 380) {
          callbacks.onPlayFromChunk?.(idx);
          lastLineTap = { at: 0, chunk: -1 };
        } else {
          lastLineTap = { at: now, chunk: idx };
        }
      });

      p.addEventListener("dblclick", (event) => {
        event.preventDefault();
        callbacks.onPlayFromChunk?.(Number(p.dataset.chunkIndex));
      });

      body.appendChild(p);
    }
    container.appendChild(body);
  }

  // Update active paragraph highlight
  const paragraphs = container.querySelectorAll(".reader-paragraph");
  let activeElement = null;

  paragraphs.forEach((p) => {
    const idx = Number(p.dataset.chunkIndex);
    if (idx === chunkIndex) {
      activeElement = p;
      p.classList.add("is-active-chunk");
      if (runtime.activeWordRange?.chunkIndex === chunkIndex) {
        p.innerHTML = renderTextWithActiveWord(
          runtime.queue[idx].text,
          runtime.activeWordRange.start,
          runtime.activeWordRange.end
        );
      } else {
        p.textContent = runtime.queue[idx]?.text || "";
      }
    } else {
      p.classList.remove("is-active-chunk");
      if (!p.querySelector(".active-word")) {
        p.textContent = runtime.queue[idx]?.text || "";
      }
    }
  });

  // Sync TOC active state
  const tocItems = container.querySelectorAll(".pdf-listen-toc-item");
  tocItems.forEach((btn) => {
    const start = Number(btn.dataset.startChunk);
    btn.classList.toggle("is-active", start === (chapterObj?.startChunk ?? chunkIndex));
  });

  if (activeElement && runtime.mode === "playing") {
    activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function resetPdfListenView() {
  renderedChapter = -1;
  tocOpen = false;
  lastLineTap = { at: 0, chunk: -1 };
  const el = document.getElementById("pdf-chapter-reader");
  if (el) {
    el.innerHTML = "";
    el.hidden = true;
  }
}
