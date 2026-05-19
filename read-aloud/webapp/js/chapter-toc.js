/** Shared chapter contents list for listen mode (EPUB, TXT, PDF). */

import { escapeHtml } from "./utils.js";

export function renderChapterTOC({ listEl, countEl, chapters, runtime, onChapter }) {
  if (!listEl) return;

  const items = Array.isArray(chapters) && chapters.length ? chapters : [];
  if (countEl) countEl.textContent = String(items.length);

  if (!items.length) {
    listEl.innerHTML = `<p class="toc-empty">No chapters detected yet.</p>`;
    return;
  }

  const current = Math.max(0, runtime.currentIndex ?? 0);
  listEl.innerHTML = "";
  const fragment = document.createDocumentFragment();

  items.slice(0, 200).forEach((chapter, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "book-toc-item";
    button.dataset.startChunk = String(chapter.startChunk);
    button.dataset.endChunk = String(chapter.endChunk);
    if (current >= chapter.startChunk && current <= chapter.endChunk) {
      button.classList.add("is-active");
    }
    button.innerHTML = `
      <span>${String(index + 1).padStart(2, "0")}</span>
      <strong>${escapeHtml(chapter.title || `Chapter ${index + 1}`)}</strong>
      <em>${chapter.endChunk - chapter.startChunk + 1} parts</em>
    `;
    button.addEventListener("click", () => onChapter?.(chapter.startChunk));
    fragment.appendChild(button);
  });

  if (items.length > 200) {
    const note = document.createElement("p");
    note.className = "queue-skip-hint";
    note.textContent = `${items.length - 200} more chapters not shown`;
    fragment.appendChild(note);
  }

  listEl.appendChild(fragment);
}

export function syncChapterTOCActive(listEl, runtime) {
  if (!listEl || runtime.currentIndex < 0) return;
  listEl.querySelectorAll(".book-toc-item").forEach((el) => {
    const idx = Number(el.dataset.startChunk);
    const end = Number(el.dataset.endChunk);
    el.classList.toggle(
      "is-active",
      runtime.currentIndex >= idx && runtime.currentIndex <= end
    );
  });
}
