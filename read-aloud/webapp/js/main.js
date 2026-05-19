import { persistState, loadState } from "./storage.js";
import { createProviders } from "./providers.js";
import { createUi } from "./ui.js";
import { extractTextFromPdf } from "./pdf-import.js";
import { releaseAudioResources } from "./audio.js";
import { initPdfReader } from "./pdf-controller.js";

const elements = {
  providerPicker:  document.getElementById("provider-picker"),
  voiceSelect:     document.getElementById("voice-select"),
  textInput:       document.getElementById("text-input"),
  titleInput:      document.getElementById("document-title"),
  charCount:       document.getElementById("char-count"),
  chunkCount:      document.getElementById("chunk-count"),
  chunkMode:       document.getElementById("chunk-mode"),
  rateInput:       document.getElementById("rate-input"),
  pitchInput:      document.getElementById("pitch-input"),
  volumeInput:     document.getElementById("volume-input"),
  rateOutput:      document.getElementById("rate-output"),
  pitchOutput:     document.getElementById("pitch-output"),
  volumeOutput:    document.getElementById("volume-output"),
  // Sidebar mini-player buttons (authoritative — player tab forwards to these)
  playButton:      document.getElementById("play-button"),
  pauseButton:     document.getElementById("pause-button"),
  resumeButton:    document.getElementById("resume-button"),
  stopButton:      document.getElementById("stop-button"),
  downloadButton:  document.getElementById("download-button"),
  playbackStatus:  document.getElementById("playback-status"),
  statusMessage:   document.getElementById("status-message"),
  statusCard:      document.getElementById("status-card"),
  refreshVoices:   document.getElementById("refresh-voices"),
  saveCredentials: document.getElementById("save-credentials"),
  credentialsForms:document.getElementById("credentials-forms"),
  readerTitle:     document.getElementById("reader-title"),
  readerProgress:  document.getElementById("reader-progress"),
  readerPreview:   document.getElementById("reader-preview"),
  chunkList:       document.getElementById("chunk-list"),
  sampleButton:    document.getElementById("sample-button"),
  clearButton:     document.getElementById("clear-button"),
  fileInput:       document.getElementById("file-input"),
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
  // Initialize the standalone PDF book reader
  initPdfReader(state, runtime, providers, ui);
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
    if (runtime.currentAudio) runtime.currentAudio.playbackRate = state.rate;
    if (runtime.currentUtterance) runtime.currentUtterance.rate = state.rate;
  });

  elements.pitchInput.addEventListener("input", () => {
    state.pitch = Number(elements.pitchInput.value);
    elements.pitchOutput.value = `${state.pitch.toFixed(2)}x`;
    persistState(state);
    if (runtime.currentUtterance) runtime.currentUtterance.pitch = state.pitch;
  });

  elements.volumeInput.addEventListener("input", () => {
    state.volume = Number(elements.volumeInput.value);
    elements.volumeOutput.value = `${Math.round(state.volume * 100)}%`;
    persistState(state);
    if (runtime.currentAudio) runtime.currentAudio.volume = state.volume;
    if (runtime.currentUtterance) runtime.currentUtterance.volume = state.volume;
  });

  elements.voiceSelect.addEventListener("change", () => {
    state.voiceId = elements.voiceSelect.value;
    persistState(state);
  });

  elements.playButton.addEventListener("click", startPlayback);
  elements.pauseButton.addEventListener("click", pausePlayback);
  elements.resumeButton.addEventListener("click", resumePlayback);
  elements.stopButton.addEventListener("click", stopPlayback);
  elements.downloadButton.addEventListener("click", downloadAudio);
  elements.refreshVoices.addEventListener("click", () => refreshVoices(true));
  elements.saveCredentials.addEventListener("click", saveCredentialInputs);
  elements.sampleButton.addEventListener("click", loadSampleText);
  elements.clearButton.addEventListener("click", clearDocument);
  elements.fileInput.addEventListener("change", importTextFile);
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

async function downloadAudio() {
  if (!runtime.queue.length) {
    ui.setStatus("Error", "There is no text to download yet.", true);
    return;
  }
  if (!state.voiceId) {
    ui.setStatus("Error", "Choose a voice before downloading.", true);
    return;
  }
  
  if (state.provider !== "googleTranslate") {
    ui.setStatus("Error", "Downloading is currently only supported for Google Translate.", true);
    return;
  }

  ui.setStatus("Loading", "Generating audio for download. Please wait...");
  
  try {
    const voice = getActiveVoices().find((item) => item.id === state.voiceId);
    let allBlobs = [];
    
    for (let j = 0; j < runtime.queue.length; j++) {
      const chunk = runtime.queue[j];
      const words = chunk.text.split(/\s+/);
      const subChunks = [];
      let current = "";
      for (const word of words) {
        if ((current + " " + word).length > 180) {
          if (current) subChunks.push(current.trim());
          current = word;
        } else {
          current += (current ? " " : "") + word;
        }
      }
      if (current) subChunks.push(current.trim());

      for (let i = 0; i < subChunks.length; i++) {
        ui.setStatus("Loading", `Generating chunk ${j + 1}/${runtime.queue.length} (sub-part ${i + 1}/${subChunks.length})...`);
        const response = await fetch("/api/google-translate/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: subChunks[i],
            lang: voice.lang,
          }),
        });
        if (!response.ok) throw new Error("Synthesis failed");
        allBlobs.push(await response.blob());
      }
    }
    
    ui.setStatus("Loading", "Stitching audio together...");
    const finalBlob = new Blob(allBlobs, { type: "audio/mpeg" });
    const url = URL.createObjectURL(finalBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = (state.title || "read_aloud_audio").replace(/[^a-z0-9]/gi, '_').toLowerCase() + ".mp3";
    a.click();
    URL.revokeObjectURL(url);
    
    ui.setStatus("Ready", "Audio downloaded successfully.");
  } catch (err) {
    ui.setStatus("Error", "Failed to download audio: " + err.message, true);
  }
}
