/** Apply per-book pronunciation replacements before TTS. */

export function applyPronunciations(text, dict = {}) {
  if (!text || !dict || !Object.keys(dict).length) return text;
  let out = text;
  const entries = Object.entries(dict).sort((a, b) => b[0].length - a[0].length);
  for (const [word, replacement] of entries) {
    if (!word || !replacement) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(escaped, "gi"), replacement);
  }
  return out;
}

export function parsePronunciationLines(raw) {
  const dict = {};
  raw.split("\n").forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const sep = t.includes("=") ? "=" : t.includes("\t") ? "\t" : ":";
    const [word, ...rest] = t.split(sep);
    const replacement = rest.join(sep).trim();
    if (word?.trim() && replacement) dict[word.trim()] = replacement;
  });
  return dict;
}

export function dictToLines(dict) {
  return Object.entries(dict || {})
    .map(([k, v]) => `${k} = ${v}`)
    .join("\n");
}
