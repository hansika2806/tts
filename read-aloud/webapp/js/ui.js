import { PROVIDER_ORDER } from "./config.js";
import { buildChunks } from "./queue.js";
import { escapeHtml, renderTextWithActiveWord } from "./utils.js";

export function createUi(elements, state, runtime, providers, persistState) {
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
        input.id = `cred-${providerId}-${field.key}`;
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
    elements.chunkMode.value = state.chunkMode;
    elements.rateInput.value = String(state.rate);
    elements.pitchInput.value = String(state.pitch);
    elements.volumeInput.value = String(state.volume);
    elements.rateOutput.value = `${state.rate.toFixed(2)}x`;
    elements.pitchOutput.value = `${state.pitch.toFixed(2)}x`;
    elements.volumeOutput.value = `${Math.round(state.volume * 100)}%`;
    updateReaderTitle();
  }

  function populateVoiceSelect(voices) {
    elements.voiceSelect.innerHTML = "";
    if (!voices.length) {
      state.voiceId = "";
      const option = document.createElement("option");
      option.value = "";
      option.textContent = "No voices available";
      elements.voiceSelect.appendChild(option);
      persistState(state);
      return;
    }
    const currentVoiceExists = voices.some((voice) => voice.id === state.voiceId);
    if (!currentVoiceExists) state.voiceId = voices[0].id;
    voices.forEach((voice) => {
      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = voice.lang ? `${voice.name} - ${voice.lang}` : voice.name;
      if (voice.id === state.voiceId) option.selected = true;
      elements.voiceSelect.appendChild(option);
    });
    persistState(state);
  }

  function updateStats() {
    const text = state.text.trim();
    elements.charCount.textContent = `${text.length.toLocaleString()} characters`;
    elements.chunkCount.textContent = `${buildChunks(text, state.chunkMode).length} reading chunks`;
  }

  function rebuildQueue() {
    runtime.queue = buildChunks(state.text, state.chunkMode);
    runtime.currentIndex = Math.min(runtime.currentIndex, runtime.queue.length - 1);
    runtime.activeWordRange = null;
    renderQueue();
    updateReaderTitle();
    updateReaderProgress();
  }

  function renderQueue() {
    elements.chunkList.innerHTML = "";
    if (!runtime.queue.length) {
      elements.readerPreview.classList.add("empty");
      elements.readerPreview.textContent = "Playback highlights active chunks here.";
      updateReaderProgress();
      return;
    }
    runtime.queue.forEach((chunk, index) => {
      const item = document.createElement("article");
      item.className = "chunk-item";
      if (index === runtime.currentIndex) item.classList.add("is-active");
      if (index < runtime.currentIndex) item.classList.add("is-done");
      item.dataset.index = String(index);
      item.innerHTML = `
        <div class="chunk-item-header">
          <span>Chunk ${index + 1}</span>
          <span>${chunk.text.length} chars</span>
        </div>
        <p>${escapeHtml(chunk.text)}</p>
      `;
      item.addEventListener("click", () => {
        runtime.currentIndex = index;
        runtime.activeWordRange = null;
        renderQueue();
        updateReaderPreview();
        updateReaderProgress();
      });
      elements.chunkList.appendChild(item);
    });
    updateReaderPreview();
    updateReaderProgress();
  }

  function updateReaderTitle() {
    elements.readerTitle.textContent = state.title.trim() || "Untitled session";
  }

  function updateReaderProgress() {
    const current = runtime.currentIndex >= 0 ? Math.min(runtime.currentIndex + 1, runtime.queue.length) : 0;
    elements.readerProgress.textContent = `${current} / ${runtime.queue.length}`;
  }

  function updateReaderPreview() {
    const chunk = runtime.queue[runtime.currentIndex];
    if (!chunk) {
      elements.readerPreview.classList.add("empty");
      elements.readerPreview.textContent = "Playback highlights active chunks here.";
      return;
    }
    elements.readerPreview.classList.remove("empty");
    if (runtime.activeWordRange && runtime.activeWordRange.chunkIndex === runtime.currentIndex) {
      elements.readerPreview.innerHTML = renderTextWithActiveWord(chunk.text, runtime.activeWordRange.start, runtime.activeWordRange.end);
    } else {
      elements.readerPreview.textContent = chunk.text;
    }
  }

  function setTransportState() {
    const isPlaying = runtime.mode === "playing";
    const isPaused = runtime.mode === "paused";
    elements.playButton.disabled = isPlaying;
    elements.pauseButton.disabled = !isPlaying;
    elements.resumeButton.disabled = !isPaused;
    elements.stopButton.disabled = !(isPlaying || isPaused);
  }

  function setStatus(label, message, isError) {
    elements.playbackStatus.textContent = label;
    elements.statusMessage.textContent = message;
    if (elements.statusCard) {
      const state = isError ? "error"
        : label.toLowerCase() === "playing" ? "playing"
        : label.toLowerCase() === "paused"  ? "paused"
        : "";
      elements.statusCard.dataset.state = state;
    }
  }

  return {
    renderProviderPicker,
    renderCredentialsForms,
    hydrateInputs,
    populateVoiceSelect,
    updateStats,
    rebuildQueue,
    renderQueue,
    updateReaderTitle,
    updateReaderProgress,
    updateReaderPreview,
    setTransportState,
    setStatus,
  };
}
