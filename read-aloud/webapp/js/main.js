import { persistState, loadState } from "./storage.js";
import { createProviders } from "./providers.js";
import { createUi } from "./ui.js";
import { extractTextFromPdf } from "./pdf-import.js";
import { releaseAudioResources } from "./audio.js";

const elements = {
  providerPicker: document.getElementById("provider-picker"),
  voiceSelect: document.getElementById("voice-select"),
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
  playbackStatus: document.getElementById("playback-status"),
  statusMessage: document.getElementById("status-message"),
  refreshVoices: document.getElementById("refresh-voices"),
  saveCredentials: document.getElementById("save-credentials"),
  credentialsForms: document.getElementById("credentials-forms"),
  readerTitle: document.getElementById("reader-title"),
  readerProgress: document.getElementById("reader-progress"),
  readerPreview: document.getElementById("reader-preview"),
  chunkList: document.getElementById("chunk-list"),
  sampleButton: document.getElementById("sample-button"),
  clearButton: document.getElementById("clear-button"),
  fileInput: document.getElementById("file-input"),
  pdfInput: document.getElementById("pdf-input"),
};

const persisted = loadState();
const state = {
  provider: persisted.provider || "native",
  voiceId: persisted.voiceId || "",
  text: persisted.text || "",
  title: persisted.title || "",
  chunkMode: persisted.chunkMode || "balanced",
  rate: persisted.rate || 1,
  pitch: persisted.pitch || 1,
  volume: persisted.volume || 1,
  credentials: persisted.credentials || {},
  cachedVoices: persisted.cachedVoices || {},
};

const runtime = {
  mode: "idle",
  queue: [],
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

initialize().catch((error) => {
  console.error(error);
  ui.setStatus("Error", error.message, true);
});

async function initialize() {
  ui.renderProviderPicker(handleProviderSelect);
  ui.renderCredentialsForms();
  ui.hydrateInputs();
  bindEvents();
  await refreshVoices();
  ui.updateStats();
  ui.rebuildQueue();
  ui.setStatus("Idle", "Browser voices work without any key. Cloud providers need your own account credentials.");
}

function bindEvents() {
  elements.textInput.addEventListener("input", () => {
    state.text = elements.textInput.value;
    persistState(state);
    ui.updateStats();
    ui.rebuildQueue();
  });

  elements.titleInput.addEventListener("input", () => {
    state.title = elements.titleInput.value;
    persistState(state);
    ui.updateReaderTitle();
  });

  elements.chunkMode.addEventListener("change", () => {
    state.chunkMode = elements.chunkMode.value;
    persistState(state);
    ui.rebuildQueue();
  });

  elements.rateInput.addEventListener("input", () => {
    state.rate = Number(elements.rateInput.value);
    elements.rateOutput.value = `${state.rate.toFixed(2)}x`;
    persistState(state);
  });

  elements.pitchInput.addEventListener("input", () => {
    state.pitch = Number(elements.pitchInput.value);
    elements.pitchOutput.value = `${state.pitch.toFixed(2)}x`;
    persistState(state);
  });

  elements.volumeInput.addEventListener("input", () => {
    state.volume = Number(elements.volumeInput.value);
    elements.volumeOutput.value = `${Math.round(state.volume * 100)}%`;
    persistState(state);
  });

  elements.voiceSelect.addEventListener("change", () => {
    state.voiceId = elements.voiceSelect.value;
    persistState(state);
  });

  elements.playButton.addEventListener("click", startPlayback);
  elements.pauseButton.addEventListener("click", pausePlayback);
  elements.resumeButton.addEventListener("click", resumePlayback);
  elements.stopButton.addEventListener("click", stopPlayback);
  elements.refreshVoices.addEventListener("click", () => refreshVoices(true));
  elements.saveCredentials.addEventListener("click", saveCredentialInputs);
  elements.sampleButton.addEventListener("click", loadSampleText);
  elements.clearButton.addEventListener("click", clearDocument);
  elements.fileInput.addEventListener("change", importTextFile);
  elements.pdfInput.addEventListener("change", importPdfFile);
}

async function handleProviderSelect(providerId) {
  state.provider = providerId;
  state.voiceId = "";
  persistState(state);
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
  persistState(state);
  ui.setStatus(
    "Saved",
    "Credentials saved in this browser only. For personal use this is fine; for production use a backend proxy instead of exposing keys in the client."
  );
}

async function refreshVoices(forceRefresh) {
  const provider = providers[state.provider];
  try {
    ui.setStatus("Loading", `Loading ${provider.label} voices...`);
    const voices = await provider.listVoices(forceRefresh);
    if (state.provider === "native" || state.provider === "openai" || state.provider === "googleTranslate") {
      state.cachedVoices[state.provider] = { expire: Date.now() + 24 * 60 * 60 * 1000, items: voices };
    }
    ui.populateVoiceSelect(voices);
    persistState(state);
    ui.setStatus("Ready", `${voices.length} ${provider.label} voices available.`);
  } catch (error) {
    ui.populateVoiceSelect([]);
    ui.setStatus("Error", error.message, true);
    throw error;
  }
}

function loadSampleText() {
  state.title = "A quieter way to read the web";
  state.text = [
    "Read Aloud Web is designed as a calm text-to-speech workspace instead of a browser popup. Paste an article, a study note, a script, or your own writing and listen without the extension-only constraints.",
    "Browser voices work immediately with no account setup. Cloud providers need your own keys because those voices are billed and managed by the provider, not bundled inside this app.",
    "For a personal setup, entering your own keys in the browser is acceptable. For anything shared publicly, those keys should move behind your own backend so they never leak to other users.",
  ].join("\n\n");
  elements.titleInput.value = state.title;
  elements.textInput.value = state.text;
  persistState(state);
  ui.updateStats();
  ui.rebuildQueue();
}

function clearDocument() {
  stopPlayback();
  state.title = "";
  state.text = "";
  elements.titleInput.value = "";
  elements.textInput.value = "";
  persistState(state);
  ui.updateStats();
  ui.rebuildQueue();
  ui.setStatus("Idle", "Document cleared. Paste text, import a TXT, or import a PDF.");
}

async function importTextFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  state.text = await file.text();
  state.title = state.title || file.name.replace(/\.[^.]+$/, "");
  elements.textInput.value = state.text;
  elements.titleInput.value = state.title;
  persistState(state);
  ui.updateStats();
  ui.rebuildQueue();
  ui.setStatus("Ready", `Imported text file: ${file.name}`);
  event.target.value = "";
}

async function importPdfFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const result = await extractTextFromPdf(file, (message) => ui.setStatus("Loading", message));
    if (!result.text.trim()) throw new Error("No readable text was found in that PDF.");
    state.text = result.text;
    state.title = state.title || result.title;
    elements.textInput.value = state.text;
    elements.titleInput.value = state.title;
    persistState(state);
    ui.updateStats();
    ui.rebuildQueue();
    ui.setStatus("Ready", `Imported ${result.pageCount} PDF pages from ${file.name}.`);
  } catch (error) {
    ui.setStatus("Error", `PDF import failed: ${error.message}`, true);
  } finally {
    event.target.value = "";
  }
}

async function startPlayback() {
  if (!runtime.queue.length) {
    ui.setStatus("Error", "There is no text to read yet.", true);
    return;
  }
  if (!state.voiceId) {
    ui.setStatus("Error", "Choose a voice before starting playback.", true);
    return;
  }
  if (runtime.mode === "playing") return;

  runtime.stopRequested = false;
  runtime.paused = false;
  runtime.mode = "playing";
  if (runtime.currentIndex < 0 || runtime.currentIndex >= runtime.queue.length) runtime.currentIndex = 0;

  ui.setTransportState();
  ui.setStatus("Playing", "Starting playback...");

  try {
    await playQueueFromCurrentIndex();
    if (!runtime.stopRequested) ui.setStatus("Finished", "Playback reached the end of the queue.");
  } catch (error) {
    ui.setStatus("Error", error.message, true);
  } finally {
    runtime.mode = "idle";
    runtime.paused = false;
    releaseAudioResources(runtime);
    ui.setTransportState();
    ui.renderQueue();
  }
}

async function playQueueFromCurrentIndex() {
  while (runtime.currentIndex >= 0 && runtime.currentIndex < runtime.queue.length) {
    if (runtime.stopRequested) return;
    const provider = providers[state.provider];
    const voice = getActiveVoices().find((item) => item.id === state.voiceId);
    if (!voice) throw new Error("The selected voice is no longer available. Refresh the voice list and try again.");

    ui.renderQueue();
    ui.updateReaderProgress();
    ui.setStatus("Playing", `Reading chunk ${runtime.currentIndex + 1} of ${runtime.queue.length} with ${provider.label}.`);

    await provider.speak(runtime.queue[runtime.currentIndex], voice, {
      rate: state.rate,
      pitch: state.pitch,
      volume: state.volume,
      onStart: () => {
        runtime.mode = "playing";
        ui.setTransportState();
      },
      onBoundary: (start, end) => {
        runtime.activeWordRange = { chunkIndex: runtime.currentIndex, start, end };
        ui.updateReaderPreview();
      },
    });

    runtime.activeWordRange = null;
    runtime.currentIndex += 1;
    ui.renderQueue();
  }
}

function pausePlayback() {
  if (runtime.mode !== "playing") return;
  runtime.paused = true;
  runtime.mode = "paused";
  if (runtime.currentAudio) runtime.currentAudio.pause();
  if (runtime.currentUtterance) speechSynthesis.pause();
  ui.setStatus("Paused", "Playback paused.");
  ui.setTransportState();
}

function resumePlayback() {
  if (runtime.mode !== "paused") return;
  runtime.paused = false;
  runtime.mode = "playing";
  if (runtime.currentAudio) runtime.currentAudio.play().catch((error) => ui.setStatus("Error", error.message, true));
  if (runtime.currentUtterance) speechSynthesis.resume();
  ui.setStatus("Playing", "Playback resumed.");
  ui.setTransportState();
}

function stopPlayback() {
  runtime.stopRequested = true;
  runtime.paused = false;
  runtime.mode = "idle";
  runtime.activeWordRange = null;
  if (runtime.currentAudio) runtime.currentAudio.pause();
  if (runtime.currentUtterance) speechSynthesis.cancel();
  releaseAudioResources(runtime);
  ui.setTransportState();
  ui.updateReaderPreview();
  if (runtime.queue.length) ui.renderQueue();
  ui.setStatus("Stopped", "Playback stopped.");
}

function getActiveVoices() {
  const possibleKeys = [
    state.provider,
    ...Object.keys(state.cachedVoices).filter((key) => key.startsWith(`${state.provider}:`)),
  ];
  for (const key of possibleKeys) {
    const entry = state.cachedVoices[key];
    if (Array.isArray(entry?.items)) return entry.items;
  }
  return [];
}
