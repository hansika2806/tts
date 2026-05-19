/**
 * PDF Reader Controller
 * Handles: open PDF → render → play TTS per page/chunk → highlight on canvas
 */

import { openPdfBook, highlightChunk } from "./pdf-reader.js";

const $ = (id) => document.getElementById(id);

export function initPdfReader(state, runtime, providers, ui) {
  const canvasArea   = $("pdf-canvas-area");
  const emptyState   = $("pdf-empty-state");
  const fileInput    = $("pdf-reader-input");
  const docName      = $("pdf-reader-docname");
  const mediaControls= $("pdf-media-controls");
  const chunkList    = $("pdf-chunk-list");
  const chunkInd     = $("pdf-chunk-indicator");
  const readBtn      = $("pdf-read-aloud-btn");
  const stopBtn      = $("pdf-stop-btn");
  const dlBtn        = $("pdf-download-btn");
  const prevBtn      = $("pdf-prev-chunk");
  const nextBtn      = $("pdf-next-chunk");
  const statusLabel  = $("pdf-status-label");
  const statusMsg    = $("pdf-status-msg");
  const statusCard   = $("pdf-status-card");
  const statusDot    = $("pdf-status-dot");
  const rateInput    = $("pdf-rate-input");
  const rateOutput   = $("pdf-rate-output");
  const navBadge     = $("pdf-reader-badge");

  let pdfChunks     = [];   // [{text, pageIndex, pageWrapper, textLayerDiv}]
  let currentChunk  = 0;
  let isReading     = false;
  let stopRequested = false;
  let currentAudio  = null;
  let currentObjUrl = null;

  // ── Rate slider ────────────────────────────────────────────────
  rateInput.addEventListener("input", () => {
    rateOutput.value = `${Number(rateInput.value).toFixed(2)}×`;
    if (currentAudio) currentAudio.playbackRate = Number(rateInput.value);
  });

  // ── Open PDF ───────────────────────────────────────────────────
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Switch to the PDF reader tab automatically
    const pdfTabBtn = document.querySelector('[data-tab="pdfreader"]');
    if (pdfTabBtn) pdfTabBtn.click();

    e.target.value = "";
    await loadPdf(file);
  });

  let pageWrappers  = [];

  async function loadPdf(file) {
    setStatus("loading", "Loading…", "Starting PDF parser...");
    emptyState?.remove();
    pdfChunks = [];
    chunkList.innerHTML = "";
    currentChunk = 0;

    try {
      const result = await openPdfBook(
        file, 
        canvasArea, 
        (msg) => setStatus("loading", "Loading…", msg),
        (chunk) => {
          pdfChunks.push(chunk);
          appendChunkToSidebar(chunk);
          
          if (pdfChunks.length === 1) {
            // First chunk ready, enable the UI immediately!
            docName.textContent = result.title;
            mediaControls.style.display = "flex";
            chunkInd.style.display = "inline-block";
            readBtn.disabled = false;
            stopBtn.disabled = false;
            dlBtn.disabled = false;
            if (navBadge) navBadge.style.display = "inline-block";
            
            highlightChunk(pdfChunks[0], pageWrappers);
            updateNav();
            updateSidebarActive();
          }
          
          setStatus("loading", "Extracting…", `${pdfChunks.length} text sections extracted so far.`);
        },
        () => {
          setStatus("idle", "Ready", `${result.pageCount} pages loaded — ${pdfChunks.length} readable sections.`);
        }
      );

      pageWrappers = result.pageWrappers;

    } catch (err) {
      setStatus("error", "Error", err.message);
    }
  }

  function appendChunkToSidebar(chunk) {
    const idx = chunk.id;
    const item = document.createElement("div");
    item.className = "chunk-item" + (idx === currentChunk ? " is-active" : "");
    item.innerHTML = `
      <div class="chunk-item-header">
        <span>Page ${chunk.pageIndex + 1}</span>
        <span>${chunk.text.length} chars</span>
      </div>
      <p>${chunk.text.slice(0, 100)}${chunk.text.length > 100 ? "…" : ""}</p>
    `;
    item.addEventListener("click", () => {
      currentChunk = idx;
      updateSidebarActive();
      highlightChunk(pdfChunks[currentChunk], pageWrappers);
      updateNav();
    });
    chunkList.appendChild(item);
  }

  function updateSidebarActive() {
    chunkList.querySelectorAll(".chunk-item").forEach((el, i) => {
      el.classList.toggle("is-active", i === currentChunk);
      el.classList.toggle("is-done", i < currentChunk);
    });
    const active = chunkList.querySelector(".is-active");
    active?.scrollIntoView({ block: "nearest" });
  }

  function updateNav() {
    const c = pdfChunks[currentChunk];
    if (c) chunkInd.textContent = `Page ${c.pageIndex + 1}`;
  }

  prevBtn.addEventListener("click", () => {
    if (currentChunk > 0) {
      currentChunk--;
      updateSidebarActive();
      highlightChunk(pdfChunks[currentChunk], pageWrappers);
      updateNav();
    }
  });

  nextBtn.addEventListener("click", () => {
    if (currentChunk < pdfChunks.length - 1) {
      currentChunk++;
      updateSidebarActive();
      highlightChunk(pdfChunks[currentChunk], pageWrappers);
      updateNav();
    }
  });

  // Handle double-click on text layer to start reading instantly
  window.addEventListener("pdf-start-from", (e) => {
    const { pageIndex, itemIdx } = e.detail;
    const chunkIdx = pdfChunks.findIndex(c => c.pageIndex === pageIndex && c.itemIndices.includes(itemIdx));
    if (chunkIdx !== -1) {
      stopReading();
      currentChunk = chunkIdx;
      updateSidebarActive();
      highlightChunk(pdfChunks[currentChunk], pageWrappers);
      updateNav();
      startReading();
    }
  });

  // ── Play ───────────────────────────────────────────────────────
  readBtn.addEventListener("click", startReading);
  stopBtn.addEventListener("click",  stopReading);

  async function startReading() {
    if (isReading) return;
    if (!pdfChunks.length) return;

    const voice = getVoice();
    if (!voice) {
      setStatus("error", "No voice", "Go to Voice & Speed and select a voice first.");
      return;
    }

    stopRequested = false;
    isReading = true;
    readBtn.disabled = true;
    setStatus("playing", "Playing", "");

    for (let i = currentChunk; i < pdfChunks.length; i++) {
      if (stopRequested) break;
      currentChunk = i;

      highlightChunk(pdfChunks[i], pageWrappers);
      updateNav();
      updateSidebarActive();
      setStatus("playing", "Playing", `Reading page ${pdfChunks[i].pageIndex + 1} of ${pdfChunks.length}…`);

      await speakChunk(pdfChunks[i].text, voice);
    }

    isReading = false;
    readBtn.disabled = false;
    if (!stopRequested) {
      setStatus("idle", "Finished", "All pages have been read.");
      highlightChunk(null, pageWrappers);
    }
  }

  function stopReading() {
    stopRequested = true;
    isReading = false;
    readBtn.disabled = false;
    if (currentAudio) { currentAudio.pause(); currentAudio = null; }
    if (currentObjUrl) { URL.revokeObjectURL(currentObjUrl); currentObjUrl = null; }
    setStatus("idle", "Stopped", "Playback stopped.");
  }

  // ── Speak a single page chunk via Google Translate TTS ────────
  async function speakChunk(text, voice) {
    const rate = Number(rateInput.value);
    // Sub-chunk to 180 chars for Google Translate
    const words = text.split(/\s+/);
    const subChunks = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).length > 180) { if (cur) subChunks.push(cur.trim()); cur = w; }
      else { cur += (cur ? " " : "") + w; }
    }
    if (cur) subChunks.push(cur.trim());

    for (const sub of subChunks) {
      if (stopRequested) return;
      try {
        const res = await fetch("/api/google-translate/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: sub, lang: voice.lang }),
        });
        if (!res.ok) throw new Error("TTS request failed");
        const blob = await res.blob();
        await playBlob(blob, rate);
      } catch (err) {
        setStatus("error", "Error", err.message);
        stopRequested = true;
        return;
      }
    }
  }

  function playBlob(blob, rate) {
    return new Promise((resolve) => {
      if (currentObjUrl) URL.revokeObjectURL(currentObjUrl);
      currentObjUrl = URL.createObjectURL(blob);
      currentAudio = new Audio(currentObjUrl);
      if ("preservesPitch" in currentAudio) currentAudio.preservesPitch = true;
      currentAudio.playbackRate = rate;
      currentAudio.onended  = () => { currentAudio = null; resolve(); };
      currentAudio.onerror  = () => { currentAudio = null; resolve(); };
      currentAudio.play().catch(resolve);
    });
  }

  // ── Download entire PDF as MP3 ────────────────────────────────
  dlBtn.addEventListener("click", async () => {
    if (!pdfChunks.length) return;
    const voice = getVoice();
    if (!voice) { setStatus("error", "No voice", "Select a voice first."); return; }

    dlBtn.disabled = true;
    setStatus("loading", "Generating…", "Building MP3, please wait…");

    try {
      const blobs = [];
      for (let i = 0; i < pdfChunks.length; i++) {
        setStatus("loading", "Generating…", `Page ${i + 1} / ${pdfChunks.length}…`);
        const words = pdfChunks[i].text.split(/\s+/);
        const subs = [];
        let cur = "";
        for (const w of words) {
          if ((cur + " " + w).length > 180) { if (cur) subs.push(cur.trim()); cur = w; }
          else { cur += (cur ? " " : "") + w; }
        }
        if (cur) subs.push(cur.trim());

        for (const sub of subs) {
          const res = await fetch("/api/google-translate/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: sub, lang: voice.lang }),
          });
          if (res.ok) blobs.push(await res.blob());
        }
      }
      const final = new Blob(blobs, { type: "audio/mpeg" });
      const url = URL.createObjectURL(final);
      const a = document.createElement("a");
      a.href = url; a.download = (docName.textContent || "pdf_audio") + ".mp3"; a.click();
      URL.revokeObjectURL(url);
      setStatus("idle", "Done", "MP3 downloaded.");
    } catch (err) {
      setStatus("error", "Error", err.message);
    } finally {
      dlBtn.disabled = false;
    }
  });

  // ── Helpers ───────────────────────────────────────────────────
  function getVoice() {
    // Prefer Google Translate Hindi if available, else use whatever is selected
    const cachedGT = state.cachedVoices?.googleTranslate?.items ?? [];
    const gtHindi = cachedGT.find(v => v.lang === "hi");
    if (gtHindi && state.provider === "googleTranslate") return gtHindi;

    // Fallback: any cached voice
    for (const key of Object.keys(state.cachedVoices ?? {})) {
      const items = state.cachedVoices[key]?.items ?? [];
      const match = items.find(v => v.id === state.voiceId);
      if (match) return match;
    }
    return null;
  }

  function setStatus(type, label, msg) {
    statusLabel.textContent = label;
    statusMsg.textContent   = msg;
    statusCard.dataset.state = type === "error" ? "error"
      : type === "playing" ? "playing" : type === "loading" ? "paused" : "";
  }
}
