import { OPENAI_DEFAULT_VOICES } from "./config.js";
import { loadNativeVoices, playBlobAudio, speakWithNativeVoice } from "./audio.js";
import {
  azurePitchValue,
  azureRateValue,
  base64ToBlob,
  escapeXml,
  extractProviderError,
  sanitizeBaseUrl,
} from "./utils.js";

export function createProviders(state, playback) {
  return {
    native: {
      id: "native",
      label: "Browser",
      blurb: "Uses installed Web Speech voices on this device.",
      async listVoices() {
        const voices = await loadNativeVoices();
        return voices.map((voice) => ({
          id: voice.voiceURI || voice.name,
          name: voice.name,
          lang: voice.lang,
          voice,
        }));
      },
      async speak(chunk, voiceEntry, controls) {
        return speakWithNativeVoice(chunk, voiceEntry, playback, controls);
      },
    },
    googleTranslate: {
      id: "googleTranslate",
      label: "Google Translate",
      blurb: "Experimental proxy for unofficial Google Translate voices. No key required, may break anytime.",
      async listVoices(forceRefresh) {
        const cacheKey = "googleTranslate";
        if (!forceRefresh && canUseVoiceCache(cacheKey, state)) return state.cachedVoices[cacheKey].items;
        const response = await fetch("/api/google-translate/voices");
        if (!response.ok) throw new Error(await extractProviderError(response, "Google Translate voice list failed"));
        const voices = await response.json();
        saveVoiceCache(cacheKey, voices, state);
        return voices;
      },
      async speak(chunk, voiceEntry, controls) {
        const response = await fetch("/api/google-translate/speak", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: chunk.text,
            lang: voiceEntry.lang,
          }),
        });
        if (!response.ok) throw new Error(await extractProviderError(response, "Google Translate synthesis failed"));
        return playBlobAudio(await response.blob(), playback, controls, controls.rate);
      },
    },
    openai: {
      id: "openai",
      label: "OpenAI",
      blurb: "Official speech API voices. Requires API key.",
      credentials: [
        { key: "apiKey", label: "API key", type: "password", placeholder: "sk-..." },
        { key: "baseUrl", label: "Base URL", placeholder: "https://api.openai.com/v1" },
        { key: "model", label: "Default model", placeholder: "gpt-4o-mini-tts" },
        { key: "instructions", label: "Speaking instructions", type: "textarea", placeholder: "Warm, natural, patient narration." },
      ],
      async listVoices() {
        return OPENAI_DEFAULT_VOICES.map((voice) => ({
          id: voice.id,
          name: voice.name,
          model: state.credentials.openai?.model || voice.model,
          voice,
        }));
      },
      async speak(chunk, voiceEntry, controls) {
        const creds = getProviderCreds("openai", ["apiKey"], state, this);
        const baseUrl = sanitizeBaseUrl(creds.baseUrl || "https://api.openai.com/v1");
        const payload = {
          model: creds.model || voiceEntry.model || "gpt-4o-mini-tts",
          input: chunk.text,
          voice: voiceEntry.id,
          response_format: "mp3",
          speed: controls.rate,
          instructions: creds.instructions || undefined,
        };
        const response = await fetch(`${baseUrl}/audio/speech`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${creds.apiKey}`,
          },
          body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(await extractProviderError(response, "OpenAI speech request failed"));
        return playBlobAudio(await response.blob(), playback, controls, 1);
      },
    },
    google: {
      id: "google",
      label: "Google Cloud",
      blurb: "Official Cloud Text-to-Speech voices via API key.",
      credentials: [
        { key: "apiKey", label: "API key", type: "password", placeholder: "Google Cloud API key" },
      ],
      async listVoices(forceRefresh) {
        const creds = getProviderCreds("google", ["apiKey"], state, this);
        const cacheKey = "google";
        if (!forceRefresh && canUseVoiceCache(cacheKey, state)) return state.cachedVoices[cacheKey].items;
        const response = await fetch(`https://texttospeech.googleapis.com/v1/voices?key=${encodeURIComponent(creds.apiKey)}`);
        if (!response.ok) throw new Error(await extractProviderError(response, "Google voice list failed"));
        const data = await response.json();
        const voices = (data.voices || []).map((voice) => ({
          id: voice.name,
          name: `${voice.name} (${voice.ssmlGender || "Unknown"})`,
          lang: voice.languageCodes?.[0] || "",
          voice,
        }));
        saveVoiceCache(cacheKey, voices, state);
        return voices;
      },
      async speak(chunk, voiceEntry, controls) {
        const creds = getProviderCreds("google", ["apiKey"], state, this);
        const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(creds.apiKey)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            input: { text: chunk.text },
            voice: {
              name: voiceEntry.id,
              languageCode: voiceEntry.lang || voiceEntry.voice.languageCodes?.[0],
            },
            audioConfig: {
              audioEncoding: "MP3",
              speakingRate: controls.rate,
              pitch: Math.round((controls.pitch - 1) * 20),
            },
          }),
        });
        if (!response.ok) throw new Error(await extractProviderError(response, "Google synthesis failed"));
        const data = await response.json();
        if (!data.audioContent) throw new Error("Google Cloud returned no audio");
        return playBlobAudio(base64ToBlob(data.audioContent, "audio/mpeg"), playback, controls, 1);
      },
    },
    amazon: {
      id: "amazon",
      label: "Amazon Polly",
      blurb: "Official Amazon Polly via browser AWS SDK credentials.",
      credentials: [
        { key: "accessKeyId", label: "Access key ID", placeholder: "AKIA..." },
        { key: "secretAccessKey", label: "Secret access key", type: "password", placeholder: "AWS secret access key" },
        { key: "region", label: "Region", placeholder: "us-east-1" },
      ],
      async listVoices(forceRefresh) {
        ensureAwsSdk();
        const creds = getProviderCreds("amazon", ["accessKeyId", "secretAccessKey", "region"], state, this);
        const cacheKey = `amazon:${creds.region}`;
        if (!forceRefresh && canUseVoiceCache(cacheKey, state)) return state.cachedVoices[cacheKey].items;
        const polly = createPollyClient(creds);
        const voices = await listAmazonPollyVoices(polly);
        saveVoiceCache(cacheKey, voices, state);
        return voices;
      },
      async speak(chunk, voiceEntry, controls) {
        ensureAwsSdk();
        const creds = getProviderCreds("amazon", ["accessKeyId", "secretAccessKey", "region"], state, this);
        const polly = createPollyClient(creds);
        const params = {
          OutputFormat: "mp3",
          Text: chunk.text,
          VoiceId: voiceEntry.voice.VoiceId,
          Engine: voiceEntry.engine || (voiceEntry.voice.SupportedEngines?.includes("neural") ? "neural" : "standard"),
        };
        if (voiceEntry.lang) params.LanguageCode = voiceEntry.lang;
        const result = await polly.synthesizeSpeech(params).promise();
        return playBlobAudio(new Blob([result.AudioStream], { type: "audio/mpeg" }), playback, controls, controls.rate);
      },
    },
    azure: {
      id: "azure",
      label: "Azure",
      blurb: "Official Azure Speech voices via region and key.",
      credentials: [
        { key: "key", label: "Speech key", type: "password", placeholder: "Azure Speech key" },
        { key: "region", label: "Region", placeholder: "eastus" },
      ],
      async listVoices(forceRefresh) {
        const creds = getProviderCreds("azure", ["key", "region"], state, this);
        const cacheKey = `azure:${creds.region}`;
        if (!forceRefresh && canUseVoiceCache(cacheKey, state)) return state.cachedVoices[cacheKey].items;
        const response = await fetch(`https://${creds.region}.tts.speech.microsoft.com/cognitiveservices/voices/list`, {
          headers: { "Ocp-Apim-Subscription-Key": creds.key },
        });
        if (!response.ok) throw new Error(await extractProviderError(response, "Azure voice list failed"));
        const data = await response.json();
        const voices = data.map((item) => ({
          id: item.ShortName,
          name: `${item.LocalName} (${item.Locale})`,
          lang: item.Locale,
          voice: item,
        }));
        saveVoiceCache(cacheKey, voices, state);
        return voices;
      },
      async speak(chunk, voiceEntry, controls) {
        const creds = getProviderCreds("azure", ["key", "region"], state, this);
        const response = await fetch(`https://${creds.region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
          method: "POST",
          headers: {
            "Ocp-Apim-Subscription-Key": creds.key,
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-16khz-64kbitrate-mono-mp3",
          },
          body: `<speak version="1.0" xml:lang="${voiceEntry.lang || "en-US"}"><voice name="${escapeXml(voiceEntry.id)}"><prosody rate="${azureRateValue(controls.rate)}" pitch="${azurePitchValue(controls.pitch)}">${escapeXml(chunk.text)}</prosody></voice></speak>`,
        });
        if (!response.ok) throw new Error(await extractProviderError(response, "Azure synthesis failed"));
        return playBlobAudio(await response.blob(), playback, controls, 1);
      },
    },
    ibm: {
      id: "ibm",
      label: "IBM",
      blurb: "Official IBM Watson Text to Speech.",
      credentials: [
        { key: "apiKey", label: "API key", type: "password", placeholder: "IBM Watson API key" },
        { key: "url", label: "Service URL", placeholder: "https://api.us-south.text-to-speech.watson.cloud.ibm.com/instances/..." },
      ],
      async listVoices(forceRefresh) {
        const creds = getProviderCreds("ibm", ["apiKey", "url"], state, this);
        const cacheKey = `ibm:${creds.url}`;
        if (!forceRefresh && canUseVoiceCache(cacheKey, state)) return state.cachedVoices[cacheKey].items;
        const response = await fetch(`${sanitizeBaseUrl(creds.url)}/v1/voices`, {
          headers: { Authorization: `Basic ${btoa(`apikey:${creds.apiKey}`)}` },
        });
        if (!response.ok) throw new Error(await extractProviderError(response, "IBM voice list failed"));
        const data = await response.json();
        const voices = (data.voices || []).map((voice) => ({
          id: voice.name,
          name: voice.description,
          lang: voice.language,
          voice,
        }));
        saveVoiceCache(cacheKey, voices, state);
        return voices;
      },
      async speak(chunk, voiceEntry, controls) {
        const creds = getProviderCreds("ibm", ["apiKey", "url"], state, this);
        const response = await fetch(`${sanitizeBaseUrl(creds.url)}/v1/synthesize?voice=${encodeURIComponent(voiceEntry.id)}&accept=${encodeURIComponent("audio/mp3")}`, {
          method: "POST",
          headers: {
            Authorization: `Basic ${btoa(`apikey:${creds.apiKey}`)}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ text: chunk.text }),
        });
        if (!response.ok) throw new Error(await extractProviderError(response, "IBM synthesis failed"));
        return playBlobAudio(await response.blob(), playback, controls, controls.rate);
      },
    },
  };
}

function getProviderCreds(providerId, requiredKeys, state, provider) {
  const creds = state.credentials[providerId] || {};
  const missing = requiredKeys.filter((key) => !creds[key]);
  if (missing.length) throw new Error(`${provider.label} requires: ${missing.join(", ")}`);
  return creds;
}

function canUseVoiceCache(key, state) {
  const cached = state.cachedVoices[key];
  return Boolean(cached && cached.expire && cached.expire >= Date.now() && Array.isArray(cached.items));
}

function saveVoiceCache(key, voices, state) {
  state.cachedVoices[key] = {
    expire: Date.now() + 24 * 60 * 60 * 1000,
    items: voices,
  };
}

function ensureAwsSdk() {
  if (!window.AWS) throw new Error("AWS SDK failed to load for Amazon Polly.");
}

function createPollyClient(creds) {
  AWS.config.update({
    accessKeyId: creds.accessKeyId,
    secretAccessKey: creds.secretAccessKey,
    region: creds.region,
  });
  return new AWS.Polly({ region: creds.region });
}

async function listAmazonPollyVoices(polly, nextToken, acc) {
  const result = acc || [];
  const response = await polly.describeVoices(nextToken ? { NextToken: nextToken } : {}).promise();
  response.Voices.forEach((voice) => {
    const engines = voice.SupportedEngines || ["standard"];
    engines.forEach((engine) => {
      result.push({
        id: `${voice.Id}:${engine}`,
        name: `AmazonPolly ${voice.LanguageName} (${voice.Id}) +${engine}`,
        lang: voice.LanguageCode,
        engine,
        voice,
      });
    });
  });
  if (response.NextToken) return listAmazonPollyVoices(polly, response.NextToken, result);
  return result;
}
