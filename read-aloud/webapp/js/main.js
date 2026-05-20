import { persistState, loadState, flushPersist } from "./storage.js";
import { createProviders } from "./providers.js";
import { createUi } from "./ui.js";
import { effectivePlaybackVolume, releaseAudioResources } from "./audio.js";
import { buildChunks } from "./queue.js";
import { buildChapterIndex } from "./chapters.js";
import { updateLoadProgress, hideLoadProgress } from "./book-load-progress.js";
import { setActiveBookType } from "./session-context.js";
import {
  initFlipbook,
  onPageAudioDone,
  onChapterAudioDone,
  syncFlipbookToChunk,
  setPdfDisplayQueue,
  refreshPdfListenView,
  refreshPdfAdvancedView,
  getPdfReaderMode,
  getPdfCurrentPage,
  isPdfExtractionBusy,
} from "./pdf-flipbook.js?v=pdf-full-fix";
import { createNovelFeatures } from "./novel-features.js";
import {
  listBooks,
  saveBook,
  loadBook,
  removeBook,
  importTxtFile,
  importEpubFile,
  importPdfFile,
  importFromUrl,
} from "./library.js";
import { debounce } from "./utils.js";
import { initThemeManager } from "./theme.js";
import { initMicroInteractions } from "./micro-interactions.js";
import { initThreeBackground } from "./three-bg.js";

const elements = {
  providerPicker: document.getElementById("provider-picker"),
  voiceSelect: document.getElementById("voice-select"),
  dialogueVoiceSelect: document.getElementById("dialogue-voice-select"),
  textInput: document.getElementById("text-input"),
  titleInput: document.getElementById("document-title"),
  charCount: document.getElementById("char-count"),
  chunkCount: document.getElementById("chunk-count"),
  chunkMode: document.getElementById("chunk-mode"),
  rateInput: document.getElementById("rate-input"),
  pitchInput: document.getElementById("pitch-input"),
  volumeInput: document.getElementById("volume-input"),
  rateOutput: document.getElementById("rate-output"),
  pitchOutput: document.getElementById("pitch-output"),
  volumeOutput: document.getElementById("volume-output"),
  playButton: document.getElementById("play-button"),
  pauseButton: document.getElementById("pause-button"),
  resumeButton: document.getElementById("resume-button"),
  stopButton: document.getElementById("stop-button"),
  playButtonLarge: document.getElementById("play-button-2"),
  pauseButtonLarge: document.getElementById("pause-button-2"),
  resumeButtonLarge: document.getElementById("resume-button-2"),
  stopButtonLarge: document.getElementById("stop-button-2"),
  downloadButton: document.getElementById("download-button"),
  downloadChapterBtn: document.getElementById("download-chapter-btn"),
  playbackStatus: document.getElementById("playback-status"),
  statusMessage: document.getElementById("status-message"),
  statusCard: document.getElementById("status-card"),
  refreshVoices: document.getElementById("refresh-voices"),
  saveCredentials: document.getElementById("save-credentials"),
  credentialsForms: document.getElementById("credentials-forms"),
  readerTitle: document.getElementById("reader-title"),
  readerProgress: document.getElementById("reader-progress"),
  readerPreview: document.getElementById("reader-preview"),
  chunkList: document.getElementById("chunk-list"),
  chapterJump: document.getElementById("chapter-jump"),
  bookmarksList: document.getElementById("bookmarks-list"),
  sampleButton: document.getElementById("sample-button"),
  clearButton: document.getElementById("clear-button"),
  fileInput: document.getElementById("file-input"),
  libraryGrid: document.getElementById("library-grid"),
  libraryTxtInput: document.getElementById("library-txt-input"),
  libraryEpubInput: document.getElementById("library-epub-input"),
  libraryPdfInput: document.getElementById("library-pdf-input"),
  libraryUrlBtn: document.getElementById("library-url-btn"),
  sleepTimerSelect: document.getElementById("sleep-timer"),
  sleepTimerLabel: document.getElementById("sleep-timer-label"),
  playbackModeSelect: document.getElementById("playback-mode"),
  focusModeBtn: document.getElementById("focus-mode-btn"),
  bookmarkBtn: document.getElementById("bookmark-btn"),
  replayChunkBtn: document.getElementById("replay-chunk-btn"),
  pronunciationInput: document.getElementById("pronunciation-input"),
  pronunciationSave: document.getElementById("pronunciation-save"),
  exportProgressBtn: document.getElementById("export-progress-btn"),
  importProgressInput: document.getElementById("import-progress-input"),
  bookExperience: document.getElementById("book-experience"),
  bookExperienceType: document.getElementById("book-experience-type"),
  bookExperienceTitle: document.getElementById("book-experience-title"),
  bookExperienceAuthor: document.getElementById("book-experience-author"),
  bookExperienceStats: document.getElementById("book-experience-stats"),
  bookStartBtn: document.getElementById("book-start-btn"),
  bookContinueBtn: document.getElementById("book-continue-btn"),
  chapterTransition: document.getElementById("chapter-transition"),
  chapterTransitionKicker: document.getElementById("chapter-transition-kicker"),
  chapterTransitionTitle: document.getElementById("chapter-transition-title"),
  chapterTransitionMeta: document.getElementById("chapter-transition-meta"),
};

const persisted = loadState();
const state = {
  provider: persisted.provider || "googleTranslate",
  voiceId: persisted.voiceId || "",
  dialogueVoiceId: persisted.dialogueVoiceId || "",
  text: persisted.text || "",
  title: persisted.title || "",
  chunkMode: persisted.chunkMode || "novel",
  rate: persisted.rate ?? 1,
  pitch: persisted.pitch ?? 1,
  volume: persisted.volume ?? 1,
  credentials: persisted.credentials || {},
  cachedVoices: persisted.cachedVoices || {},
  activeBookId: persisted.activeBookId || "",
  playbackMode: persisted.playbackMode || "normal",
  sleepTimerMinutes: persisted.sleepTimerMinutes || 0,
  focusMode: persisted.focusMode || false,
  bookmarks: persisted.bookmarks || [],
  globalPronunciations: persisted.globalPronunciations || {},
  activeBookPronunciations: persisted.activeBookPronunciations || {},
  bookChapters: [],
  resumeChunkIndex: 0,
  replayOnce: false,
  listenLayoutActive: false,
  contentsPanelOpen: persisted.contentsPanelOpen ?? false,
  epubReaderMode: persisted.epubReaderMode || "listen",
  novelFontId: persisted.novelFontId || "literata",
  novelSizeId: persisted.novelSizeId || "roomy",
};

const runtime = {
  mode: "idle",
  queue: [],
  chapters: [],
  currentIndex: -1,
  activeWordRange: null,
  stopRequested: false,
  paused: false,
  currentAudio: null,
  currentUtterance: null,
  currentObjectUrl: null,
};

const providers = createProviders(state, runtime);
const ui = createUi(elements, state, runtime, providers, persistState);

let novel;
let pdfApi;
let activeBook = null;

const saveProgressDebounced = debounce(() => saveActiveBookProgress(), 600);

initialize().catch((error) => {
  console.error(error);
  ui.setStatus("Error", error.message, true);
});

async function initialize() {
  initThemeManager();
  initMicroInteractions();
  initThreeBackground();
  ui.renderProviderPicker(handleProviderSelect);
  ui.renderCredentialsForms();
  ui.hydrateInputs();
  bindEvents();
  bindContentsToggle();

  state.onChunkChange = (index) => {
    // NOTE: UI click handlers already set runtime.currentIndex and called renderQueue
    // before invoking this. We only handle side-effects here to avoid infinite recursion.
    if (runtime.mode === "playing" || runtime.mode === "paused") {
      stopPlayback();
      setTimeout(() => startPlayback(), 50);
    }
    state.resumeChunkIndex = index;
    saveProgressDebounced();
    persistState(state);
  };

  state.onChapterJump = async (startChunk) => {
    const prev = runtime.queue[runtime.currentIndex];
    const next = runtime.queue[startChunk];
    if (!next) return;
    const chapterChanged =
      prev && (prev.chapterIndex ?? 0) !== (next.chapterIndex ?? 0);
    goToChunk(startChunk);
    ui.updateListenContents();
    refreshPdfListenView(runtime);
    refreshPdfAdvancedView(runtime);
    if (chapterChanged) {
      await ui.playChapterTransition(next, { completedPrevious: true });
    }
    if (runtime.mode === "playing" || runtime.mode === "paused") {
      stopPlayback();
      setTimeout(() => startPlayback(), chapterChanged ? 160 : 50);
    }
    state.resumeChunkIndex = startChunk;
    saveProgressDebounced();
    persistState(state);
  };

  novel = createNovelFeatures({
    state,
    runtime,
    elements,
    ui,
    persistState,
    stopPlayback,
    startPlayback,
    pausePlayback,
    resumePlayback,
    goToChunk,
    saveActiveBookProgress,
    reloadLibrary: refreshLibrary,
  });
  novel.bindControls();

  pdfApi = initFlipbook({
    onPdfLoaded: (file, url) => {
      console.log("PDF loaded in flipbook:", file.name);
      setActiveBookType("pdf");
      stopPlayback({ silent: true });
      if (isPdfExtractionBusy()) {
        window.__pdfListenRuntime = runtime;
        return;
      }
      runtime.queue = [];
      runtime.chapters = [];
      runtime.currentIndex = -1;
      // ── FIX: expose the cleared runtime immediately so renderPdfQueue()
      //         no longer shows stale EPUB chapters in the PDF sidebar.
      window.__pdfListenRuntime = runtime;
      setPdfDisplayQueue([]);
      ui.renderQueue();
      ui.updateListenContents();
    },
    onTextExtracted: (pdfChunks, meta) => {
      if (!pdfChunks?.length) {
        window.__pdfListenRuntime = runtime;
        return;
      }
      runtime.queue = buildPdfPlaybackQueue(pdfChunks, {
        ...meta,
        fromPdfExtraction: true,
      });
      runtime.chapters = buildChapterIndex(runtime.queue);
      if (runtime.currentIndex < 0 && runtime.queue.length) runtime.currentIndex = 0;
      runtime.currentIndex = Math.min(
        Math.max(0, state.resumeChunkIndex || meta?.restoreChunk || 0),
        Math.max(0, runtime.queue.length - 1)
      );
      window.__pdfListenRuntime = runtime;
      setPdfDisplayQueue(runtime.queue);
      ui.renderQueue();
      ui.updateListenContents();
      refreshPdfListenView(runtime);
      refreshPdfAdvancedView(runtime);
      hideLoadProgress();
    },
    onPlayRequested: (chunkIdx) => {
      runtime.currentIndex = Math.max(0, Math.min(chunkIdx, runtime.queue.length - 1));
      startPlayback();
    },
    onStopRequested: () => stopPlayback(),
    onPrevRequested: () => {
      if (runtime.currentIndex > 0) goToChunk(runtime.currentIndex - 1);
    },
    onNextRequested: () => {
      if (runtime.currentIndex < runtime.queue.length - 1) goToChunk(runtime.currentIndex + 1);
    },
    onPageFlip: (pageNum) => {
      savePdfBookProgress({
        pageIndex: Math.max(0, pageNum - 1),
        pdfReaderMode: getPdfReaderMode(),
      });
    },
    onReaderModeChange: (mode, meta) => {
      savePdfBookProgress({
        pdfReaderMode: mode,
        chunkIndex: meta?.chunkIndex ?? runtime.currentIndex,
        pageIndex: meta?.pageIndex ?? getPdfCurrentPage() - 1,
      });
    },
    onStopTts: () => stopPlayback(),
    onListenLayoutChange: () => ui.updateListenContents(),
    onChapterJump: async (startChunk) => {
      await state.onChapterJump?.(startChunk);
    },
    onAdjacentChapter: (delta) => {
      const chapters = runtime.chapters;
      if (!chapters?.length || runtime.currentIndex < 0) return;
      const ci = runtime.queue[runtime.currentIndex]?.chapterIndex ?? 0;
      const idx = chapters.findIndex((c) => c.chapterIndex === ci);
      const target = chapters[idx + delta];
      if (target) state.onChapterJump?.(target.startChunk);
    },
  });

  window.__novelTypographySettings = {
    fontId: state.novelFontId,
    sizeId: state.novelSizeId,
  };
  window.__onNovelTypographyChange = (next) => {
    state.novelFontId = next.fontId;
    state.novelSizeId = next.sizeId;
    window.__novelTypographySettings = next;
    persistState(state);
  };

  const resetEpubReaderDom = () => {
    if (elements.readerPreview) elements.readerPreview.innerHTML = "";
  };
  document.getElementById("player-mode-listen")?.addEventListener("click", () => {
    state.epubReaderMode = "listen";
    persistState(state);
    document.getElementById("player-mode-listen")?.classList.add("is-active");
    document.getElementById("player-mode-advanced")?.classList.remove("is-active");
    resetEpubReaderDom();
    ui.updateListenContents();
    ui.updateReaderPreview();
  });
  document.getElementById("player-mode-advanced")?.addEventListener("click", () => {
    state.epubReaderMode = "advanced";
    persistState(state);
    document.getElementById("player-mode-advanced")?.classList.add("is-active");
    document.getElementById("player-mode-listen")?.classList.remove("is-active");
    resetEpubReaderDom();
    ui.updateListenContents();
    ui.updateReaderPreview();
  });
  if (state.epubReaderMode === "advanced") {
    document.getElementById("player-mode-advanced")?.classList.add("is-active");
    document.getElementById("player-mode-listen")?.classList.remove("is-active");
  }

  function goToAdjacentChapter(delta) {
    const chapters = runtime.chapters;
    if (!chapters?.length || runtime.currentIndex < 0) return;
    const ci = runtime.queue[runtime.currentIndex]?.chapterIndex ?? 0;
    const idx = chapters.findIndex((c) => c.chapterIndex === ci);
    const target = chapters[idx + delta];
    if (target) {
      if (typeof state.onChapterJump === "function") {
        state.onChapterJump(target.startChunk);
      } else {
        goToChunk(target.startChunk);
      }
    }
  }

  document.getElementById("epub-prev-chapter")?.addEventListener("click", () => {
    goToAdjacentChapter(-1);
  });
  document.getElementById("epub-next-chapter")?.addEventListener("click", () => {
    goToAdjacentChapter(1);
  });

  await refreshVoices();
  const books = await refreshLibrary();

  if (state.activeBookId) {
    const book = await loadBook(state.activeBookId);
    if (book) await openBook(book, { switchTab: false });
    else clearActiveBookSession({ persist: true });
  } else if (!books.length && (state.text || state.title)) {
    clearActiveBookSession({ persist: true });
  } else {
    ui.updateStats();
    ui.rebuildQueue();
  }

  ui.setTransportState();
  ui.updateListenContents();
  ui.setStatus("Ready", "Open a book from Library or paste text in Edit.");
}

function bindContentsToggle() {
  const panel = document.getElementById("listen-contents-panel");
  const collapseBtn = document.getElementById("contents-collapse-btn");
  const expandBtn = document.getElementById("contents-expand-btn");

  const apply = () => {
    if (!panel) return;
    const open = !!state.contentsPanelOpen;
    panel.classList.toggle("is-collapsed", !open);
    if (collapseBtn) collapseBtn.hidden = !open;
    if (expandBtn) expandBtn.hidden = open;
    collapseBtn?.setAttribute("aria-expanded", open ? "true" : "false");
    expandBtn?.setAttribute("aria-expanded", open ? "true" : "false");
  };

  collapseBtn?.addEventListener("click", () => {
    state.contentsPanelOpen = false;
    persistState(state);
    apply();
  });
  expandBtn?.addEventListener("click", () => {
    state.contentsPanelOpen = true;
    persistState(state);
    apply();
  });

  apply();
}

function bindEvents() {
  elements.textInput?.addEventListener("input", () => {
    state.text = elements.textInput.value;
    ui.updateStats();
    ui.debouncedRebuild();
  });

  elements.titleInput?.addEventListener("input", () => {
    state.title = elements.titleInput.value;
    persistState(state);
    ui.updateReaderTitle();
    if (activeBook) {
      activeBook.title = state.title;
      saveBook(activeBook);
    }
  });

  elements.chunkMode?.addEventListener("change", () => {
    state.chunkMode = elements.chunkMode.value;
    persistState(state, true);
    ui.rebuildQueue();
  });

  elements.rateInput?.addEventListener("input", onRateChange);
  elements.pitchInput?.addEventListener("input", onPitchChange);
  elements.volumeInput?.addEventListener("input", onVolumeChange);
  elements.voiceSelect?.addEventListener("change", () => {
    state.voiceId = elements.voiceSelect.value;
    persistState(state);
  });

  elements.playButton?.addEventListener("click", startPlayback);
  elements.pauseButton?.addEventListener("click", pausePlayback);
  elements.resumeButton?.addEventListener("click", resumePlayback);
  elements.stopButton?.addEventListener("click", stopPlayback);
  elements.downloadButton?.addEventListener("click", downloadAudio);
  elements.downloadChapterBtn?.addEventListener("click", downloadCurrentChapter);
  elements.refreshVoices?.addEventListener("click", () => refreshVoices(true));
  elements.saveCredentials?.addEventListener("click", saveCredentialInputs);
  elements.sampleButton?.addEventListener("click", loadSampleText);
  elements.clearButton?.addEventListener("click", clearDocument);
  elements.fileInput?.addEventListener("change", importTextFile);

  elements.libraryTxtInput?.addEventListener("change", (e) => importToLibrary(e, "txt"));
  elements.libraryEpubInput?.addEventListener("change", (e) => importToLibrary(e, "epub"));
  elements.libraryPdfInput?.addEventListener("change", (e) => importToLibrary(e, "pdf"));
  elements.libraryUrlBtn?.addEventListener("click", importUrlToLibrary);
  elements.bookStartBtn?.addEventListener("click", () => {
    state.listenLayoutActive = true;
    ui.updateListenContents();
    goToChunk(0);
    startPlayback();
  });
  elements.bookContinueBtn?.addEventListener("click", () => {
    state.listenLayoutActive = true;
    ui.updateListenContents();
    startPlayback();
  });
}

async function importToLibrary(event, type) {
  const file = event.target.files?.[0];
  if (!file) return;
  event.target.value = "";
  try {
    ui.setStatus("Loading", `Adding ${file.name}…`);
    let book;
    if (type === "epub") book = await importEpubFile(file);
    else if (type === "pdf") book = await importPdfFile(file);
    else book = await importTxtFile(file);
    await refreshLibrary();
    await openBook(book);
    ui.setStatus("Ready", `Added “${book.title}”.`);
  } catch (err) {
    ui.setStatus("Error", err.message, true);
  }
}

async function importUrlToLibrary() {
  const url = prompt("Paste a link to plain text or HTML:");
  if (!url) return;
  try {
    ui.setStatus("Loading", "Fetching…");
    const book = await importFromUrl(url);
    await refreshLibrary();
    await openBook(book);
  } catch (err) {
    ui.setStatus("Error", err.message, true);
  }
}

async function refreshLibrary() {
  const books = await listBooks();
  for (const b of books) {
    if (b.text) {
      const { buildChunks } = await import("./queue.js");
      b.totalChunks = buildChunks(b.text, state.chunkMode, { useChapters: true }).length;
    } else if (b.type === "pdf") {
      b.totalChunks = b.progress?.pageCount || 0;
    }
  }
  ui.renderLibrary(books, {
    onOpen: (book) => openBook(book),
    onReimport: () => {
      ui.setStatus("Loading", "Choose the EPUB file again to rebuild this reader.");
      elements.libraryEpubInput?.click();
    },
    onDelete: async (book) => {
      const deletingActiveBook = state.activeBookId === book.id;
      if (deletingActiveBook) stopPlayback({ silent: true });
      await removeBook(book.id);
      if (deletingActiveBook) clearActiveBookSession({ persist: true });
      await refreshLibrary();
      if (deletingActiveBook) ui.setStatus("Removed", "That book was deleted completely from this browser.");
    },
  });
  return books;
}

async function openBook(book, { switchTab = true } = {}) {
  if (book.type === "epub" && !book.text && book.epubBlob) {
    ui.setStatus("Loading", `Rebuilding "${book.title}" from EPUB...`);
    const rebuilt = await import("./epub.js").then((m) => m.extractTextFromEpub(book.epubBlob));
    book = {
      ...book,
      title: rebuilt.title || book.title,
      author: rebuilt.author || book.author || "",
      chapters: rebuilt.chapters || [],
      text: rebuilt.text || "",
    };
    await saveBook(book);
  }
  if (book.type === "epub" && !book.text) {
    ui.setStatus("Error", "This EPUB was imported before readable text was stored. Delete it and add the EPUB again.", true);
    return;
  }

  activeBook = book;
  state.activeBookId = book.id;
  state.title = book.title;
  state.bookChapters = Array.isArray(book.chapters) ? book.chapters : [];
  state.bookmarks = book.bookmarks || [];
  state.activeBookPronunciations = book.pronunciations || {};
  state.resumeChunkIndex = book.progress?.chunkIndex ?? 0;
  book.lastOpenedAt = Date.now();

  if (book.type === "pdf" && book.pdfBlob) {
    setActiveBookType("pdf");
    state.listenLayoutActive = false;
    runtime.chapters = [];
    runtime.queue = [];
    await saveBook(book);
    persistState(state, true);
    if (switchTab) window.switchTab?.("pdfreader");
    await pdfApi?.loadPdfBlob(book.pdfBlob, book, { activateTab: switchTab });
    return;
  }

  setActiveBookType(book.type === "txt" ? "txt" : "epub");
  state.text = book.text || "";
  elements.textInput.value = state.text;
  elements.titleInput.value = state.title;
  runtime.currentIndex = state.resumeChunkIndex;
  if (elements.pronunciationInput) {
    const { dictToLines } = await import("./pronunciation.js");
    elements.pronunciationInput.value = dictToLines(state.activeBookPronunciations);
  }

  ui.rebuildQueue();
  runtime.currentIndex = Math.min(state.resumeChunkIndex, runtime.queue.length - 1);
  ui.renderQueue(true);
  ui.renderBookExperience(book, {
    onChapter: (chunkIndex) => {
      if (typeof state.onChapterJump === "function") {
        state.onChapterJump(chunkIndex);
      } else {
        goToChunk(chunkIndex);
      }
    },
  });
  await saveBook(book);
  persistState(state, true);

  if (switchTab) window.switchTab?.("player");
  state.listenLayoutActive = state.resumeChunkIndex > 0;
  ui.updateListenContents();
  ui.setStatus("Ready", `Continue “${book.title}” from section ${runtime.currentIndex + 1}.`);
}

async function saveActiveBookProgress() {
  if (!activeBook || activeBook.type === "pdf") return;
  activeBook.progress = {
    chunkIndex: runtime.currentIndex,
    chapterIndex: runtime.queue[runtime.currentIndex]?.chapterIndex ?? 0,
  };
  activeBook.bookmarks = state.bookmarks;
  activeBook.pronunciations = state.activeBookPronunciations;
  activeBook.totalChunks = runtime.queue.length;
  await saveBook(activeBook);
  await refreshLibrary();
}

function savePdfBookProgress(progress) {
  if (!activeBook || activeBook.type !== "pdf") return;
  activeBook.progress = { ...activeBook.progress, ...progress };
  saveBook(activeBook);
}

function goToChunk(index) {
  if (index < 0 || index >= runtime.queue.length) return;
  runtime.currentIndex = index;
  runtime.activeWordRange = null;
  ui.renderQueue(true);
  syncFlipbookToChunk(index, runtime);
  refreshPdfListenView(runtime);
  refreshPdfAdvancedView(runtime);
  savePdfBookProgress({
    chunkIndex: index,
    chapterIndex: runtime.queue[index]?.chapterIndex ?? 0,
    pageIndex: runtime.queue[index]?.pageIndex ?? 0,
    pdfReaderMode: getPdfReaderMode(),
  });
  ui.updateListenContents();
  // NOTE: Do NOT call state.onChunkChange here — it calls goToChunk, causing infinite recursion.
  // Callers that need side-effects (stop/restart playback) must handle them directly.
}

function buildPdfPlaybackQueue(pdfChunks, meta) {
  if (!Array.isArray(pdfChunks) || !pdfChunks.length) return [];

  const pageMapped = pdfChunks.every(
    (chunk) => typeof chunk.text === "string" && typeof chunk.pageIndex === "number"
  );

  // PDF extraction already produced page-scoped sections — never re-chunk the whole book.
  if (pageMapped || meta?.fromPdfExtraction) {
    return pdfChunks.map((chunk, index) => ({
      id: index,
      chunkIndex: index,
      text: chunk.text,
      pageIndex: chunk.pageIndex ?? 0,
      chapterIndex: chunk.pageIndex ?? 0,
      chapterTitle: chunk.chapterTitle || `Page ${(chunk.pageIndex ?? 0) + 1}`,
      source: "pdf",
    }));
  }

  const fullText =
    meta?.fullText?.trim() ||
    pdfChunks.map((c) => c.text).join("\n\n").trim();
  if (!fullText) {
    return pdfChunks.map((chunk, index) => ({
      id: index,
      chunkIndex: index,
      text: chunk.text,
      pageIndex: chunk.pageIndex ?? 0,
      chapterIndex: chunk.pageIndex ?? 0,
      chapterTitle: `Page ${(chunk.pageIndex ?? 0) + 1}`,
      source: "pdf",
    }));
  }

  const pageTexts = meta?.pageTexts || [];
  const built = buildChunks(fullText, "novel", { useChapters: true });

  return built.map((chunk, index) => ({
    ...chunk,
    id: index,
    chunkIndex: index,
    pageIndex: findPageIndexForChunk(chunk.text, pageTexts),
    source: "pdf",
  }));
}

function findPageIndexForChunk(text, pageTexts) {
  if (!pageTexts.length || !text) return 0;
  const needle = text.slice(0, 64).trim();
  if (!needle) return 0;
  for (let p = 0; p < pageTexts.length; p += 1) {
    if (pageTexts[p]?.includes(needle)) return p;
  }
  return 0;
}

async function handleProviderSelect(providerId) {
  state.provider = providerId;
  state.voiceId = "";
  persistState(state, true);
  ui.renderProviderPicker(handleProviderSelect);
  await refreshVoices();
}

function saveCredentialInputs() {
  document.querySelectorAll("[data-provider][data-key]").forEach((input) => {
    const providerId = input.dataset.provider;
    const key = input.dataset.key;
    state.credentials[providerId] = state.credentials[providerId] || {};
    state.credentials[providerId][key] = input.value.trim();
  });
  persistState(state, true);
  ui.setStatus("Saved", "Credentials saved in this browser only.");
}

async function refreshVoices(forceRefresh) {
  const provider = providers[state.provider];
  try {
    ui.setStatus("Loading", `Loading ${provider.label} voices…`);
    const voices = await provider.listVoices(forceRefresh);
    if (["native", "openai", "googleTranslate"].includes(state.provider)) {
      state.cachedVoices[state.provider] = {
        expire: Date.now() + 86400000,
        items: voices,
      };
    }
    ui.populateVoiceSelect(voices);
    persistState(state);
    ui.setStatus("Ready", `${voices.length} voices ready.`);
  } catch (error) {
    ui.populateVoiceSelect([]);
    ui.setStatus("Error", error.message, true);
  }
}

function loadSampleText() {
  state.title = "Sample novel excerpt";
  state.text =
    "अध्याय 1\n\nयह एक शांत सुबह थी। हवा में मीठी खुशबू थी।\n\nअध्याय 2\n\nदोपहर तक आसमान बादलों से भर गया।";
  elements.titleInput.value = state.title;
  elements.textInput.value = state.text;
  ui.updateStats();
  ui.rebuildQueue();
  persistState(state);
}

function clearDocument() {
  stopPlayback();
  state.text = "";
  state.title = "";
  elements.textInput.value = "";
  elements.titleInput.value = "";
  ui.updateStats();
  ui.rebuildQueue();
  persistState(state);
}

async function importTextFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const book = await importTxtFile(file);
  await refreshLibrary();
  await openBook(book);
  event.target.value = "";
}

function onRateChange() {
  state.rate = Number(elements.rateInput.value);
  elements.rateOutput.value = `${state.rate.toFixed(2)}×`;
  persistState(state);
  if (runtime.currentAudio) runtime.currentAudio.playbackRate = novel.effectiveRate();
}

function onPitchChange() {
  state.pitch = Number(elements.pitchInput.value);
  elements.pitchOutput.value = `${state.pitch.toFixed(2)}×`;
  persistState(state);
  if (runtime.currentUtterance) runtime.currentUtterance.pitch = state.pitch;
}

function onVolumeChange() {
  state.volume = Number(elements.volumeInput.value);
  elements.volumeOutput.value = `${Math.round(state.volume * 100)}%`;
  persistState(state);
  const rate = novel?.effectiveRate?.() ?? state.rate;
  if (runtime.currentAudio) {
    runtime.currentAudio.volume = effectivePlaybackVolume(
      state.volume,
      runtime.currentAudio.playbackRate || rate
    );
  }
  if (runtime.currentUtterance) {
    runtime.currentUtterance.volume = effectivePlaybackVolume(state.volume, rate);
  }
}

async function startPlayback() {
  if (!runtime.queue.length) {
    ui.setStatus("Error", "Open a book from Library first.", true);
    return;
  }
  state.listenLayoutActive = true;
  ui.updateListenContents();
  if (!state.voiceId) {
    ui.setStatus("Error", "Choose a voice in Voice tab.", true);
    return;
  }
  if (runtime.mode === "playing") return;

  runtime.stopRequested = false;
  runtime.paused = false;
  runtime.mode = "playing";
  if (runtime.currentIndex < 0) runtime.currentIndex = state.resumeChunkIndex || 0;

  document.getElementById("mini-player")?.classList.add("is-playing");

  ui.setTransportState();
  try {
    await playQueueFromCurrentIndex();
    if (!runtime.stopRequested) ui.setStatus("Finished", "End of book.");
  } catch (error) {
    ui.setStatus("Error", error.message, true);
  } finally {
    runtime.mode = "idle";
    runtime.paused = false;
    releaseAudioResources(runtime);
    ui.setTransportState();
    ui.renderQueue(false);
    flushPersist(state);
    document.getElementById("mini-player")?.classList.remove("is-playing");
  }
}

async function playQueueFromCurrentIndex() {
  while (runtime.currentIndex >= 0 && runtime.currentIndex < runtime.queue.length) {
    if (runtime.stopRequested) return;

    const prevChunk =
      runtime.currentIndex > 0 ? runtime.queue[runtime.currentIndex - 1] : null;
    const raw = runtime.queue[runtime.currentIndex];
    if (
      prevChunk &&
      (prevChunk.chapterIndex ?? 0) !== (raw.chapterIndex ?? 0)
    ) {
      await ui.playChapterTransition(raw, { completedPrevious: true });
    }
    if (
      state.sleepTimerMinutes === "chapter" &&
      runtime.currentIndex > (state.resumeChunkIndex || 0) &&
      raw.chapterIndex !== runtime.queue[runtime.currentIndex - 1]?.chapterIndex
    ) {
      stopPlayback();
      ui.setStatus("Stopped", "Sleep timer stopped at the next chapter.");
      return;
    }
    if (novel.shouldSkipChunk(raw)) {
      runtime.currentIndex += 1;
      continue;
    }

    const provider = providers[state.provider];
    const voice = pickVoice(raw);
    if (!voice) throw new Error("Voice not available. Refresh voices.");

    ui.renderQueue(false);
    ui.updateReaderProgress();

    const chunk = { ...raw, text: novel.prepareChunkText(raw) };
    const replay = state.replayOnce;
    state.replayOnce = false;
    
    syncFlipbookToChunk(runtime.currentIndex, runtime);

    do {
      await provider.speak(chunk, voice, {
        rate: novel.effectiveRate(),
        pitch: state.pitch,
        volume: state.volume,
        onStart: () => {
          runtime.mode = "playing";
          updateMediaSession(raw);
          ui.setTransportState();
        },
        onBoundary: (start, end) => {
          runtime.activeWordRange = { chunkIndex: runtime.currentIndex, start, end };
          ui.updateReaderPreview();
          refreshPdfListenView(runtime);
          refreshPdfAdvancedView(runtime);
        },
      });
      if (replay && !runtime.stopRequested) continue;
      break;
    } while (replay);

    runtime.activeWordRange = null;
    if (runtime.stopRequested) return;

    runtime.currentIndex += 1;
    if (raw.source === "pdf") {
      const nextPdfChunk = runtime.queue[runtime.currentIndex];
      const prevChapter = raw.chapterIndex ?? 0;
      const nextChapter = nextPdfChunk?.chapterIndex ?? prevChapter;
      if (nextPdfChunk && nextChapter !== prevChapter) {
        onChapterAudioDone(nextChapter, runtime);
      } else if (!nextPdfChunk) {
        onPageAudioDone((raw.pageIndex ?? 0) + 1);
      }
      savePdfBookProgress({
        chunkIndex: runtime.currentIndex,
        chapterIndex: prevChapter,
        pageIndex: raw.pageIndex ?? 0,
        pageCount: Math.max(activeBook?.progress?.pageCount || 0, (raw.pageIndex ?? 0) + 1),
        pdfReaderMode: getPdfReaderMode(),
      });
    }
    // NOTE: Do NOT call state.onChunkChange during playback — it triggers stopPlayback()+startPlayback()
    // and an expensive refreshLibrary() call on every single chunk.
    ui.renderQueue(false);
  }
}

function updateMediaSession(chunk) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: chunk?.chapterTitle || state.title || "Read Aloud",
    artist: state.title || "Novel Reader",
    album: "Read Aloud",
  });
  navigator.mediaSession.playbackState = runtime.mode === "playing" ? "playing" : "paused";
}

function pickVoice(chunk) {
  const voices = getActiveVoices();
  const dialogueId = state.dialogueVoiceId;
  if (chunk?.isDialogue && dialogueId) {
    return voices.find((v) => v.id === dialogueId) || voices.find((v) => v.id === state.voiceId);
  }
  return voices.find((v) => v.id === state.voiceId);
}

function pausePlayback() {
  if (runtime.mode !== "playing") return;
  runtime.paused = true;
  runtime.mode = "paused";
  runtime.currentAudio?.pause();
  speechSynthesis.pause();
  document.getElementById("mini-player")?.classList.remove("is-playing");
  ui.setStatus("Paused", "Space to resume.");
  ui.setTransportState();
}

function resumePlayback() {
  if (runtime.mode !== "paused") return;
  runtime.paused = false;
  runtime.mode = "playing";
  runtime.currentAudio?.play().catch(() => {});
  speechSynthesis.resume();
  document.getElementById("mini-player")?.classList.add("is-playing");
  ui.setStatus("Playing", "Resumed.");
  ui.setTransportState();
}

function stopPlayback(options = {}) {
  runtime.stopRequested = true;
  runtime.paused = false;
  runtime.mode = "idle";
  runtime.activeWordRange = null;
  runtime.currentAudio?.pause();
  speechSynthesis.cancel();
  releaseAudioResources(runtime);
  novel?.clearSleepTimer?.();
  document.getElementById("mini-player")?.classList.remove("is-playing");
  ui.setTransportState();
  ui.updateReaderPreview();
  refreshPdfListenView(runtime);
  refreshPdfAdvancedView(runtime);
  ui.renderQueue(false);
  if (!options.silent) ui.setStatus("Stopped", "Playback stopped.");
  saveActiveBookProgress();
}

function clearActiveBookSession({ persist = false } = {}) {
  setActiveBookType(null);
  activeBook = null;
  state.activeBookId = "";
  state.text = "";
  state.title = "";
  state.bookmarks = [];
  state.activeBookPronunciations = {};
  state.bookChapters = [];
  state.resumeChunkIndex = 0;
  state.listenLayoutActive = false;
  runtime.queue = [];
  runtime.chapters = [];
  runtime.currentIndex = -1;
  runtime.activeWordRange = null;
  if (elements.textInput) elements.textInput.value = "";
  if (elements.titleInput) elements.titleInput.value = "";
  if (elements.pronunciationInput) elements.pronunciationInput.value = "";
  ui.updateStats();
  ui.rebuildQueue();
  ui.renderBookmarks();
  ui.updateReaderTitle();
  ui.updateReaderProgress();
  ui.updateReaderPreview();
  ui.renderBookExperience(null);
  ui.updateListenContents();
  ui.setTransportState();
  persistState(state, persist);
}

function getActiveVoices() {
  const entry = state.cachedVoices[state.provider];
  return entry?.items ?? [];
}

async function downloadAudio() {
  if (!runtime.queue.length || !state.voiceId) {
    ui.setStatus("Error", "Need text and voice.", true);
    return;
  }
  if (state.provider !== "googleTranslate") {
    ui.setStatus("Error", "Full download works with Google Translate.", true);
    return;
  }
  await downloadChunks(runtime.queue, state.title || "novel");
}

async function downloadCurrentChapter() {
  const ch = runtime.chapters?.find(
    (c) => c.chapterIndex === (runtime.queue[runtime.currentIndex]?.chapterIndex ?? 0)
  );
  if (!ch) return downloadAudio();
  const slice = runtime.queue.slice(ch.startChunk, ch.endChunk + 1);
  await downloadChunks(slice, `${state.title || "novel"}-ch`);
}

async function downloadChunks(chunks, name) {
  const voice = getActiveVoices().find((v) => v.id === state.voiceId);
  ui.setStatus("Loading", "Generating audio…");
  const blobs = [];
  for (let j = 0; j < chunks.length; j++) {
    const text = novel.prepareChunkText(chunks[j]);
    const subs = splitForGt(text);
    for (const sub of subs) {
      const res = await fetch("/api/google-translate/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: sub, lang: voice.lang }),
      });
      if (res.ok) blobs.push(await res.blob());
    }
  }
  const url = URL.createObjectURL(new Blob(blobs, { type: "audio/mpeg" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]+/gi, "_")}.mp3`;
  a.click();
  URL.revokeObjectURL(url);
  ui.setStatus("Ready", "Download started.");
}

function splitForGt(text) {
  const words = text.split(/\s+/);
  const parts = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).length > 180) {
      if (cur) parts.push(cur.trim());
      cur = w;
    } else cur += (cur ? " " : "") + w;
  }
  if (cur) parts.push(cur.trim());
  return parts;
}

