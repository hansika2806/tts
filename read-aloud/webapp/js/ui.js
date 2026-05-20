import { PROVIDER_ORDER } from "./config.js";
import { buildChunks, buildChunksFromChapters } from "./queue.js";
import { buildChapterIndex } from "./chapters.js";
import { escapeHtml, renderTextWithActiveWord, debounce } from "./utils.js";
import { renderLibraryGrid } from "./library-ui.js";
import { renderChapterTOC, syncChapterTOCActive } from "./chapter-toc.js";
import { applyNovelTypography, ensureNovelTypographyToolbar } from "./novel-typography.js";

const MAX_QUEUE_DOM = 80;

export function createUi(elements, state, runtime, providers, persistState) {
  let queueRenderToken = 0;
  let currentlyRenderedWindow = null;
  let chapterTransitionTimer = null;
  const TRANSITION_MS = 4400;

  const debouncedRebuild = debounce(() => {
    rebuildQueue();
    persistState(state);
  }, 450);

  function renderProviderPicker(onSelect) {
    elements.providerPicker.innerHTML = "";
    PROVIDER_ORDER.forEach((providerId) => {
      const provider = providers[providerId];
      const button = document.createElement("button");
      button.type = "button";
      button.className = `provider-chip${state.provider === providerId ? " is-active" : ""}`;
      button.innerHTML = `<strong>${provider.label}</strong><span>${provider.blurb}</span>`;
      button.addEventListener("click", () => onSelect(providerId));
      elements.providerPicker.appendChild(button);
    });
  }

  function renderCredentialsForms() {
    elements.credentialsForms.innerHTML = "";
    PROVIDER_ORDER.forEach((providerId) => {
      const provider = providers[providerId];
      if (!provider.credentials) return;
      const card = document.createElement("section");
      card.className = "credential-card";
      const grid = document.createElement("div");
      grid.className = "credential-grid";
      provider.credentials.forEach((field) => {
        const wrapper = document.createElement("label");
        wrapper.className = `field${field.type === "textarea" ? " full" : ""}`;
        const inputTag = field.type === "textarea" ? "textarea" : "input";
        const input = document.createElement(inputTag);
        input.dataset.provider = providerId;
        input.dataset.key = field.key;
        input.placeholder = field.placeholder || "";
        if (inputTag === "input") input.type = field.type || "text";
        if (inputTag === "textarea") input.rows = 3;
        input.value = state.credentials[providerId]?.[field.key] || "";
        wrapper.innerHTML = `<span class="field-label">${field.label}</span>`;
        wrapper.appendChild(input);
        grid.appendChild(wrapper);
      });
      card.innerHTML = `<h3>${provider.label}</h3><p>${provider.blurb}</p>`;
      card.appendChild(grid);
      elements.credentialsForms.appendChild(card);
    });
  }

  function hydrateInputs() {
    elements.textInput.value = state.text;
    elements.titleInput.value = state.title;
    elements.chunkMode.value = state.chunkMode || "novel";
    elements.rateInput.value = String(state.rate);
    elements.pitchInput.value = String(state.pitch);
    elements.volumeInput.value = String(state.volume);
    elements.rateOutput.value = `${state.rate.toFixed(2)}×`;
    elements.pitchOutput.value = `${state.pitch.toFixed(2)}×`;
    elements.volumeOutput.value = `${Math.round(state.volume * 100)}%`;
    updateReaderTitle();
  }

  function populateVoiceSelect(voices) {
    elements.voiceSelect.innerHTML = "";
    const apply = (select, list, selectedId) => {
      if (!select) return;
      select.innerHTML = "";
      if (!list.length) {
        select.innerHTML = '<option value="">No voices</option>';
        return;
      }
      if (!list.some((v) => v.id === selectedId)) selectedId = list[0].id;
      list.forEach((voice) => {
        const option = document.createElement("option");
        option.value = voice.id;
        option.textContent = voice.lang ? `${voice.name} — ${voice.lang}` : voice.name;
        if (voice.id === selectedId) option.selected = true;
        select.appendChild(option);
      });
      return selectedId;
    };

    if (!voices.length) {
      state.voiceId = "";
      apply(elements.voiceSelect, [], "");
      persistState(state);
      return;
    }
    state.voiceId = apply(elements.voiceSelect, voices, state.voiceId);
    if (elements.dialogueVoiceSelect) {
      state.dialogueVoiceId = apply(
        elements.dialogueVoiceSelect,
        voices,
        state.dialogueVoiceId || state.voiceId
      );
    }
    persistState(state, true);
  }

  function updateStats() {
    const text = state.text.trim();
    elements.charCount.textContent = `${text.length.toLocaleString()} characters`;
    const count = state.bookChapters?.length
      ? buildChunksFromChapters(state.bookChapters, state.chunkMode, { skipFootnotes: true }).length
      : buildChunks(text, state.chunkMode, { skipFootnotes: true }).length;
    elements.chunkCount.textContent = `${count} sections`;
  }

  function rebuildQueue() {
    runtime.queue = state.bookChapters?.length
      ? buildChunksFromChapters(state.bookChapters, state.chunkMode, {
          skipFootnotes: state.playbackMode === "skip_footnotes",
        })
      : buildChunks(state.text, state.chunkMode, {
          skipFootnotes: state.playbackMode === "skip_footnotes",
          useChapters: state.chunkMode === "novel",
        });
    runtime.chapters = buildChapterIndex(runtime.queue);
    currentlyRenderedWindow = null;
    if (runtime.currentIndex < 0 || runtime.currentIndex >= runtime.queue.length) {
      runtime.currentIndex = Math.min(
        Math.max(0, state.resumeChunkIndex ?? 0),
        Math.max(0, runtime.queue.length - 1)
      );
    }
    runtime.activeWordRange = null;
    renderChapterJump();
    renderQueue(true);
    updateReaderTitle();
    updateReaderProgress();
    updateListenContents();
  }

  function renderChapterJump() {
    const sel = elements.chapterJump;
    if (!sel) return;
    sel.innerHTML = "";
    if (!runtime.chapters?.length) {
      sel.disabled = true;
      return;
    }
    sel.disabled = false;
    runtime.chapters.forEach((ch) => {
      const opt = document.createElement("option");
      opt.value = String(ch.chapterIndex);
      opt.textContent = ch.title;
      sel.appendChild(opt);
    });
    const current = runtime.queue[runtime.currentIndex];
    if (current) sel.value = String(current.chapterIndex ?? 0);
  }

  function renderQueue(fullRebuild = false) {
    const list = elements.chunkList;
    if (!list) return;

    if (!runtime.queue.length) {
      list.innerHTML = '<p class="queue-empty">No text loaded. Open a book from Library.</p>';
      elements.readerPreview?.classList.add("empty");
      if (elements.readerPreview) {
        elements.readerPreview.textContent = "Open a book and press Play.";
      }
      updateReaderProgress();
      renderChapterTransition(null);
      return;
    }

    const token = ++queueRenderToken;
    const active = runtime.currentIndex;
    const start = Math.max(0, active - 15);
    const end = Math.min(runtime.queue.length, start + MAX_QUEUE_DOM);

    if (fullRebuild || list.children.length === 0) {
      list.innerHTML = "";
      if (start > 0) {
        const skip = document.createElement("p");
        skip.className = "queue-skip-hint";
        skip.textContent = `↑ ${start} earlier sections — use chapters ↑`;
        list.appendChild(skip);
      }
      for (let index = start; index < end; index++) {
        if (token !== queueRenderToken) return;
        list.appendChild(createChunkItem(index));
      }
      if (end < runtime.queue.length) {
        const skip = document.createElement("p");
        skip.className = "queue-skip-hint";
        skip.textContent = `↓ ${runtime.queue.length - end} more — use chapter menu`;
        list.appendChild(skip);
      }
    } else {
      list.querySelectorAll(".chunk-item").forEach((el) => {
        const index = Number(el.dataset.index);
        el.classList.toggle("is-active", index === active);
        el.classList.toggle("is-done", index < active);
      });
    }

    updateReaderPreview();
    updateReaderProgress();
    renderBookmarks();
  }

  function createChunkItem(index) {
    const chunk = runtime.queue[index];
    const item = document.createElement("article");
    item.className = "chunk-item";
    item.dataset.index = String(index);
    if (index === runtime.currentIndex) item.classList.add("is-active");
    if (index < runtime.currentIndex) item.classList.add("is-done");
    const label = chunk.chapterTitle
      ? `${chunk.chapterTitle} · §${index + 1}`
      : `Section ${index + 1}`;
    item.innerHTML = `
      <div class="chunk-item-header">
        <span>${escapeHtml(label)}</span>
        <span>${chunk.text.length} chars</span>
      </div>
      <p>${escapeHtml(chunk.text.slice(0, 160))}${chunk.text.length > 160 ? "…" : ""}</p>
    `;
    item.addEventListener("click", () => {
      runtime.currentIndex = index;
      runtime.activeWordRange = null;
      renderQueue(false);
      updateReaderPreview();
      state.onChunkChange?.(index);
    });
    return item;
  }

  function renderBookmarks() {
    const box = elements.bookmarksList;
    if (!box) return;
    const marks = state.bookmarks || [];
    if (!marks.length) {
      box.innerHTML = '<p class="queue-empty">No bookmarks yet. Press B while listening.</p>';
      return;
    }
    box.innerHTML = "";
    marks.forEach((bm) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "bookmark-item";
      btn.innerHTML = `<strong>§${bm.chunkIndex + 1}</strong> ${escapeHtml(bm.preview || "")}`;
      btn.addEventListener("click", () => {
        runtime.currentIndex = bm.chunkIndex;
        runtime.activeWordRange = null;
        renderQueue(true);
        state.onChunkChange?.(bm.chunkIndex);
      });
      box.appendChild(btn);
    });
  }

  function renderLibrary(books, handlers) {
    if (elements.libraryGrid) renderLibraryGrid(elements.libraryGrid, books, handlers);
  }

  function renderBookExperience(book, handlers = {}) {
    const shell = elements.bookExperience;
    if (!shell) return;
    if (!book || book.type === "pdf" || !runtime.queue.length) {
      shell.hidden = true;
      return;
    }

    shell.hidden = false;
    const chapters = runtime.chapters?.length
      ? runtime.chapters
      : [{ title: "Start reading", chapterIndex: 0, startChunk: 0, endChunk: runtime.queue.length - 1 }];
    const words = countWords(state.text);
    const minutes = Math.max(1, Math.round(words / 180));
    const current = Math.max(0, runtime.currentIndex);
    const pct = runtime.queue.length ? Math.round((current / runtime.queue.length) * 100) : 0;

    if (elements.bookExperienceType) {
      elements.bookExperienceType.textContent =
        book.type === "epub" ? "EPUB transformed into a reader" : "Imported reader";
    }
    if (elements.bookExperienceTitle) elements.bookExperienceTitle.textContent = book.title || state.title || "Untitled";
    if (elements.bookExperienceAuthor) {
      elements.bookExperienceAuthor.textContent = book.author ? `by ${book.author}` : "Personal reading edition";
    }
    if (elements.bookExperienceStats) {
      elements.bookExperienceStats.innerHTML = `
        <span>${chapters.length.toLocaleString()} chapters</span>
        <span>${runtime.queue.length.toLocaleString()} sections</span>
        <span>${words.toLocaleString()} words</span>
        <span>${minutes.toLocaleString()} min</span>
        <span>${pct}% read</span>
      `;
    }
  }

  function updateReaderTitle() {
    elements.readerTitle.textContent = state.title.trim() || "Untitled";
  }

  function updateReaderProgress() {
    const current =
      runtime.currentIndex >= 0
        ? Math.min(runtime.currentIndex + 1, runtime.queue.length)
        : 0;
    const ch = runtime.queue[runtime.currentIndex];
    const chLabel = ch?.chapterTitle ? ` · ${ch.chapterTitle}` : "";
    elements.readerProgress.textContent = `${current} / ${runtime.queue.length}${chLabel}`;
    renderBookExperienceFromCurrent();
    updateListenContents();
  }

  function updateListenContents() {
    const hasQueue = runtime.queue.length > 0;
    const chapters = runtime.chapters?.length
      ? runtime.chapters
      : hasQueue
        ? [{ title: "Full text", chapterIndex: 0, startChunk: 0, endChunk: runtime.queue.length - 1 }]
        : [];

    const isPdfTab = document.body.classList.contains("is-pdf-tab");
    const pdfListenActive =
      isPdfTab &&
      (document.body.classList.contains("pdf-mode-listen") ||
        document.body.classList.contains("pdf-mode-advanced"));
    const listenActive =
      state.listenLayoutActive ||
      runtime.mode === "playing" ||
      runtime.mode === "paused";

    document.body.classList.toggle("is-listen-layout", hasQueue && (listenActive || pdfListenActive));

    const epubToggle = document.getElementById("epub-reader-mode-toggle");
    const isEpubSession = hasQueue && !isPdfTab;
    if (epubToggle) epubToggle.hidden = !isEpubSession;
    document.body.classList.toggle(
      "epub-mode-advanced",
      isEpubSession && state.epubReaderMode === "advanced"
    );

    const epubAdvancedActive =
      isEpubSession && state.epubReaderMode === "advanced";
    const playerPanel = document.getElementById("listen-contents-panel");
    if (playerPanel) {
      const showPlayerToc =
        hasQueue &&
        chapters.length &&
        !isPdfTab &&
        (listenActive || epubAdvancedActive);
      playerPanel.hidden = !showPlayerToc;
      if (!playerPanel.hidden) {
        playerPanel.classList.toggle(
          "is-collapsed",
          !state.contentsPanelOpen
        );
        const collapseBtn = document.getElementById("contents-collapse-btn");
        const expandBtn = document.getElementById("contents-expand-btn");
        if (collapseBtn) collapseBtn.hidden = !state.contentsPanelOpen;
        if (expandBtn) expandBtn.hidden = state.contentsPanelOpen;
      }
    }

    if (elements.bookExperience) {
      elements.bookExperience.hidden = !hasQueue || listenActive || isPdfTab;
    }

    const onChapter = (startChunk) => {
      if (typeof state.onChapterJump === "function") state.onChapterJump(startChunk);
      else if (typeof state.onChunkChange === "function") state.onChunkChange(startChunk);
    };

    const playerTocList = document.getElementById("player-listen-toc-list");
    const playerTocCount = document.getElementById("player-listen-toc-count");
    const pdfTocList = document.getElementById("pdf-listen-toc-list");
    const pdfTocCount = document.getElementById("pdf-listen-toc-count");

    const pdfTab = isPdfTab;
    const epubTab = !isPdfTab;

    if (pdfTab) {
      if (hasQueue && chapters.length) {
        renderChapterTOC({ listEl: pdfTocList, countEl: pdfTocCount, chapters, runtime, onChapter });
      } else {
        renderChapterTOC({ listEl: pdfTocList, countEl: pdfTocCount, chapters: [], runtime, onChapter });
      }
      renderChapterTOC({ listEl: playerTocList, countEl: playerTocCount, chapters: [], runtime, onChapter });
    } else if (epubTab) {
      if (hasQueue && chapters.length) {
        renderChapterTOC({ listEl: playerTocList, countEl: playerTocCount, chapters, runtime, onChapter });
      } else {
        renderChapterTOC({ listEl: playerTocList, countEl: playerTocCount, chapters: [], runtime, onChapter });
      }
      renderChapterTOC({ listEl: pdfTocList, countEl: pdfTocCount, chapters: [], runtime, onChapter });
    }

    syncChapterTOCActive(playerTocList, runtime);
    syncChapterTOCActive(pdfTocList, runtime);

    updateEpubChapterNav(runtime, epubAdvancedActive);
  }

  function updateEpubChapterNav(runtime, visible) {
    const nav = document.getElementById("epub-chapter-nav");
    if (!nav) return;
    nav.hidden = !visible;
    if (!visible) return;

    const chunk = runtime.queue[runtime.currentIndex];
    const chapterIndex = chunk?.chapterIndex ?? 0;
    const chapters = runtime.chapters || [];
    const idx = chapters.findIndex((c) => c.chapterIndex === chapterIndex);
    const chapter = chapters[idx];
    const titleEl = document.getElementById("epub-chapter-nav-title");
    if (titleEl) {
      titleEl.textContent = chapter?.title || chunk?.chapterTitle || "Chapter";
    }

    const prevBtn = document.getElementById("epub-prev-chapter");
    const nextBtn = document.getElementById("epub-next-chapter");
    if (prevBtn) prevBtn.disabled = idx <= 0;
    if (nextBtn) nextBtn.disabled = idx < 0 || idx >= chapters.length - 1;
  }

  function playChapterTransition(chunk, { completedPrevious = true } = {}) {
    const box = elements.chapterTransition;
    if (!box || !chunk) return Promise.resolve();

    const chapterIndex = chunk.chapterIndex ?? 0;
    const chapterTitle = chunk.chapterTitle || `Chapter ${chapterIndex + 1}`;
    const chapter = runtime.chapters?.find((item) => item.chapterIndex === chapterIndex);
    const total = chapter ? chapter.endChunk - chapter.startChunk + 1 : 1;

    if (elements.chapterTransitionKicker) {
      elements.chapterTransitionKicker.textContent = completedPrevious
        ? `Chapter ${chapterIndex + 1}`
        : `Entering chapter ${chapterIndex + 1}`;
    }
    if (elements.chapterTransitionTitle) {
      elements.chapterTransitionTitle.textContent = chapterTitle;
    }
    if (elements.chapterTransitionMeta) {
      elements.chapterTransitionMeta.textContent =
        `${total} listening parts · ${runtime.queue.length.toLocaleString()} sections total`;
    }

    return new Promise((resolve) => {
      if (chapterTransitionTimer) {
        clearTimeout(chapterTransitionTimer);
        chapterTransitionTimer = null;
      }

      box.hidden = false;
      box.classList.remove("is-revealing", "is-exiting");
      void box.offsetWidth;
      box.classList.add("is-revealing");

      chapterTransitionTimer = setTimeout(() => {
        box.classList.add("is-exiting");
        chapterTransitionTimer = setTimeout(() => {
          box.classList.remove("is-revealing", "is-exiting");
          box.hidden = true;
          chapterTransitionTimer = null;
          resolve();
        }, 520);
      }, TRANSITION_MS);
    });
  }

  function renderBookExperienceFromCurrent() {
    const shell = elements.bookExperience;
    if (!shell || shell.hidden) return;
    shell.querySelectorAll(".book-toc-item").forEach((el) => {
      const idx = Number(el.dataset.startChunk);
      const end = Number(el.dataset.endChunk);
      el.classList.toggle("is-active", runtime.currentIndex >= idx && runtime.currentIndex <= end);
    });
  }

  function updateReaderPreview() {
    const chunk = runtime.queue[runtime.currentIndex];
    const advanced = state.epubReaderMode === "advanced";
    elements.readerPreview?.classList.toggle("is-epub-advanced", advanced);
    const card = elements.readerPreview?.closest(".now-reading-card");
    card?.classList.toggle("is-epub-advanced-card", advanced);

    if (!chunk) {
      elements.readerPreview.classList.add("empty");
      elements.readerPreview.textContent = "Press Play to start listening.";
      currentlyRenderedWindow = null;
      return;
    }
    elements.readerPreview.classList.remove("empty");
    elements.readerPreview.classList.add("chunk-animate");

    if (advanced) {
      applyNovelTypography(elements.readerPreview, {
        fontId: state.novelFontId,
        sizeId: state.novelSizeId,
      });
      ensureNovelTypographyToolbar(elements.readerPreview, {
        fontId: state.novelFontId,
        sizeId: state.novelSizeId,
        onChange: (next) => {
          state.novelFontId = next.fontId;
          state.novelSizeId = next.sizeId;
          persistState(state);
          applyNovelTypography(elements.readerPreview, next);
        },
      });
    } else {
      elements.readerPreview.querySelector(".novel-typography-wrap")?.remove();
    }

    const currentChapter = chunk.chapterIndex ?? 0;

    const bodySelector = advanced ? ".epub-advanced-body" : ".reader-paragraph";
    let needsRebuild = !elements.readerPreview.querySelector(bodySelector);
    if (!needsRebuild && currentlyRenderedWindow) {
      if (currentlyRenderedWindow.chapter !== currentChapter) needsRebuild = true;
      if (runtime.currentIndex < currentlyRenderedWindow.start) needsRebuild = true;
      if (runtime.currentIndex > currentlyRenderedWindow.end - 5 && currentlyRenderedWindow.end < runtime.queue.length - 1 && (runtime.queue[currentlyRenderedWindow.end + 1].chapterIndex ?? 0) === currentChapter) needsRebuild = true;
    } else {
      needsRebuild = true;
    }

    if (needsRebuild) {
      let startIndex = runtime.currentIndex;
      while (startIndex > 0 && (runtime.queue[startIndex - 1].chapterIndex ?? 0) === currentChapter && (runtime.currentIndex - startIndex < 30)) {
        startIndex--;
      }
      let endIndex = runtime.currentIndex;
      while (endIndex < runtime.queue.length - 1 && (runtime.queue[endIndex + 1].chapterIndex ?? 0) === currentChapter && (endIndex - runtime.currentIndex < 80)) {
        endIndex++;
      }
      
      currentlyRenderedWindow = { chapter: currentChapter, start: startIndex, end: endIndex };

      const chapterMeta = runtime.chapters?.find((c) => c.chapterIndex === currentChapter);
      const chapterTitle = chunk.chapterTitle || chapterMeta?.title || `Chapter ${currentChapter + 1}`;
      const partTotal = chapterMeta
        ? chapterMeta.endChunk - chapterMeta.startChunk + 1
        : endIndex - startIndex + 1;

      elements.readerPreview.innerHTML = "";

      if (advanced) {
        const hero = document.createElement("header");
        hero.className = "epub-advanced-hero pdf-advanced-hero";
        hero.innerHTML = `
          <p class="pdf-advanced-kicker">Chapter ${currentChapter + 1}</p>
          <div class="pdf-advanced-ornament" aria-hidden="true"><span></span><span></span><span></span></div>
          <h1 class="pdf-advanced-title">${escapeHtml(chapterTitle)}</h1>
          <p class="pdf-advanced-meta">${partTotal} parts in this chapter</p>
        `;

        const body = document.createElement("article");
        body.className = "epub-advanced-body pdf-advanced-body";
        for (let i = startIndex; i <= endIndex; i += 1) {
          const p = document.createElement("p");
          p.className = "advanced-verse reader-paragraph";
          p.dataset.chunkIndex = String(i);
          p.textContent = runtime.queue[i].text;
          p.addEventListener("dblclick", () => {
            runtime.currentIndex = i;
            runtime.activeWordRange = null;
            renderQueue(false);
            updateReaderPreview();
            if (state.onChunkChange) state.onChunkChange(i);
          });
          body.appendChild(p);
        }
        elements.readerPreview.appendChild(hero);
        elements.readerPreview.appendChild(body);

        applyNovelTypography(elements.readerPreview, {
          fontId: state.novelFontId,
          sizeId: state.novelSizeId,
        });
        ensureNovelTypographyToolbar(elements.readerPreview, {
          fontId: state.novelFontId,
          sizeId: state.novelSizeId,
          onChange: (next) => {
            state.novelFontId = next.fontId;
            state.novelSizeId = next.sizeId;
            persistState(state);
            applyNovelTypography(elements.readerPreview, next);
          },
        });
      } else {
        const fragment = document.createDocumentFragment();
        for (let i = startIndex; i <= endIndex; i += 1) {
          const p = document.createElement("p");
          p.className = "reader-paragraph";
          p.dataset.chunkIndex = String(i);
          p.textContent = runtime.queue[i].text;
          p.addEventListener("dblclick", () => {
            runtime.currentIndex = i;
            runtime.activeWordRange = null;
            renderQueue(false);
            updateReaderPreview();
            if (state.onChunkChange) state.onChunkChange(i);
          });
          fragment.appendChild(p);
        }
        elements.readerPreview.appendChild(fragment);
      }
    }

    updateEpubChapterNav(runtime, advanced);

    // Update active word highlighting and styling
    const paragraphs = elements.readerPreview.querySelectorAll(".reader-paragraph");
    let activeElement = null;

    paragraphs.forEach((p) => {
      const idx = Number(p.dataset.chunkIndex);
      if (idx === runtime.currentIndex) {
        activeElement = p;
        p.classList.add("is-active-chunk");
        
        if (runtime.activeWordRange && runtime.activeWordRange.chunkIndex === runtime.currentIndex) {
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

    // Auto-scroll to the active chunk if not actively speaking a word
    if (activeElement && !runtime.activeWordRange && runtime.mode === "playing") {
      activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function setTransportState() {
    const isPlaying = runtime.mode === "playing";
    const isPaused = runtime.mode === "paused";
    [elements.playButton, elements.playButtonLarge].forEach((button) => {
      if (button) button.disabled = isPlaying;
    });
    [elements.pauseButton, elements.pauseButtonLarge].forEach((button) => {
      if (button) button.disabled = !isPlaying;
    });
    [elements.resumeButton, elements.resumeButtonLarge].forEach((button) => {
      if (button) button.disabled = !isPaused;
    });
    [elements.stopButton, elements.stopButtonLarge].forEach((button) => {
      if (button) button.disabled = !(isPlaying || isPaused);
    });
  }

  function setStatus(label, message, isError) {
    elements.playbackStatus.textContent = label;
    elements.statusMessage.textContent = message;
    if (elements.statusCard) {
      elements.statusCard.dataset.state = isError
        ? "error"
        : label.toLowerCase() === "playing"
          ? "playing"
          : label.toLowerCase() === "paused"
            ? "paused"
            : "";
    }
  }

  function countWords(text) {
    return String(text || "").trim().split(/\s+/).filter(Boolean).length;
  }

  return {
    renderProviderPicker,
    renderCredentialsForms,
    hydrateInputs,
    populateVoiceSelect,
    updateStats,
    rebuildQueue,
    debouncedRebuild,
    renderQueue,
    renderChapterJump,
    renderBookmarks,
    renderLibrary,
    renderBookExperience,
    playChapterTransition,
    updateListenContents,
    updateReaderTitle,
    updateReaderProgress,
    updateReaderPreview,
    setTransportState,
    setStatus,
  };
}
