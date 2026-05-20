/**
 * Scrollable chapter reader for PDF Listen mode (EPUB-style UX).
 */

import { escapeHtml, renderTextWithActiveWord } from "./utils.js";
import { setDearFlipVisible, setPdfTextMode } from "./pdf-view-shell.js";

let renderedWindow = null;
let lastLineTap = { at: 0, chunk: -1 };

export function ensurePdfListenContainer() {
  let el = document.getElementById("pdf-chapter-reader");
  const host = document.getElementById("flipbook-container");
  if (!el && host) {
    el = document.createElement("div");
    el.id = "pdf-chapter-reader";
    el.className = "pdf-chapter-reader reader-preview";
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
    el.classList.remove("empty");
    el.innerHTML = "";
  }

  const layer = document.getElementById("pdf-interaction-layer");
  const advanced = document.getElementById("pdf-advanced-reader");
  if (layer) layer.hidden = showText ? true : layer.hidden;
  if (advanced && visible) advanced.hidden = true;
}

export function updatePdfListenReader(runtime, callbacks = {}) {
  const container = ensurePdfListenContainer();
  if (!container || container.hidden) return;

  if (!runtime.queue?.length) {
    container.hidden = true;
    container.classList.remove("empty");
    container.innerHTML = "";
    renderedWindow = null;
    return;
  }

  const chunkIndex =
    runtime.currentIndex >= 0 && runtime.currentIndex < runtime.queue.length
      ? runtime.currentIndex
      : 0;
  const chunk = runtime.queue[chunkIndex];
  if (!chunk) {
    container.hidden = true;
    container.innerHTML = "";
    renderedWindow = null;
    return;
  }

  container.classList.remove("empty");
  const currentChapter = chunk.chapterIndex ?? 0;
  const activeIndex = chunkIndex;

  let needsRebuild = !container.querySelector(".reader-paragraph");
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
      activeIndex - startIndex < 30
    ) {
      startIndex -= 1;
    }
    let endIndex = activeIndex;
    while (
      endIndex < runtime.queue.length - 1 &&
      (runtime.queue[endIndex + 1].chapterIndex ?? 0) === currentChapter &&
      endIndex - activeIndex < 200
    ) {
      endIndex += 1;
    }

    renderedWindow = { chapter: currentChapter, start: startIndex, end: endIndex };

    const fragment = document.createDocumentFragment();
    for (let i = startIndex; i <= endIndex; i++) {
      const p = document.createElement("p");
      p.className = "reader-paragraph";
      p.dataset.chunkIndex = String(i);
      p.textContent = runtime.queue[i].text;

      p.addEventListener("dblclick", (event) => {
        event.preventDefault();
        const idx = Number(p.dataset.chunkIndex);
        callbacks.onPlayFromChunk?.(idx);
      });

      fragment.appendChild(p);
    }

    container.innerHTML = "";
    container.appendChild(fragment);
  }

  const paragraphs = container.querySelectorAll(".reader-paragraph");
  let activeElement = null;

  paragraphs.forEach((p) => {
    const idx = Number(p.dataset.chunkIndex);
    if (idx === activeIndex) {
      activeElement = p;
      p.classList.add("is-active-chunk");
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
      p.classList.remove("is-active-chunk");
      p.textContent = runtime.queue[idx].text;
    }
  });

  if (activeElement && !runtime.activeWordRange && runtime.mode === "playing") {
    activeElement.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

export function resetPdfListenView() {
  renderedWindow = null;
  lastLineTap = { at: 0, chunk: -1 };
  const el = document.getElementById("pdf-chapter-reader");
  if (el) {
    el.innerHTML = "";
    el.hidden = true;
  }
}
