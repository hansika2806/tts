/** Detect chapter boundaries for novels (Hindi + English patterns). */

const DEVANAGARI_DIGIT = "\u0966-\u096F";
const CHAPTER_WORDS = "(?:chapter|chapitre|\u0905\u0927\u094d\u092f\u093e\u092f|\u0905\u0927\u094d\u200d\u092f\u093e\u092f)";
const CHAPTER_NUMBER = `[\\d${DEVANAGARI_DIGIT}IVXLC]+`;

const CHAPTER_LINE = new RegExp(
  `^(?:${CHAPTER_WORDS}\\s*${CHAPTER_NUMBER}[.:)\\-\\s]*|[\\d${DEVANAGARI_DIGIT}]+[.)]\\s+|\\*{3,}\\s*$|[=\\-]{3,}\\s*$)`,
  "i"
);

const CHAPTER_TITLE = new RegExp(
  `^${CHAPTER_WORDS}\\s*${CHAPTER_NUMBER}[.:)\\-\\s]*(.*)$`,
  "i"
);

export function splitIntoChapters(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const chapters = [];
  let current = { title: "Beginning", lines: [] };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && CHAPTER_LINE.test(trimmed)) {
      if (current.lines.length) chapters.push(finishChapter(current));
      const m = trimmed.match(CHAPTER_TITLE);
      current = {
        title: m?.[1]?.trim() || trimmed.slice(0, 80),
        lines: [],
      };
      continue;
    }
    current.lines.push(line);
  }
  if (current.lines.length) chapters.push(finishChapter(current));
  return chapters.length ? chapters : [{ title: "Full text", body: text.trim() }];
}

function finishChapter(ch) {
  return {
    title: ch.title,
    body: ch.lines.join("\n").trim(),
  };
}

export function buildChapterIndex(queue) {
  const chapters = [];
  let lastChapter = -1;
  queue.forEach((chunk, index) => {
    const ci = chunk.chapterIndex ?? 0;
    if (ci !== lastChapter) {
      chapters.push({
        title: chunk.chapterTitle || `Chapter ${chapters.length + 1}`,
        chapterIndex: ci,
        startChunk: index,
        endChunk: index,
      });
      lastChapter = ci;
    } else {
      chapters[chapters.length - 1].endChunk = index;
    }
  });
  return chapters;
}

export function chunkIndexForChapter(chapterIndex, queue) {
  const i = queue.findIndex((c) => (c.chapterIndex ?? 0) === chapterIndex);
  return i >= 0 ? i : 0;
}
