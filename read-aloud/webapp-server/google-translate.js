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

let wizCache = null;
let batchNumber = 0;

async function getVoices() {
  return voiceList;
}

async function synthesizeSpeech(text, lang) {
  if (!text || !lang) throw new Error("Missing text or lang");
  const payload = await batchExecute("jQ1olc", [text, lang, null]);
  if (!payload || !payload[0]) {
    throw new Error(`Google Translate returned no audio for language ${lang}`);
  }
  return Buffer.from(payload[0], "base64");
}

async function batchExecute(rpcId, payload) {
  const wiz = await getWizGlobalData();
  const { query, body } = getBatchExecuteParams(wiz, rpcId, payload);
  const formBody = new URLSearchParams();
  formBody.set("f.req", body["f.req"]);
  if (body.at) formBody.set("at", body.at);

  const response = await fetch(`${GOOGLE_TRANSLATE_URL}/_/TranslateWebserverUi/data/batchexecute?${new URLSearchParams(query)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "Mozilla/5.0",
    },
    body: formBody.toString(),
  });

  if (!response.ok) {
    throw new Error(`Google Translate batch request failed with ${response.status}`);
  }

  const responseText = await response.text();
  const match = responseText.match(/\d+/);
  if (!match) throw new Error("Google Translate response envelope not found");
  const envelopes = JSON.parse(responseText.substr(match.index + match[0].length, Number(match[0])));
  return JSON.parse(envelopes[0][2]);
}

async function getWizGlobalData() {
  if (wizCache && wizCache.expire > Date.now()) return wizCache;
  const response = await fetch(GOOGLE_TRANSLATE_URL, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`Google Translate homepage fetch failed with ${response.status}`);
  const html = await response.text();
  const scriptStart = html.indexOf("WIZ_global_data = {");
  if (scriptStart === -1) throw new Error("Google Translate wiz data not found");
  const scriptEnd = html.indexOf("</script>", scriptStart);
  const text = html.substring(scriptStart, scriptEnd);

  const data = {
    "f.sid": findProp(text, /"FdrFJe":"(.*?)"/),
    bl: findProp(text, /"cfb2h":"(.*?)"/),
    at: findProp(text, /"SNlM0e":"(.*?)"/),
    expire: Date.now() + 60 * 60 * 1000,
  };
  wizCache = data;
  return data;
}

function findProp(text, pattern) {
  const match = pattern.exec(text);
  if (!match) throw new Error(`Google Translate token not found for ${pattern}`);
  return match[1];
}

function getBatchExecuteParams(wiz, rpcId, payload) {
  return {
    query: {
      rpcids: rpcId,
      "f.sid": wiz["f.sid"],
      bl: wiz.bl,
      hl: "en",
      "soc-app": 1,
      "soc-platform": 1,
      "soc-device": 1,
      _reqid: (++batchNumber * 100000) + Math.floor(1000 + (Math.random() * 9000)),
      rt: "c",
    },
    body: {
      "f.req": JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]]),
      at: wiz.at,
    },
  };
}

module.exports = {
  getVoices,
  synthesizeSpeech,
};
