import { STORAGE_KEY } from "./config.js";

let saveTimer = null;

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
    const legacy = localStorage.getItem("read-aloud-webapp:v2");
    return legacy ? JSON.parse(legacy) : {};
  } catch (error) {
    console.error(error);
    return {};
  }
}

export function persistState(state, immediate = false) {
  const save = {
    provider: state.provider,
    voiceId: state.voiceId,
    dialogueVoiceId: state.dialogueVoiceId || "",
    text: state.text,
    title: state.title,
    chunkMode: state.chunkMode,
    rate: state.rate,
    pitch: state.pitch,
    volume: state.volume,
    credentials: state.credentials,
    cachedVoices: state.cachedVoices,
    activeBookId: state.activeBookId || "",
    playbackMode: state.playbackMode || "normal",
    sleepTimerMinutes: state.sleepTimerMinutes || 0,
    focusMode: !!state.focusMode,
    bookmarks: state.bookmarks || [],
    globalPronunciations: state.globalPronunciations || {},
    activeBookPronunciations: state.activeBookPronunciations || {},
    contentsPanelOpen: !!state.contentsPanelOpen,
  };

  const write = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(save));

  if (immediate) {
    if (saveTimer) clearTimeout(saveTimer);
    write();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(write, 400);
}

export function flushPersist(state) {
  persistState(state, true);
}
