/**
 * DearFlip PDF reader for the web app.
 * Modes:
 *  - read: immersive manual page flipping
 *  - listen: scrollable chapter text + TTS
 *  - advanced: cinematic novel reader (extracted PDF text)
 */

import {
  ensurePdfListenContainer,
  playPdfChapterTransition,
  resetPdfListenView,
  setPdfListenVisible,
  updatePdfListenReader,
} from "./pdf-listen-view.js";
import {
  ensurePdfAdvancedContainer,
  resetPdfAdvancedView,
  setPdfAdvancedVisible,
  updatePdfAdvancedReader,
} from "./pdf-advanced-view.js";
import { ensureLoadProgressCard, hideLoadProgress, updateLoadProgress } from "./book-load-progress.js";
import { resetExtractionEta } from "./extraction-eta.js";
import { setActiveBookType } from "./session-context.js";
import {
  hidePdfPreparingView,
  isPdfPreparingViewVisible,
  setDearFlipVisible,
  setPdfTextMode,
  showPdfPreparingView,
} from "./pdf-view-shell.js";

let extractProgress = { page: 0, totalPages: 0, chaptersReady: 0, sectionsReady: 0 };

let flipbookInstance = null;
let currentPdfUrl = "";
let currentPdfName = "";
let currentPage = 1;
let totalPages = 1;
let readerMode = "read";
let autoFlip = true;
let highlights = [];
let pdfChunks = [];
let displayQueue = [];
let pageTextLayers = [];
let ttsCallbacks = {};
let onListenLayoutChange = null;
let extracting = false;
let pdfExtractionActive = false;
let highlightHandlerAttached = false;
let lastLineTap = { at: 0, chunk: -1 };
let pendingRestoreMode = null;
let pendingRestoreChunk = 0;
/** Listen vs advanced overlay to update while user stays in Read during extraction */
let extractionDisplayMode = "listen";

const HIGHLIGHTS_KEY = "ra_pdf_highlights";
const HIGHLIGHT_COLORS = ["#facc15", "#34d399", "#60a5fa", "#f472b6", "#a78bfa"];

export function initFlipbook(callbacks) {
  ttsCallbacks = callbacks || {};
  onListenLayoutChange = callbacks.onListenLayoutChange || null;
  highlights = loadHighlights();
  renderHighlightsList();
  bindControls();
  resetPdfModeClasses();

  return {
    loadPdfBlob: async (blob, book, options = {}) => {
      const file = blob instanceof File
        ? blob
        : new File([blob], `${book?.title || "book"}.pdf`, { type: "application/pdf" });
      await openPdfFile(file, {
        restoreChunk: book?.progress?.chunkIndex ?? 0,
        restoreMode: book?.progress?.pdfReaderMode || "read",
        activateTab: options.activateTab !== false,
      });
    },
  };
}

export async function openPdfFile(file, options = {}) {
  if (options.activateTab !== false) activatePdfTab();
  clearCurrentBook();
  pendingRestoreMode = options.restoreMode || "read";
  pendingRestoreChunk = options.restoreChunk ?? 0;
  currentPdfName = file.name.replace(/\.pdf$/i, "") || "Untitled PDF";
  currentPage = 1;
  setStatus("Loading", `Preparing ${currentPdfName}...`);
  setLoadedUi(true);

  const title = document.getElementById("flipbook-title");
  if (title) title.textContent = currentPdfName;

  // Start text extraction immediately — reads File directly, no server needed.
  pdfExtractionActive = true;
  void extractPdfText(file, options.restoreChunk ?? 0);

  // Then set up DearFlip in parallel for Read mode.
  // If server/DearFlip fails, Listen+Advanced still work from the extraction above.
  try {
    currentPdfUrl = await uploadPdfForSameOriginUrl(file);
    await createFlipbook(currentPdfUrl);
    ttsCallbacks.onPdfLoaded?.(file, currentPdfUrl);
    setStatus("Ready", "Manual page flipping is ready.");
    // Only switch to read if extraction hasn't already finalized into listen/advanced
    if (pendingRestoreMode) applyMode(pendingRestoreMode);
  } catch (error) {
    console.warn("[pdf-flipbook] Flipbook (Read mode) unavailable:", error.message);
    // Extraction is already running; switch to listen so user sees the progress ring
    if (pendingRestoreMode !== "advanced") applyMode("listen");
    else applyMode("advanced");
    setStatus("Listen", "Read mode unavailable — Listen mode extracting text.");
  }
}

export function setPdfDisplayQueue(queue) {
  displayQueue = Array.isArray(queue) ? queue : [];
  renderPdfQueue();
}

export function refreshPdfListenView(runtime) {
  if (readerMode !== "listen") return;
  window.__pdfListenRuntime = runtime;
  const hasContent = hasListenablePdfText();
  const busy = isPdfExtractionBusy();
  if (hasContent && !busy) {
    hidePdfPreparingView();
    hideLoadProgress();
  } else if (busy) {
    showModePreparing("listen");
  } else if (!hasContent) {
    showModePreparing("listen", { empty: true });
  }
  const queueReady = !!(runtime?.queue?.length);
  setPdfListenVisible(true, { hasContent: hasContent && !busy && queueReady });
  if (!hasContent && busy) return;
  if (!hasContent || !queueReady) return;
  updatePdfListenReader(runtime, {
    onPlayFromChunk: (chunkIndex) => playFromChunk(chunkIndex),
    onChapterJump: (start) => ttsCallbacks.onChapterJump?.(start),
    isExtracting: extracting,
  });
}

export function refreshPdfAdvancedView(runtime) {
  if (readerMode !== "advanced") return;
  window.__pdfListenRuntime = runtime;
  const hasContent = hasListenablePdfText();
  const busy = isPdfExtractionBusy();
  if (hasContent && !busy) {
    hidePdfPreparingView();
    hideLoadProgress();
  } else if (busy) {
    showModePreparing("advanced");
  } else if (!hasContent) {
    showModePreparing("advanced", { empty: true });
  }
  const queueReady = !!(runtime?.queue?.length);
  setPdfAdvancedVisible(true, { hasContent: hasContent && !busy && queueReady });
  if (!hasContent && busy) return;
  if (!hasContent || !queueReady) return;
  updatePdfAdvancedReader(runtime, {
    getSavedHighlight: (chunkIndex) => getSavedHighlightForChunk(chunkIndex),
    onSaveHighlight: (chunkIndex, color) => saveHighlight("", color, false, chunkIndex),
    onRemoveHighlight: (chunkIndex) => removeHighlightForChunk(chunkIndex),
    isExtracting: extracting,
    onChapterJump: (start) => ttsCallbacks.onChapterJump?.(start),
    onAdjacentChapter: (delta) => ttsCallbacks.onAdjacentChapter?.(delta),
  });
}

export function showVerseHighlightPopup(text, chunkIndex, anchorEl) {
  const rect = anchorEl?.getBoundingClientRect?.();
  if (!rect) return;
  showHighlightPopup(text, rect, chunkIndex);
}

function getSavedHighlightForChunk(chunkIndex) {
  return highlights.find(
    (h) => h.book === currentPdfName && h.chunkIndex === chunkIndex
  );
}

export function getPdfReaderMode() {
  return readerMode;
}

export function getPdfCurrentPage() {
  return currentPage;
}

export function isPdfExtractionBusy() {
  return extracting || pdfExtractionActive;
}

function hasListenablePdfText() {
  return !!(
    window.__pdfListenRuntime?.queue?.length ||
    pdfChunks.length ||
    displayQueue.length
  );
}

function getPreparingMode() {
  if (readerMode === "advanced") return "advanced";
  if (readerMode === "listen") return "listen";
  if (pendingRestoreMode === "advanced") return "advanced";
  return extractionDisplayMode || "listen";
}

function updateExtractionPreparingUi() {
  if (
    readerMode !== "listen" &&
    readerMode !== "advanced" &&
    !isPdfPreparingViewVisible()
  ) {
    return;
  }
  showModePreparing(getPreparingMode());
}

function showModePreparing(mode, { empty = false } = {}) {
  const busy = isPdfExtractionBusy();
  const reallyEmpty = empty && !busy && !hasListenablePdfText();
  showPdfPreparingView({
    mode,
    page: extractProgress.page,
    totalPages: extractProgress.totalPages,
    chaptersReady: extractProgress.chaptersReady,
    sectionsReady: extractProgress.sectionsReady,
    extracting: busy || (!reallyEmpty && extracting),
    empty: reallyEmpty,
  });
}

function activatePdfTab() {
  if (typeof window.switchTab === "function") {
    window.switchTab("pdfreader");
    return;
  }
  document.querySelectorAll(".tab-pane").forEach((pane) => pane.classList.remove("is-active"));
  document.getElementById("tab-pdfreader")?.classList.add("is-active");
  document.querySelectorAll(".nav-btn").forEach((button) => {
    const active = button.dataset.tab === "pdfreader";
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.body.classList.add("is-pdf-tab");
  setActiveBookType("pdf");
}

function bindControls() {
  document.getElementById("pdf-reader-input")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    window.switchTab?.("pdfreader");
    await openPdfFile(file);
  });

  document.getElementById("pdf-back-to-library")?.addEventListener("click", () => {
    resetPdfModeClasses();
    window.switchTab?.("library");
  });

  document.getElementById("flipbook-mode-read")?.addEventListener("click", () => applyMode("read"));
  document.getElementById("flipbook-mode-listen")?.addEventListener("click", () => applyMode("listen"));
  document.getElementById("flipbook-mode-advanced")?.addEventListener("click", () => applyMode("advanced"));

  document.getElementById("flipbook-auto-flip")?.addEventListener("change", (event) => {
    autoFlip = event.target.checked;
  });

  document.getElementById("flipbook-export-highlights")?.addEventListener("click", exportHighlights);

  document.getElementById("pdf-read-aloud-btn")?.addEventListener("click", () => {
    const wasRead = readerMode === "read";
    if (wasRead) applyMode("listen");
    if (!hasListenablePdfText()) {
      setStatus(extracting ? "Extracting" : "Not ready", extracting ? "Text extraction is still running." : "No readable text was found.");
      return;
    }
    const chunkIndex = findChunkForCurrentPage();
    ttsCallbacks.onPlayRequested?.(chunkIndex);
    document.getElementById("pdf-read-aloud-btn")?.classList.add("is-playing");
    setStatus("Playing", `Reading page ${currentPage}.`);
  });

  document.getElementById("pdf-stop-btn")?.addEventListener("click", () => {
    ttsCallbacks.onStopRequested?.();
    document.getElementById("pdf-read-aloud-btn")?.classList.remove("is-playing");
    setStatus("Stopped", "Playback stopped.");
  });

  document.getElementById("pdf-prev-chunk")?.addEventListener("click", () => ttsCallbacks.onPrevRequested?.());
  document.getElementById("pdf-next-chunk")?.addEventListener("click", () => ttsCallbacks.onNextRequested?.());

  const rateInput = document.getElementById("pdf-rate-input");
  const rateOutput = document.getElementById("pdf-rate-output");
  rateInput?.addEventListener("input", () => {
    if (rateOutput) rateOutput.value = `${Number(rateInput.value).toFixed(2)}x`;
    const mainRate = document.getElementById("rate-input");
    if (mainRate) {
      mainRate.value = rateInput.value;
      mainRate.dispatchEvent(new Event("input", { bubbles: true }));
    }
  });
}

function clearCurrentBook() {
  document.getElementById("highlight-popup")?.remove();
  document.getElementById("pdf-read-aloud-btn")?.classList.remove("is-playing");
  pdfChunks = [];
  displayQueue = [];
  extractionDisplayMode = "listen";
  extracting = false;
  pdfExtractionActive = false;
  renderPdfQueue();
  pageTextLayers = [];
  resetPdfListenView();
  resetPdfAdvancedView();
  renderInteractionLayer();

  if (flipbookInstance) {
    try { flipbookInstance.destroy?.(); } catch (error) { console.warn(error); }
    flipbookInstance = null;
  }

  const container = document.getElementById("flipbook-container");
  if (container) {
    container.querySelector("#df-book")?.remove();
    const interactionLayer = document.getElementById("pdf-interaction-layer");
    if (interactionLayer) {
      interactionLayer.innerHTML = "";
      interactionLayer.hidden = true;
    }
  }
}

async function uploadPdfForSameOriginUrl(file) {
  const response = await fetch("/api/pdf-upload", {
    method: "POST",
    headers: { "Content-Type": "application/pdf" },
    body: file,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || "Local PDF upload failed.");
  }
  const payload = await response.json();
  return payload.url;
}

async function createFlipbook(sourceUrl) {
  const container = document.getElementById("flipbook-container");
  if (!container) throw new Error("Flipbook container is missing.");
  if (typeof window.DFLIP === "undefined" || typeof window.$ === "undefined") {
    throw new Error("DearFlip did not load.");
  }

  const bookDiv = document.createElement("div");
  bookDiv.id = "df-book";
  bookDiv.className = "_df_book";
  container.appendChild(bookDiv);

  flipbookInstance = window.$(bookDiv).flipBook(sourceUrl, {
    source: sourceUrl,
    height: getFlipbookHeight(),
    duration: 700,
    webgl: true,
    sound: false,
    pageMode: 2,
    singlePageMode: 0,
    backgroundColor: "transparent",
    controlsPosition: "bottom",
    onReady: (instance) => {
      flipbookInstance = instance || flipbookInstance;
      totalPages = instance?.data?.pageCount || totalPages || 1;
      setStatus("Ready", `${totalPages} pages loaded.`);
    },
    onFlip: (pageNumber) => {
      currentPage = Number(pageNumber) || currentPage;
      updateChunkIndicator();
      renderInteractionLayer();
      ttsCallbacks.onPageFlip?.(currentPage);
    },
  });

  window.addEventListener("resize", resizeFlipbook, { passive: true });
  attachHighlightHandler();
}

function resizeFlipbook() {
  if (!flipbookInstance) return;
  const height = getFlipbookHeight();
  try {
    flipbookInstance.options.height = height;
    flipbookInstance.resize?.();
  } catch (error) {
    console.warn("Flipbook resize failed", error);
  }
}

function yieldToBrowser() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function getPageTextContent(page, pageNumber) {
  const timeoutMs = 60000;
  return Promise.race([
    page.getTextContent({ disableCombineTextItems: false }),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Page ${pageNumber} text timed out`)), timeoutMs);
    }),
  ]);
}

async function extractPdfText(file, restoreChunk = 0) {
  extracting = true;
  pdfExtractionActive = true;
  resetExtractionEta();
  pendingRestoreChunk = restoreChunk;
  extractionDisplayMode =
    pendingRestoreMode === "advanced" ? "advanced" : "listen";
  pdfChunks = [];
  pageTextLayers = [];
  renderPdfQueue();
  setStatus("Extracting", "Reading text for listening mode...");
  ensureLoadProgressCard();
  extractProgress = { page: 0, totalPages: 0, chaptersReady: 0, sectionsReady: 0 };
  updateLoadProgress({ page: 0, totalPages: 0, chaptersReady: 0, sectionsReady: 0 });
  updateExtractionPreparingUi();

  try {
    setStatus("Extracting", "Loading PDF engine…");
    const pdfjsLib = await getPdfJs();
    setStatus("Extracting", "Opening document…");
    const buffer = await file.arrayBuffer();
    const pdfDoc = await pdfjsLib.getDocument({ data: buffer, useSystemFonts: true }).promise;
    totalPages = pdfDoc.numPages || totalPages;
    extractProgress.totalPages = pdfDoc.numPages;
    updateLoadProgress({
      page: 0,
      totalPages: pdfDoc.numPages,
      chaptersReady: 0,
      sectionsReady: 0,
    });
    updateExtractionPreparingUi();
    let chunkId = 0;
    const pageTexts = [];
    const needReadLayers =
      readerMode === "read" ||
      pendingRestoreMode === "read";

    for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
      const page = await pdfDoc.getPage(pageNumber);
      let pageText = "";
      try {
        const textContent = await getPageTextContent(page, pageNumber);
        pageText = textContent.items
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
        if (needReadLayers) {
          const viewport = page.getViewport({ scale: 1 });
          pageTextLayers[pageNumber - 1] = buildPageTextLayer(textContent.items, viewport);
        }
      } catch (error) {
        console.warn("[pdf-flipbook] Page text skipped:", pageNumber, error.message);
        pageTextLayers[pageNumber - 1] = pageTextLayers[pageNumber - 1] || null;
      }

      pageTexts[pageNumber - 1] = pageText;

      splitPageText(pageText).forEach((text) => {
        pdfChunks.push({ id: chunkId, chunkIndex: chunkId, pageIndex: pageNumber - 1, text });
        chunkId += 1;
      });

      extractProgress = {
        page: pageNumber,
        totalPages: pdfDoc.numPages,
        chaptersReady: window.__pdfListenRuntime?.chapters?.length || 0,
        sectionsReady: pdfChunks.length,
      };
      updateLoadProgress({
        page: pageNumber,
        totalPages: pdfDoc.numPages,
        chaptersReady: extractProgress.chaptersReady,
        sectionsReady: extractProgress.sectionsReady,
        done: false,
      });
      updateExtractionPreparingUi();
      if (readerMode === "listen" && pageNumber % 16 === 0) {
        renderPdfQueue();
      }

      if (pageNumber % 8 === 0) {
        setStatus("Extracting", `Prepared page ${pageNumber} of ${pdfDoc.numPages}.`);
      }

      await yieldToBrowser();
    }

    finalizePdfExtraction({
      pageTexts,
      restoreChunk,
      error: null,
    });
  } catch (error) {
    console.error("[pdf-flipbook] extraction error:", error);
    finalizePdfExtraction({
      pageTexts: [],
      restoreChunk: pendingRestoreChunk,
      error,
    });
  }
}

function finalizePdfExtraction({ pageTexts = [], restoreChunk = 0, error = null }) {
  const savedRestoreChunk = restoreChunk ?? pendingRestoreChunk ?? 0;
  // Use the mode the user is currently in, falling back to the requested restore mode.
  // Do NOT blindly use pendingRestoreMode — the user may have switched to listen/advanced
  // manually while extraction was running, and that choice must be respected.
  const currentUserMode = readerMode;
  const fallbackMode = pendingRestoreMode || "read";

  extracting = false;
  pdfExtractionActive = false;
  hideLoadProgress();
  hidePdfPreparingView();

  const hasText = pdfChunks.length > 0;
  if (hasText) {
    try {
      ttsCallbacks.onTextExtracted?.(pdfChunks, {
        restoreChunk: savedRestoreChunk,
        pageTexts,
        fromPdfExtraction: true,
      });
    } catch (callbackError) {
      console.error("[pdf-flipbook] queue build failed:", callbackError);
    }
  }

  // Decide final mode:
  // 1. If user manually switched to listen/advanced while extracting → stay there
  // 2. Otherwise use the restore mode (what the book was saved with)
  // 3. If no text found and mode needs text → fall back to read
  let restoreMode;
  if (currentUserMode === "listen" || currentUserMode === "advanced") {
    restoreMode = currentUserMode; // respect user's manual switch
  } else {
    restoreMode = fallbackMode;
  }
  if ((restoreMode === "listen" || restoreMode === "advanced") && !hasText) {
    restoreMode = "read";
  }

  pendingRestoreMode = null;
  pendingRestoreChunk = 0;

  renderPdfQueue();
  renderInteractionLayer();
  updateChunkIndicator();

  applyMode(restoreMode, { skipPersist: true });
  if (hasText) {
    navigateToResumeChunk(savedRestoreChunk);
    const sectionCount =
      window.__pdfListenRuntime?.queue?.length || pdfChunks.length;
    setStatus(
      "Ready",
      error
        ? `${sectionCount} sections ready (some pages may have been skipped).`
        : `${sectionCount} listening sections ready.`
    );
  } else {
    setStatus(
      "Ready",
      error
        ? "Book view is ready, but text extraction failed."
        : "No selectable text was found in this PDF."
    );
  }

  ttsCallbacks.onReaderModeChange?.(restoreMode, {
    chunkIndex: savedRestoreChunk,
    pageIndex: currentPage - 1,
  });
}

function buildPageTextLayer(items, viewport) {
  return {
    width: viewport.width,
    height: viewport.height,
    items: items
      .map((item, index) => {
        const text = item.str?.trim();
        if (!text) return null;
        const transform = item.transform || [1, 0, 0, 1, 0, 0];
        const [x, y] = viewport.convertToViewportPoint(transform[4], transform[5]);
        const fontHeight = Math.max(8, Math.abs(transform[3] || item.height || 10));
        return {
          index,
          text,
          left: x,
          top: Math.max(0, y - fontHeight),
          width: Math.max(item.width || text.length * fontHeight * 0.45, fontHeight),
          height: fontHeight * 1.25,
        };
      })
      .filter(Boolean),
  };
}

function splitPageText(pageText) {
  if (!pageText) return [];
  const sentences = pageText.match(/[^.!?।]+[.!?।]+|\s*[^.!?।]+$/g) || [pageText];
  const chunks = [];
  let current = "";

  sentences.forEach((sentence) => {
    const clean = sentence.trim();
    if (!clean) return;
    if ((current + " " + clean).trim().length > 420) {
      if (current) chunks.push(current.trim());
      current = clean;
    } else {
      current = `${current} ${clean}`.trim();
    }
  });

  if (current) chunks.push(current.trim());
  return chunks;
}

async function getPdfJs() {
  if (window.pdfjsLib) {
    configurePdfWorker(window.pdfjsLib);
    return window.pdfjsLib;
  }

  await loadScript("/webapp/dflip/js/libs/pdf.min.js");
  if (!window.pdfjsLib) throw new Error("Local PDF parser did not load.");
  configurePdfWorker(window.pdfjsLib);
  return window.pdfjsLib;
}

function configurePdfWorker(pdfjsLib) {
  if (pdfjsLib?.GlobalWorkerOptions) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/webapp/dflip/js/libs/pdf.worker.min.js";
  }
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${src}"]`);
    if (existing) {
      existing.addEventListener("load", resolve, { once: true });
      if (window.pdfjsLib) resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

function applyMode(mode, options = {}) {
  if (!document.body.classList.contains("is-pdf-tab")) return;
  const valid = mode === "listen" || mode === "advanced" || mode === "read";
  if (!valid) mode = "read";

  readerMode = mode;
  const isListen = mode === "listen";
  const isAdvanced = mode === "advanced";
  if (isListen) extractionDisplayMode = "listen";
  if (isAdvanced) extractionDisplayMode = "advanced";

  document.body.classList.toggle("pdf-mode-read", mode === "read");
  document.body.classList.toggle("pdf-mode-listen", isListen);
  document.body.classList.toggle("pdf-mode-advanced", isAdvanced);

  document.getElementById("flipbook-mode-read")?.classList.toggle("is-active", mode === "read");
  document.getElementById("flipbook-mode-listen")?.classList.toggle("is-active", isListen);
  document.getElementById("flipbook-mode-advanced")?.classList.toggle("is-active", isAdvanced);

  const listenControls = document.getElementById("flipbook-listen-controls");
  if (listenControls) listenControls.style.display = "flex";

  const queueBlock = document.getElementById("flipbook-queue-block");
  if (queueBlock) queueBlock.style.display = isListen ? "block" : "none";

  const tocBlock = document.getElementById("flipbook-toc-block");
  if (tocBlock) tocBlock.style.display = isListen ? "block" : "none";

  const highlightsPanel = document.getElementById("flipbook-highlights-panel");
  if (highlightsPanel) highlightsPanel.style.display = isAdvanced ? "block" : "none";

  document.querySelectorAll(".flipbook-panel-col .flipbook-panel-block").forEach((block) => {
    if (
      block.id === "flipbook-toc-block" ||
      block.id === "flipbook-status-block" ||
      block.id === "flipbook-queue-block" ||
      block.id === "flipbook-highlights-panel"
    ) {
      return;
    }
    block.style.display = isListen || isAdvanced ? "none" : "";
  });

  const panel = document.querySelector(".flipbook-panel-col");
  if (panel) panel.hidden = mode === "read";

    const hasText = hasListenablePdfText();
    const busy = isPdfExtractionBusy();

  ensurePdfListenContainer();
  ensurePdfAdvancedContainer();

  const autoFlipLabel = document.querySelector(".flipbook-auto-flip-label");
  if (autoFlipLabel) autoFlipLabel.style.display = mode === "read" ? "" : "none";

  if (mode === "read") {
    setPdfTextMode(false);
    setDearFlipVisible(true);
    hidePdfPreparingView();
    hideLoadProgress();
    setPdfListenVisible(false);
    setPdfAdvancedVisible(false);
    const advancedEl = document.getElementById("pdf-advanced-reader");
    if (advancedEl) advancedEl.hidden = true;
    ttsCallbacks.onStopTts?.();
    document.getElementById("pdf-read-aloud-btn")?.classList.remove("is-playing");
    navigateToResumeChunk(getResumeChunkIndex());
    setStatus("Reading", "Flip pages manually. Auto-flip follows playback when enabled.");
  } else if (isListen) {
    window.__pdfReaderMode = "listen";
    setPdfAdvancedVisible(false);
    if (hasText && !busy && window.__pdfListenRuntime?.queue?.length) {
      hidePdfPreparingView();
      hideLoadProgress();
      setPdfListenVisible(true, { hasContent: true });
      refreshPdfListenView(window.__pdfListenRuntime);
      setStatus("Listen", "Double-tap any paragraph to start listening from there.");
    } else if (hasText && !busy) {
      setPdfListenVisible(true, { hasContent: false });
      showModePreparing("listen");
      setStatus("Listen", "Finishing audiobook layout…");
    } else if (busy || extracting) {
      setPdfListenVisible(true, { hasContent: false });
      updateExtractionPreparingUi();
      setStatus("Listen", "Preparing your audiobook view…");
    } else {
      setPdfListenVisible(true, { hasContent: false });
      showModePreparing("listen", { empty: true });
      setStatus("Listen", "No readable text — switch to Read for page view.");
    }
    onListenLayoutChange?.();
  } else if (isAdvanced) {
    window.__pdfReaderMode = "advanced";
    setPdfListenVisible(false);
    if (hasText && !busy && window.__pdfListenRuntime?.queue?.length) {
      hidePdfPreparingView();
      hideLoadProgress();
      setPdfAdvancedVisible(true, { hasContent: true });
      refreshPdfAdvancedView(window.__pdfListenRuntime);
      setStatus("Advanced", "Double-tap a passage to highlight · colours save privately.");
    } else if (hasText && !busy) {
      setPdfAdvancedVisible(true, { hasContent: false });
      showModePreparing("advanced");
      setStatus("Advanced", "Finishing novel layout…");
    } else if (busy || extracting) {
      setPdfAdvancedVisible(true, { hasContent: false });
      updateExtractionPreparingUi();
      setStatus("Advanced", "Crafting novel view from PDF…");
    } else {
      setPdfAdvancedVisible(true, { hasContent: false });
      showModePreparing("advanced", { empty: true });
      setStatus("Advanced", "No readable text — use Read mode for pages.");
    }
    onListenLayoutChange?.();
  }

  if (!options.skipPersist) {
    ttsCallbacks.onReaderModeChange?.(mode, {
      chunkIndex: getResumeChunkIndex(),
      pageIndex: currentPage - 1,
    });
  }

  setTimeout(() => {
    resizeFlipbook();
    if (mode === "read") renderInteractionLayer();
  }, 80);
}

function getResumeChunkIndex() {
  const runtime = window.__pdfListenRuntime;
  if (runtime?.currentIndex >= 0 && runtime.currentIndex < (runtime.queue?.length || 0)) {
    return runtime.currentIndex;
  }
  const chunk = pdfChunks[pendingRestoreChunk];
  return chunk ? pendingRestoreChunk : 0;
}

function navigateToResumeChunk(chunkIndex) {
  const runtime = window.__pdfListenRuntime;
  const chunk =
    runtime?.queue?.[chunkIndex] ??
    pdfChunks[chunkIndex] ??
    pdfChunks.find((c) => c.id === chunkIndex);
  if (!chunk || !flipbookInstance) return;
  const targetPage = (chunk.pageIndex ?? 0) + 1;
  if (targetPage !== currentPage) {
    goToFlipbookPage(targetPage);
  }
}

function resetPdfModeClasses() {
  document.body.classList.remove("pdf-mode-read", "pdf-mode-listen", "pdf-mode-advanced");
}

function renderPdfQueue() {
  const list = document.getElementById("pdf-chunk-list");
  const runtimeQ = window.__pdfListenRuntime?.queue;
  const items = displayQueue.length
    ? displayQueue
    : runtimeQ?.length
      ? runtimeQ
      : pdfChunks;
  if (!list) return;
  if (!items.length) {
    list.innerHTML = `<div class="queue-empty">${extracting ? "Preparing listening sections..." : "No listening sections yet."}</div>`;
    return;
  }

  list.innerHTML = items.slice(0, 120).map((chunk) => `
    <button type="button" class="chunk-item pdf-queue-item" data-chunk="${chunk.id}">
      <span class="chunk-item-header">
        <span>${escapeHtml(chunk.chapterTitle || `Page ${(chunk.pageIndex ?? 0) + 1}`)}</span>
        <span>${chunk.text.length} chars</span>
      </span>
      <span>${escapeHtml(chunk.text.slice(0, 120))}${chunk.text.length > 120 ? "..." : ""}</span>
    </button>
  `).join("");

  list.querySelectorAll("[data-chunk]").forEach((item) => {
    item.addEventListener("click", () => {
      const index = Number(item.dataset.chunk);
      applyMode("listen");
      ttsCallbacks.onPlayRequested?.(index);
    });
    item.addEventListener("dblclick", () => {
      const index = Number(item.dataset.chunk);
      playFromChunk(index);
    });
  });
}

function findChunkForCurrentPage() {
  if (!pdfChunks.length) return 0;
  const index = pdfChunks.findIndex((chunk) => chunk.pageIndex >= currentPage - 1);
  return index === -1 ? 0 : index;
}

export function onPageAudioDone(pageNumber) {
  if (readerMode === "listen") return;
  if (!autoFlip || !flipbookInstance) return;
  const nextPage = pageNumber + 1;
  if (nextPage <= totalPages) {
    goToFlipbookPage(nextPage);
  } else {
    setStatus("Done", "You have finished the book.");
    document.getElementById("pdf-read-aloud-btn")?.classList.remove("is-playing");
  }
}

export function onChapterAudioDone(chapterIndex, runtime) {
  if (readerMode === "listen") {
    const nextChunk = runtime?.queue?.find((c) => (c.chapterIndex ?? 0) === chapterIndex);
    if (nextChunk) {
      playPdfChapterTransition(nextChunk, { completedPrevious: true }).then(() => {
        refreshPdfListenView(runtime);
      });
    } else {
      refreshPdfListenView(runtime);
    }
    return;
  }
  if (readerMode === "advanced") {
    refreshPdfAdvancedView(runtime);
    return;
  }
  if (!autoFlip || !flipbookInstance) return;
  const chunk = runtime?.queue?.find((c) => (c.chapterIndex ?? 0) === chapterIndex);
  if (chunk?.pageIndex != null) {
    goToFlipbookPage(chunk.pageIndex + 1);
  }
}

export function syncFlipbookToChunk(chunkIndex, runtime) {
  if (!hasListenablePdfText()) return;

  const chunk = runtime?.queue?.[chunkIndex] ?? pdfChunks[chunkIndex];
  if (!chunk) return;

  updateActiveQueueItem(chunkIndex);
  updateChunkIndicator(chunk, runtime, chunkIndex);

  if (readerMode === "listen") {
    if (runtime) {
      window.__pdfListenRuntime = runtime;
      refreshPdfListenView(runtime);
    }
    return;
  }

  if (readerMode === "advanced") {
    if (runtime) {
      window.__pdfListenRuntime = runtime;
      refreshPdfAdvancedView(runtime);
    }
    return;
  }

  if (!flipbookInstance) return;
  const targetPage = (chunk.pageIndex ?? 0) + 1;
  const needsPageFlip = targetPage !== currentPage;
  currentPage = targetPage;
  renderInteractionLayer();
  if (autoFlip && needsPageFlip) {
    goToFlipbookPage(targetPage);
  }
}

function goToFlipbookPage(pageNumber) {
  currentPage = pageNumber;
  try {
    flipbookInstance.gotoPage?.(pageNumber);
    flipbookInstance.turnToPage?.(pageNumber);
  } catch (error) {
    console.warn("Page flip failed", error);
  }
  updateChunkIndicator();
  renderInteractionLayer();
}

function renderInteractionLayer() {
  if (readerMode !== "read") {
    const layer = document.getElementById("pdf-interaction-layer");
    if (layer) layer.hidden = true;
    return;
  }
  const layer = document.getElementById("pdf-interaction-layer");
  const container = document.getElementById("flipbook-container");
  const page = pageTextLayers[currentPage - 1];
  if (!layer || !container || !page) {
    if (layer) layer.hidden = true;
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const reservedForControls = 78;
  const scale = Math.min(
    Math.max(0.2, (containerRect.width - 72) / page.width),
    Math.max(0.2, (containerRect.height - reservedForControls - 24) / page.height)
  );
  const pageWidth = page.width * scale;
  const pageHeight = page.height * scale;
  const pageLeft = Math.max(12, (containerRect.width - pageWidth) / 2);
  const pageTop = Math.max(12, (containerRect.height - reservedForControls - pageHeight) / 2);

  layer.hidden = false;
  layer.style.left = `${pageLeft}px`;
  layer.style.top = `${pageTop}px`;
  layer.style.width = `${pageWidth}px`;
  layer.style.height = `${pageHeight}px`;
  layer.innerHTML = page.items.map((item) => {
    const chunkIndex = findChunkForText(currentPage - 1, item.text);
    const highlighted = isTextHighlighted(currentPage, item.text);
    return `
      <span
        class="pdf-selectable-line${highlighted ? " is-highlighted" : ""}"
        data-text="${escapeHtml(item.text)}"
        data-chunk="${chunkIndex}"
        style="left:${item.left * scale}px;top:${item.top * scale}px;width:${Math.max(8, item.width * scale)}px;height:${Math.max(10, item.height * scale)}px;font-size:${Math.max(8, item.height * scale * 0.78)}px;"
      >${escapeHtml(item.text)}</span>
    `;
  }).join("");

  layer.querySelectorAll(".pdf-selectable-line").forEach((span) => {
    span.addEventListener("click", () => {
      const chunkIndex = Number(span.dataset.chunk);
      const now = Date.now();
      if (lastLineTap.chunk === chunkIndex && now - lastLineTap.at < 380) {
        playFromChunk(chunkIndex);
        lastLineTap = { at: 0, chunk: -1 };
        return;
      }
      lastLineTap = { at: now, chunk: chunkIndex };
    });
    span.addEventListener("dblclick", (event) => {
      event.preventDefault();
      const chunkIndex = Number(span.dataset.chunk);
      if (Number.isInteger(chunkIndex) && chunkIndex >= 0) playFromChunk(chunkIndex);
    });
  });
}

function findChunkForText(pageIndex, text) {
  const normalized = normalizeText(text);
  if (!normalized) return findChunkForPage(pageIndex);
  const match = pdfChunks.find((chunk) =>
    chunk.pageIndex === pageIndex && normalizeText(chunk.text).includes(normalized)
  );
  return match?.id ?? findChunkForPage(pageIndex);
}

function findChunkForPage(pageIndex) {
  return pdfChunks.find((chunk) => chunk.pageIndex === pageIndex)?.id ?? 0;
}

function playFromChunk(chunkIndex) {
  if (!hasListenablePdfText()) return;
  if (readerMode === "read") applyMode("listen");
  else if (readerMode === "advanced") applyMode("listen");
  ttsCallbacks.onPlayRequested?.(chunkIndex);
  document.getElementById("pdf-read-aloud-btn")?.classList.add("is-playing");
  setStatus("Playing", `Reading from page ${pdfChunks[chunkIndex]?.pageIndex + 1 || currentPage}.`);
}

function updateActiveQueueItem(chunkIndex) {
  document.querySelectorAll(".pdf-queue-item").forEach((item) => {
    const index = Number(item.dataset.chunk);
    item.classList.toggle("is-active", index === chunkIndex);
    item.classList.toggle("is-done", index < chunkIndex);
  });
}

function updateChunkIndicator(chunk, runtime, chunkIndex = -1) {
  const indicator = document.getElementById("pdf-chunk-indicator");
  if (!indicator) return;
  if (readerMode === "listen" && chunk) {
    const title = chunk.chapterTitle || `Chapter ${(chunk.chapterIndex ?? 0) + 1}`;
    const chapters = runtime?.chapters || [];
    const ch = chapters.find((c) => c.chapterIndex === (chunk.chapterIndex ?? 0));
    const within =
      ch && chunkIndex >= 0 ? chunkIndexWithinChapter(chunk, runtime, chunkIndex) : null;
    indicator.textContent =
      within != null && ch
        ? `${title} · part ${within} of ${ch.endChunk - ch.startChunk + 1}`
        : title;
    return;
  }
  const page = chunk ? (chunk.pageIndex ?? 0) + 1 : currentPage;
  indicator.textContent = totalPages > 1 ? `Page ${page} / ${totalPages}` : `Page ${page}`;
}

function chunkIndexWithinChapter(chunk, runtime, chunkIndex) {
  if (!runtime?.queue || chunkIndex < 0) return null;
  const chIdx = chunk.chapterIndex ?? 0;
  let n = 0;
  for (let i = 0; i <= chunkIndex; i += 1) {
    if ((runtime.queue[i].chapterIndex ?? 0) === chIdx) n += 1;
  }
  return n;
}

function attachHighlightHandler() {
  if (highlightHandlerAttached) return;
  highlightHandlerAttached = true;
  document.addEventListener("mouseup", onDocumentMouseUp);
  document.addEventListener("keyup", (event) => {
    if (event.key === "Escape") document.getElementById("highlight-popup")?.remove();
  });
}

function onDocumentMouseUp() {
  if (!document.body.classList.contains("is-pdf-tab")) return;
  if (readerMode !== "advanced") return;
  const advancedRoot = document.getElementById("pdf-advanced-reader");
  const selection = window.getSelection?.();
  if (advancedRoot && selection?.anchorNode && !advancedRoot.contains(selection.anchorNode)) {
    return;
  }
  if (!selection || selection.isCollapsed) return;
  const text = selection.toString().trim().replace(/\s+/g, " ");
  if (text.length < 4) return;

  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  const rect = range?.getBoundingClientRect();
  if (!rect) return;
  showHighlightPopup(text, rect);
}

function showHighlightPopup(text, rect, chunkIndex = -1) {
  document.getElementById("highlight-popup")?.remove();
  const popup = document.createElement("div");
  popup.id = "highlight-popup";
  popup.className = "highlight-popup";
  popup.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 260))}px`;
  popup.style.top = `${Math.max(72, rect.top - 54)}px`;
  popup.innerHTML = `
    <div class="highlight-popup-inner">
      ${HIGHLIGHT_COLORS.map((color) => `<button type="button" class="hl-swatch" data-color="${color}" style="background:${color}" title="Highlight"></button>`).join("")}
      <p class="highlight-popup-label">Choose highlight colour</p>
      <button type="button" class="hl-fav-btn">Save highlight</button>
      <button type="button" class="hl-close" title="Dismiss">×</button>
    </div>
  `;
  document.body.appendChild(popup);

  popup.querySelector(".hl-close")?.addEventListener("click", clearSelectionAndPopup);
  popup.querySelector(".hl-fav-btn")?.addEventListener("click", () => {
    saveHighlight(text, "#facc15", true, chunkIndex);
    clearSelectionAndPopup();
  });
  popup.querySelectorAll(".hl-swatch").forEach((swatch) => {
    swatch.addEventListener("click", () => {
      saveHighlight(text, swatch.dataset.color || "#facc15", false, chunkIndex);
      clearSelectionAndPopup();
    });
  });
}

function clearSelectionAndPopup() {
  document.getElementById("highlight-popup")?.remove();
  window.getSelection?.()?.removeAllRanges();
}

function saveHighlight(text, color, favourite, chunkIndex = -1) {
  const chunk =
    chunkIndex >= 0 ? window.__pdfListenRuntime?.queue?.[chunkIndex] : null;
  highlights = highlights.filter(
    (h) => !(h.book === currentPdfName && h.chunkIndex === chunkIndex && chunkIndex >= 0)
  );
  highlights.unshift({
    id: Date.now(),
    text: (text || chunk?.text || "").slice(0, 700),
    page: chunk ? (chunk.pageIndex ?? 0) + 1 : currentPage,
    chunkIndex: chunkIndex >= 0 ? chunkIndex : undefined,
    color,
    favourite,
    ts: new Date().toISOString(),
    book: currentPdfName || "Untitled PDF",
  });
  persistHighlights();
  renderHighlightsList();
  if (readerMode === "read") renderInteractionLayer();
  if (readerMode === "advanced" && window.__pdfListenRuntime) {
    refreshPdfAdvancedView(window.__pdfListenRuntime);
  }
}

function removeHighlightForChunk(chunkIndex) {
  highlights = highlights.filter(
    (h) => !(h.book === currentPdfName && h.chunkIndex === chunkIndex)
  );
  persistHighlights();
  renderHighlightsList();
  if (readerMode === "advanced" && window.__pdfListenRuntime) {
    refreshPdfAdvancedView(window.__pdfListenRuntime);
  }
}

function isTextHighlighted(page, text) {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return highlights.some((highlight) =>
    highlight.book === currentPdfName &&
    highlight.page === page &&
    normalizeText(highlight.text).includes(normalized)
  );
}

function renderHighlightsList() {
  const list = document.getElementById("flipbook-highlights-list");
  const exportBtn = document.getElementById("flipbook-export-highlights");
  if (!list) return;

  const bookHighlights = currentPdfName
    ? highlights.filter((highlight) => highlight.book === currentPdfName)
    : highlights;

  if (!bookHighlights.length) {
    list.innerHTML = `<p class="flipbook-no-highlights">No highlights yet.</p>`;
    if (exportBtn) exportBtn.style.display = "none";
    return;
  }

  if (exportBtn) exportBtn.style.display = "block";
  list.innerHTML = bookHighlights.map((highlight) => `
    <div class="flipbook-highlight-item" data-id="${highlight.id}">
      <div class="hl-color-bar" style="background:${highlight.color}"></div>
      <div class="hl-content">
        <p class="hl-text">${escapeHtml(highlight.text)}</p>
        <div class="hl-meta">
          <span>Page ${highlight.page}</span>
          <button class="hl-delete" data-id="${highlight.id}" type="button" title="Remove">x</button>
        </div>
      </div>
    </div>
  `).join("");

  list.querySelectorAll(".hl-delete").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const id = Number(button.dataset.id);
      highlights = highlights.filter((highlight) => highlight.id !== id);
      persistHighlights();
      renderHighlightsList();
      renderInteractionLayer();
    });
  });
}

function exportHighlights() {
  const bookHighlights = highlights.filter((highlight) => highlight.book === currentPdfName);
  if (!bookHighlights.length) return;
  const markdown = [
    `# Highlights - ${currentPdfName}`,
    `Exported: ${new Date().toLocaleString()}`,
    "",
    ...bookHighlights.map((highlight) => `> Page ${highlight.page}\n> ${highlight.text}\n`),
  ].join("\n");

  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${currentPdfName.replace(/[^a-z0-9]+/gi, "_")}-highlights.md`;
  link.click();
  URL.revokeObjectURL(url);
}

function setLoadedUi(isLoaded) {
  document.getElementById("flipbook-empty")?.remove();
  const controls = document.getElementById("flipbook-tts-controls");
  const status = document.getElementById("flipbook-status-block");
  if (controls) controls.style.display = isLoaded ? "flex" : "none";
  if (status) status.style.display = isLoaded ? "block" : "none";
}

function setStatus(label, message) {
  const labelEl = document.getElementById("pdf-status-label");
  const msgEl = document.getElementById("pdf-status-msg");
  const card = document.querySelector(".pdf-status-card");
  if (labelEl) labelEl.textContent = label;
  if (msgEl) msgEl.textContent = message;
  if (card) {
    card.dataset.state = label === "Error" ? "error" : label === "Playing" ? "playing" : label === "Loading" || label === "Extracting" ? "paused" : "";
  }
}

function getFlipbookHeight() {
  const container = document.getElementById("flipbook-container");
  const bounds = container?.getBoundingClientRect();
  return Math.max(520, Math.floor((bounds?.height || window.innerHeight - 92) - 8));
}

function loadHighlights() {
  try { return JSON.parse(localStorage.getItem(HIGHLIGHTS_KEY) || "[]"); }
  catch (error) { return []; }
}

function persistHighlights() {
  try { localStorage.setItem(HIGHLIGHTS_KEY, JSON.stringify(highlights.slice(0, 500))); }
  catch (error) { console.warn("Could not save highlights", error); }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}
