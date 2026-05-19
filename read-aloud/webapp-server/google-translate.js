const GOOGLE_TRANSLATE_URL = "https://translate.google.com";

const voiceList = [
  { id: "GoogleTranslate Hindi", name: "GoogleTranslate Hindi", lang: "hi" },
  { id: "GoogleTranslate English", name: "GoogleTranslate English", lang: "en" },
  { id: "GoogleTranslate Bengali", name: "GoogleTranslate Bengali", lang: "bn" },
  { id: "GoogleTranslate Gujarati", name: "GoogleTranslate Gujarati", lang: "gu" },
  { id: "GoogleTranslate Marathi", name: "GoogleTranslate Marathi", lang: "mr" },
  { id: "GoogleTranslate Tamil", name: "GoogleTranslate Tamil", lang: "ta" },
  { id: "GoogleTranslate Telugu", name: "GoogleTranslate Telugu", lang: "te" },
  { id: "GoogleTranslate Urdu", name: "GoogleTranslate Urdu", lang: "ur" },
];

async function getVoices() {
  return voiceList;
}

async function synthesizeSpeech(text, lang) {
  if (!text || !lang) throw new Error("Missing text or lang");
  
  const url = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${lang}&q=${encodeURIComponent(text)}`;
  
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  
  if (!response.ok) {
    throw new Error(`Google Translate translate_tts failed with ${response.status}`);
  }
  
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer);
}

module.exports = {
  getVoices,
  synthesizeSpeech,
};
