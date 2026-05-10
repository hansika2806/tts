import { STORAGE_KEY } from "./config.js";

export function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch (error) {
    console.error(error);
    return {};
  }
}

export function persistState(state) {
  const save = {
    provider: state.provider,
    voiceId: state.voiceId,
    text: state.text,
    title: state.title,
    chunkMode: state.chunkMode,
    rate: state.rate,
    pitch: state.pitch,
    volume: state.volume,
    credentials: state.credentials,
    cachedVoices: state.cachedVoices,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(save));
}
