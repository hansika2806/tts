const { synthesizeSpeech, getVoices } = require('./webapp-server/google-translate.js');

(async () => {
  try {
    const voices = await getVoices();
    console.log("Voices:", voices);
    const audio = await synthesizeSpeech("hello world", "en");
    console.log("Audio length:", audio.length);
  } catch (e) {
    console.error("Error:", e);
  }
})();
