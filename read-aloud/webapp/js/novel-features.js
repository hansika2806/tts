import { applyPronunciations, dictToLines, parsePronunciationLines } from "./pronunciation.js";
import { chunkIndexForChapter } from "./chapters.js";
import { exportProgressBundle, importProgressBundle } from "./progress-sync.js";

/** Sleep timer, keyboard, focus mode, playback modes, bookmarks helpers. */

export function createNovelFeatures(ctx) {
  const {
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
  } = ctx;

  let sleepTimerId = null;
  let sleepEndsAt = 0;

  function effectiveRate() {
    const base = state.rate;
    if (state.playbackMode === "relaxed") return base * 0.85;
    if (state.playbackMode === "dense") return base * 0.92;
    return base;
  }

  function shouldSkipChunk(chunk) {
    if (state.playbackMode === "skip_footnotes" && chunk?.isFootnote) return true;
    return false;
  }

  function prepareChunkText(chunk) {
    const dict = { ...state.globalPronunciations, ...(state.activeBookPronunciations || {}) };
    return applyPronunciations(chunk.text, dict);
  }

  function setSleepTimer(minutes) {
    clearSleepTimer();
    if (!minutes || minutes === "chapter") {
      updateSleepLabel();
      return;
    }
    sleepEndsAt = Date.now() + minutes * 60 * 1000;
    sleepTimerId = setInterval(() => {
      if (Date.now() >= sleepEndsAt) {
        clearSleepTimer();
        stopPlayback();
        ui.setStatus("Stopped", "Sleep timer ended playback.");
      }
      updateSleepLabel();
    }, 1000);
    updateSleepLabel();
  }

  function clearSleepTimer() {
    if (sleepTimerId) clearInterval(sleepTimerId);
    sleepTimerId = null;
    sleepEndsAt = 0;
    updateSleepLabel();
  }

  function updateSleepLabel() {
    const el = elements.sleepTimerLabel;
    if (!el) return;
    if (!sleepEndsAt) {
      el.textContent = state.sleepTimerMinutes === "chapter" ? "After chapter" : "Off";
      return;
    }
    const left = Math.max(0, sleepEndsAt - Date.now());
    const min = Math.ceil(left / 60000);
    el.textContent = `${min}m left`;
  }

  function toggleFocusMode() {
    state.focusMode = !state.focusMode;
    document.body.classList.toggle("focus-mode", state.focusMode);
    persistState(state);
    if (elements.focusModeBtn) {
      elements.focusModeBtn.classList.toggle("is-active", state.focusMode);
    }
  }

  function addBookmark() {
    if (runtime.currentIndex < 0) return;
    const chunk = runtime.queue[runtime.currentIndex];
    const bm = {
      chunkIndex: runtime.currentIndex,
      chapterTitle: chunk?.chapterTitle || "",
      preview: chunk?.text?.slice(0, 80) || "",
      note: "",
      at: Date.now(),
    };
    state.bookmarks = state.bookmarks || [];
    if (!state.bookmarks.some((b) => b.chunkIndex === bm.chunkIndex)) {
      state.bookmarks.push(bm);
    }
    persistState(state);
    saveActiveBookProgress?.();
    ui.renderBookmarks?.();
  }

  function jumpToChapter(chapterIndex) {
    const idx = chunkIndexForChapter(chapterIndex, runtime.queue);
    goToChunk(idx);
  }

  function bindControls() {
    elements.sleepTimerSelect?.addEventListener("change", () => {
      const v = elements.sleepTimerSelect.value;
      state.sleepTimerMinutes = v === "chapter" ? "chapter" : v ? Number(v) : 0;
      persistState(state);
      setSleepTimer(state.sleepTimerMinutes);
    });

    elements.playbackModeSelect?.addEventListener("change", () => {
      state.playbackMode = elements.playbackModeSelect.value;
      persistState(state);
      ui.rebuildQueue?.();
    });

    elements.focusModeBtn?.addEventListener("click", toggleFocusMode);

    elements.bookmarkBtn?.addEventListener("click", addBookmark);

    elements.replayChunkBtn?.addEventListener("click", () => {
      const target = Math.max(0, runtime.currentIndex - 1);
      goToChunk(target);
      if (runtime.mode === "playing" || runtime.mode === "paused") {
        stopPlayback();
        setTimeout(() => startPlayback(), 0);
      } else {
        startPlayback();
      }
    });

    elements.pronunciationSave?.addEventListener("click", () => {
      state.activeBookPronunciations = parsePronunciationLines(
        elements.pronunciationInput?.value || ""
      );
      state.globalPronunciations = state.activeBookPronunciations;
      persistState(state);
      saveActiveBookProgress?.();
      ui.setStatus("Saved", "Pronunciation rules saved for this book.");
    });

    elements.exportProgressBtn?.addEventListener("click", () => exportProgressBundle(state));
    elements.importProgressInput?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importProgressBundle(file, state, ctx.reloadLibrary);
        ui.setStatus("Ready", "Progress imported.");
      } catch (err) {
        ui.setStatus("Error", err.message, true);
      }
      e.target.value = "";
    });

    elements.chapterJump?.addEventListener("change", () => {
      const ci = Number(elements.chapterJump.value);
      if (!Number.isNaN(ci)) jumpToChapter(ci);
    });

    elements.dialogueVoiceSelect?.addEventListener("change", () => {
      state.dialogueVoiceId = elements.dialogueVoiceSelect.value;
      persistState(state);
    });

    document.addEventListener("keydown", (e) => {
      if (e.target.matches("input, textarea, select")) return;
      if (e.code === "Space") {
        e.preventDefault();
        if (runtime.mode === "playing") pausePlayback();
        else if (runtime.mode === "paused") resumePlayback();
        else startPlayback();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        if (runtime.currentIndex > 0) goToChunk(runtime.currentIndex - 1);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        if (runtime.currentIndex < runtime.queue.length - 1) goToChunk(runtime.currentIndex + 1);
      } else if (e.key === "f" || e.key === "F") {
        toggleFocusMode();
      } else if (e.key === "b" || e.key === "B") {
        addBookmark();
      }
    });

    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("play", startPlayback);
      navigator.mediaSession.setActionHandler("pause", pausePlayback);
      navigator.mediaSession.setActionHandler("stop", stopPlayback);
      navigator.mediaSession.setActionHandler("previoustrack", () => {
        if (runtime.currentIndex > 0) goToChunk(runtime.currentIndex - 1);
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => {
        if (runtime.currentIndex < runtime.queue.length - 1) goToChunk(runtime.currentIndex + 1);
      });
    }

    if (state.focusMode) document.body.classList.add("focus-mode");
    if (elements.sleepTimerSelect && state.sleepTimerMinutes) {
      elements.sleepTimerSelect.value = String(state.sleepTimerMinutes);
      setSleepTimer(state.sleepTimerMinutes);
    }
    if (elements.playbackModeSelect) elements.playbackModeSelect.value = state.playbackMode || "normal";
    if (elements.pronunciationInput) {
      elements.pronunciationInput.value = dictToLines(state.activeBookPronunciations || {});
    }
  }

  return {
    bindControls,
    effectiveRate,
    shouldSkipChunk,
    prepareChunkText,
    setSleepTimer,
    clearSleepTimer,
    toggleFocusMode,
    addBookmark,
    jumpToChapter,
  };
}
