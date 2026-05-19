import { locateWordBoundary } from "./utils.js";

export async function loadNativeVoices() {
  const loadNow = () => speechSynthesis.getVoices().filter(Boolean);
  let voices = loadNow();
  if (voices.length) return voices;

  return new Promise((resolve) => {
    const handle = () => {
      voices = loadNow();
      if (voices.length) {
        speechSynthesis.removeEventListener("voiceschanged", handle);
        resolve(voices);
      }
    };
    speechSynthesis.addEventListener("voiceschanged", handle);
    setTimeout(() => {
      speechSynthesis.removeEventListener("voiceschanged", handle);
      resolve(loadNow());
    }, 1500);
  });
}

export function speakWithNativeVoice(chunk, voiceEntry, playback, controls) {
  return new Promise((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(chunk.text);
    playback.currentUtterance = utterance;
    utterance.voice = voiceEntry.voice;
    utterance.lang = voiceEntry.lang || voiceEntry.voice.lang;
    utterance.rate = controls.rate;
    utterance.pitch = controls.pitch;
    utterance.volume = controls.volume;
    utterance.onstart = () => controls.onStart?.();
    utterance.onboundary = (event) => {
      if (typeof event.charIndex !== "number") return;
      const [start, end] = locateWordBoundary(chunk.text, event.charIndex);
      controls.onBoundary?.(start, end);
    };
    utterance.onerror = (event) => {
      playback.currentUtterance = null;
      reject(new Error(event.error || "Native speech failed"));
    };
    utterance.onend = () => {
      playback.currentUtterance = null;
      resolve();
    };
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
  });
}

export function playBlobAudio(blob, playback, controls, playbackRate) {
  return new Promise((resolve, reject) => {
    releaseAudioResources(playback);
    playback.currentObjectUrl = URL.createObjectURL(blob);
    const audio = new Audio(playback.currentObjectUrl);
    playback.currentAudio = audio;
    audio.volume = controls.volume;
    if ('preservesPitch' in audio) audio.preservesPitch = true;
    audio.defaultPlaybackRate = playbackRate || 1;
    audio.playbackRate = playbackRate || 1;
    audio.onplay = () => controls.onStart?.();
    audio.onended = () => {
      releaseAudioResources(playback);
      resolve();
    };
    audio.onerror = () => {
      releaseAudioResources(playback);
      reject(new Error("Audio playback failed"));
    };
    audio.play().catch(reject);
  });
}

export function releaseAudioResources(playback) {
  if (playback.currentAudio) {
    playback.currentAudio.onended = null;
    playback.currentAudio.onerror = null;
    playback.currentAudio.onplay = null;
    playback.currentAudio = null;
  }
  if (playback.currentObjectUrl) {
    URL.revokeObjectURL(playback.currentObjectUrl);
    playback.currentObjectUrl = null;
  }
  playback.currentUtterance = null;
}
