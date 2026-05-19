/**
 * PDF Reader Controller
 * Handles: open PDF → render → play TTS per page/chunk → highlight on canvas
 */

import { openPdfBook, highlightChunk } from "./pdf-reader.js";

const $ = (id) => document.getElementById(id);

export function initPdfReader(state, runtime, providers, ui) {
  const canvasArea    = $("pdf-canvas-area");
  const emptyState    = $("pdf-empty-state");
  const fileInput     = $("pdf-reader-input");
  const docName       = $("pdf-reader-docname");
  const mediaControls = $("pdf-media-controls");
  const chunkList     = $("pdf-chunk-list");
  const chunkInd      = $("pdf-chunk-indicator");
  const readBtn       = $("pdf-read-aloud-btn");
  const stopBtn       = $("pdf-stop-btn");
  const dlBtn         = $("pdf-download-btn");
  const prevBtn       = $("pdf-prev-chunk");
  const nextBtn       = $("pdf-next-chunk");
  const statusLabel   = $("pdf-status-label");
  const statusMsg     = $("pdf-status-msg");
  const statusCard    = $("pdf-status-card");
  const rateInput     = $("pdf-rate-input");
  const rateOutput    = $("pdf-rate-output");
  const navBadge      = $("pdf-reader-badge");

  if (!canvasArea || !fileInput || !chunkList) {
    console.warn("PDF reader: required elements missing");
    return;
  }

  let pdfChunks      = [];
  let currentChunk   = 0;
  let isReading      = false;
  let stopRequested  = false;
  let currentAudio   = null;
  let currentObjUrl  = null;
  let pageWrappers   = [];
  let sidebarPending = [];
  let sidebarFlushId = null;
  let uiEnabled      = false;

  rateInput?.addEventListener("input", () => {
    if (rateOutput) rateOutput.value = `${Number(rateInput.value).toFixed(2)}×`;
    if (currentAudio) currentAudio.playbackRate = Number(rateInput.value);
  });

  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    document.querySelector('[data-tab="pdfreader"]')?.click();
    e.target.value = "";
    await loadPdf(file);
  });

  async function loadPdf(file) {
    stopReading();
    setStatus("loading", "Loading…", "Starting PDF parser…");
    emptyState?.remove();
    pdfChunks = [];
    chunkList.innerHTML = "";
    sidebarPending = [];
    if (sidebarFlushId) {
      cancelAnimationFrame(sidebarFlushId);
      sidebarFlushId = null;
    }
    currentChunk = 0;
    pageWrappers = [];
    uiEnabled = false;
    setTransportEnabled(false);

    try {
      const result = await openPdfBook(
        file,
        canvasArea,
        (msg) => setStatus("loading", "Loading…", msg),
        (chunk) => {
          pdfChunks.push(chunk);
          queueSidebarChunk(chunk);

          if (!uiEnabled && pdfChunks.length === 1) {
            uiEnabled = true;
            docName.textContent = result.title;
            if (mediaControls) mediaControls.style.display = "flex";
            if (chunkInd) chunkInd.style.display = "inline-block";
            setTransportEnabled(true);
            if (navBadge) navBadge.style.display = "inline-block";

            highlightChunk(pdfChunks[0], pageWrappers, { smooth: false });
            updateNav();
            updateSidebarActive(false);
          }

          setStatus("loading", "Extracting…", `${pdfChunks.length} sections extracted…`);
        },
        () => {
          flushSidebarChunks();
          setStatus("idle", "Ready", `${result.pageCount} pages — ${pdfChunks.length} sections.`);
        }
      );

      pageWrappers = result.pageWrappers;
    } catch (err) {
      setStatus("error", "Error", err.message);
    }
  }

  function setTransportEnabled(on) {
    if (readBtn) readBtn.disabled = !on;
    if (stopBtn) stopBtn.disabled = !on;
    if (dlBtn) dlBtn.disabled = !on;
    if (prevBtn) prevBtn.disabled = !on;
    if (nextBtn) nextBtn.disabled = !on;
  }

  function queueSidebarChunk(chunk) {
    sidebarPending.push(chunk);
    if (sidebarFlushId) return;
    sidebarFlushId = requestAnimationFrame(() => {
      sidebarFlushId = null;
      flushSidebarChunks();
    });
  }

  function flushSidebarChunks() {
    if (!sidebarPending.length) return;
    const batch = sidebarPending.splice(0, sidebarPending.length);
    const fragment = document.createDocumentFragment();
    for (const chunk of batch) {
      fragment.appendChild(buildSidebarItem(chunk));
    }
    chunkList.appendChild(fragment);
    if (uiEnabled) updateSidebarActive(false);
  }

  function buildSidebarItem(chunk) {
    const idx = chunk.id;
    const item = document.createElement("div");
    item.className = "chunk-item" + (idx === currentChunk ? " is-active" : "");
    item.innerHTML = `
      <div class="chunk-item-header">
        <span>Page ${chunk.pageIndex + 1}</span>
        <span>${chunk.text.length} chars</span>
      </div>
      <p>${escapeHtml(chunk.text.slice(0, 100))}${chunk.text.length > 100 ? "…" : ""}</p>
    `;
    item.addEventListener("click", () => goToChunk(idx, { interruptPlayback: true }));
    return item;
  }

  function escapeHtml(str) {
    return str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function goToChunk(idx, { interruptPlayback = false, smooth = false } = {}) {
    if (idx < 0 || idx >= pdfChunks.length) return;
    if (interruptPlayback && isReading) {
      interruptPlaybackLoop();
    }
    currentChunk = idx;
    highlightChunk(pdfChunks[currentChunk], pageWrappers, { smooth });
    updateNav();
    updateSidebarActive(!isReading);
  }

  function interruptPlaybackLoop() {
    stopRequested = true;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (currentObjUrl) {
      URL.revokeObjectURL(currentObjUrl);
      currentObjUrl = null;
    }
    isReading = false;
    setPlayButtonState(false);
  }

  function updateSidebarActive(scrollActive = true) {
    chunkList.querySelectorAll(".chunk-item").forEach((el, i) => {
      el.classList.toggle("is-active", i === currentChunk);
      el.classList.toggle("is-done", i < currentChunk);
    });
    if (scrollActive) {
      chunkList.querySelector(".is-active")?.scrollIntoView({ block: "nearest", behavior: "auto" });
    }
  }

  function updateNav() {
    const c = pdfChunks[currentChunk];
    if (c && chunkInd) chunkInd.textContent = `Page ${c.pageIndex + 1}`;
  }

  prevBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentChunk > 0) goToChunk(currentChunk - 1, { interruptPlayback: true, smooth: false });
  });

  nextBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (currentChunk < pdfChunks.length - 1) {
      goToChunk(currentChunk + 1, { interruptPlayback: true, smooth: false });
    }
  });

  window.addEventListener("pdf-start-from", (e) => {
    const { pageIndex, itemIdx } = e.detail;
    const chunkIdx = pdfChunks.findIndex(
      (c) => c.pageIndex === pageIndex && c.itemIndices.includes(itemIdx)
    );
    if (chunkIdx === -1) return;
    interruptPlaybackLoop();
    goToChunk(chunkIdx, { smooth: false });
    startReading();
  });

  readBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isReading) {
      interruptPlaybackLoop();
      setStatus("idle", "Paused", "Playback paused. Press Play to continue.");
    } else {
      startReading();
    }
  });

  stopBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    stopReading();
  });

  function setPlayButtonState(playing) {
    if (!readBtn) return;
    readBtn.textContent = playing ? "⏸" : "▶";
    readBtn.title = playing ? "Pause" : "Play";
    readBtn.classList.toggle("is-playing", playing);
    readBtn.disabled = !uiEnabled;
  }

  async function startReading() {
    if (isReading || !pdfChunks.length) return;

    const voice = getVoice();
    if (!voice) {
      setStatus("error", "No voice", "Go to Voice & Speed and select a voice first.");
      return;
    }

    stopRequested = false;
    isReading = true;
    setPlayButtonState(true);
    setStatus("playing", "Playing", "");

    while (!stopRequested && currentChunk < pdfChunks.length) {
      const idx = currentChunk;
      const chunk = pdfChunks[idx];
      if (!chunk) break;

      highlightChunk(chunk, pageWrappers, { smooth: false });
      updateNav();
      updateSidebarActive(false);
      setStatus("playing", "Playing", `Reading page ${chunk.pageIndex + 1}…`);

      await speakChunk(chunk.text, voice);

      if (stopRequested) break;
      if (currentChunk === idx && currentChunk < pdfChunks.length - 1) {
        currentChunk++;
      }
    }

    isReading = false;
    setPlayButtonState(false);
    if (!stopRequested) {
      setStatus("idle", "Finished", "All sections have been read.");
      highlightChunk(null, pageWrappers);
    }
  }

  function stopReading() {
    stopRequested = true;
    isReading = false;
    setPlayButtonState(false);
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    if (currentObjUrl) {
      URL.revokeObjectURL(currentObjUrl);
      currentObjUrl = null;
    }
    setStatus("idle", "Stopped", "Playback stopped.");
  }

  async function speakChunk(text, voice) {
    const rate = Number(rateInput?.value ?? 1);
    const words = text.split(/\s+/);
    const subChunks = [];
    let cur = "";
    for (const w of words) {
      if ((cur + " " + w).length > 180) {
        if (cur) subChunks.push(cur.trim());
        cur = w;
      } else {
        cur += (cur ? " " : "") + w;
      }
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
      currentAudio.onended = () => {
        currentAudio = null;
        resolve();
      };
      currentAudio.onerror = () => {
        currentAudio = null;
        resolve();
      };
      currentAudio.play().catch(resolve);
    });
  }

  dlBtn?.addEventListener("click", async (e) => {
    e.preventDefault();
    if (!pdfChunks.length) return;
    const voice = getVoice();
    if (!voice) {
      setStatus("error", "No voice", "Select a voice first.");
      return;
    }

    dlBtn.disabled = true;
    setStatus("loading", "Generating…", "Building MP3, please wait…");

    try {
      const blobs = [];
      for (let i = 0; i < pdfChunks.length; i++) {
        setStatus("loading", "Generating…", `Section ${i + 1} / ${pdfChunks.length}…`);
        const words = pdfChunks[i].text.split(/\s+/);
        const subs = [];
        let cur = "";
        for (const w of words) {
          if ((cur + " " + w).length > 180) {
            if (cur) subs.push(cur.trim());
            cur = w;
          } else {
            cur += (cur ? " " : "") + w;
          }
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
      a.href = url;
      a.download = (docName?.textContent || "pdf_audio") + ".mp3";
      a.click();
      URL.revokeObjectURL(url);
      setStatus("idle", "Done", "MP3 downloaded.");
    } catch (err) {
      setStatus("error", "Error", err.message);
    } finally {
      dlBtn.disabled = false;
    }
  });

  function getVoice() {
    const cachedGT = state.cachedVoices?.googleTranslate?.items ?? [];
    const gtHindi = cachedGT.find((v) => v.lang === "hi");
    if (gtHindi && state.provider === "googleTranslate") return gtHindi;

    for (const key of Object.keys(state.cachedVoices ?? {})) {
      const items = state.cachedVoices[key]?.items ?? [];
      const match = items.find((v) => v.id === state.voiceId);
      if (match) return match;
    }
    return gtHindi ?? cachedGT[0] ?? null;
  }

  function setStatus(type, label, msg) {
    if (statusLabel) statusLabel.textContent = label;
    if (statusMsg) statusMsg.textContent = msg;
    if (statusCard) {
      statusCard.dataset.state =
        type === "error" ? "error" : type === "playing" ? "playing" : type === "loading" ? "paused" : "";
    }
  }
}
