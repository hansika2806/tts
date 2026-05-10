import { MAX_CHARS_PER_CHUNK } from "./config.js";

export function buildChunks(text, mode) {
  const cleaned = text.trim().replace(/\r/g, "");
  if (!cleaned) return [];

  const paragraphs = cleaned.split(/\n{2,}/).map((item) => item.trim()).filter(Boolean);
  const maxChars = MAX_CHARS_PER_CHUNK[mode] || MAX_CHARS_PER_CHUNK.balanced;
  const chunks = [];

  paragraphs.forEach((paragraph) => {
    if (paragraph.length <= maxChars) {
      chunks.push({ text: paragraph });
      return;
    }

    const sentences = paragraph.match(/[^.!?]+[.!?]*\s*/g) || [paragraph];
    let current = "";

    sentences.forEach((sentence) => {
      const candidate = current ? `${current} ${sentence.trim()}`.trim() : sentence.trim();
      if (candidate.length > maxChars && current) {
        chunks.push({ text: current });
        current = sentence.trim();
      } else if (candidate.length > maxChars) {
        splitLongSentence(sentence.trim(), maxChars).forEach((part) => chunks.push({ text: part }));
        current = "";
      } else {
        current = candidate;
      }
    });

    if (current) chunks.push({ text: current });
  });

  return chunks;
}

function splitLongSentence(sentence, maxChars) {
  const words = sentence.split(/\s+/);
  const parts = [];
  let current = "";
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      parts.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) parts.push(current);
  return parts;
}
