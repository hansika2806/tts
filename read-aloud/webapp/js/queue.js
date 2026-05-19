import { MAX_CHARS_PER_CHUNK } from "./config.js";
import { splitIntoChapters } from "./chapters.js";

const FOOTNOTE_LINE = /^\[?\d+\]?$|^\(\d+\)$|^footnote\b|^\u0938\u0942\u091a\u0928\u093e\b/i;
const SCENE_BREAK = /^\*{3,}$|^#{3,}$/;
const DIALOGUE_START = /^["'\u201c\u2018\u00ab\u300e\u201e\u2039\u002d\u2014]/;

export function buildChunks(text, mode, options = {}) {
  const cleaned = text.trim().replace(/\r/g, "");
  if (!cleaned) return [];

  const skipFootnotes = options.skipFootnotes !== false;
  const useChapters = mode === "novel" || options.useChapters;

  if (useChapters) {
    const chapters = splitIntoChapters(cleaned);
    const chunks = [];
    chapters.forEach((ch, chapterIndex) => {
      const parts = chunkChapterBody(ch.body, mode, skipFootnotes);
      parts.forEach((part) => {
        chunks.push({
          text: part.text,
          chapterIndex,
          chapterTitle: ch.title,
          isFootnote: part.isFootnote,
          isDialogue: part.isDialogue,
        });
      });
    });
    return chunks;
  }

  return chunkPlainText(cleaned, mode, skipFootnotes);
}

export function buildChunksFromChapters(chapters, mode, options = {}) {
  const skipFootnotes = options.skipFootnotes !== false;
  const chunks = [];
  const source = Array.isArray(chapters) ? chapters : [];

  source.forEach((chapter, chapterIndex) => {
    const title = chapter?.title?.trim() || `Chapter ${chapterIndex + 1}`;
    const body = String(chapter?.text || "").trim();
    if (!body) return;

    const parts = chunkChapterBody(body, mode || "novel", skipFootnotes);
    parts.forEach((part) => {
      chunks.push({
        text: part.text,
        chapterIndex,
        chapterTitle: title,
        isFootnote: part.isFootnote,
        isDialogue: part.isDialogue,
      });
    });
  });

  return chunks;
}

function chunkChapterBody(body, mode, skipFootnotes) {
  const maxChars = MAX_CHARS_PER_CHUNK[mode] || MAX_CHARS_PER_CHUNK.novel;
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];

  paragraphs.forEach((paragraph) => {
    if (skipFootnotes && FOOTNOTE_LINE.test(paragraph)) return;
    if (SCENE_BREAK.test(paragraph)) return;

    const pieces = paragraph.length <= maxChars
      ? [paragraph]
      : packSentences(paragraph, maxChars);

    pieces.forEach((text) => {
      chunks.push({
        text,
        isFootnote: false,
        isDialogue: DIALOGUE_START.test(text.trim()),
      });
    });
  });

  return chunks;
}

function chunkPlainText(cleaned, mode, skipFootnotes) {
  const paragraphs = cleaned.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const maxChars = MAX_CHARS_PER_CHUNK[mode] || MAX_CHARS_PER_CHUNK.balanced;
  const chunks = [];

  paragraphs.forEach((paragraph) => {
    if (skipFootnotes && FOOTNOTE_LINE.test(paragraph)) return;
    if (paragraph.length <= maxChars) {
      chunks.push({ text: paragraph, isDialogue: DIALOGUE_START.test(paragraph) });
      return;
    }
    packSentences(paragraph, maxChars).forEach((text) => {
      chunks.push({ text, isDialogue: DIALOGUE_START.test(text.trim()) });
    });
  });

  return chunks;
}

function packSentences(paragraph, maxChars) {
  const sentences = paragraph.match(/[^.!?\u0964]+[.!?\u0964]*\s*/g) || [paragraph];
  const parts = [];
  let current = "";

  sentences.forEach((sentence) => {
    const s = sentence.trim();
    if (!s) return;
    const candidate = current ? `${current} ${s}`.trim() : s;
    if (candidate.length > maxChars && current) {
      parts.push(current);
      if (s.length > maxChars) {
        splitLongSentence(s, maxChars).forEach((p) => parts.push(p));
        current = "";
      } else {
        current = s;
      }
    } else if (candidate.length > maxChars) {
      splitLongSentence(s, maxChars).forEach((p) => parts.push(p));
      current = "";
    } else {
      current = candidate;
    }
  });

  if (current) parts.push(current);
  return parts;
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
