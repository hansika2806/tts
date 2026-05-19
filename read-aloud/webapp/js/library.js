import { createBookId, idbDeleteBook, idbGetAllBooks, idbGetBook, idbPutBook } from "./idb.js";
import { extractTextFromEpub } from "./epub.js";

export function createEmptyBook(overrides = {}) {
  return {
    id: createBookId(),
    title: "Untitled",
    type: "txt",
    addedAt: Date.now(),
    text: "",
    progress: { chunkIndex: 0, chapterIndex: 0 },
    bookmarks: [],
    pronunciations: {},
    chapters: [],
    author: "",
    epubBlob: null,
    pdfBlob: null,
    ...overrides,
  };
}

export async function listBooks() {
  const books = await idbGetAllBooks();
  return books.sort((a, b) => (b.lastOpenedAt || b.addedAt) - (a.lastOpenedAt || a.addedAt));
}

export async function saveBook(book) {
  return idbPutBook(book);
}

export async function loadBook(id) {
  return idbGetBook(id);
}

export async function removeBook(id) {
  return idbDeleteBook(id);
}

export async function importTxtFile(file) {
  const text = await file.text();
  const book = createEmptyBook({
    title: file.name.replace(/\.[^.]+$/, ""),
    type: "txt",
    text,
  });
  await saveBook(book);
  return book;
}

export async function importEpubFile(file) {
  const { title, author, chapters, text } = await extractTextFromEpub(file);
  const book = createEmptyBook({
    title,
    author,
    chapters,
    type: "epub",
    text,
    epubBlob: file,
  });
  await saveBook(book);
  return book;
}

export async function importPdfFile(file) {
  const book = createEmptyBook({
    title: file.name.replace(/\.[^.]+$/, ""),
    type: "pdf",
    pdfBlob: file,
    text: "",
  });
  await saveBook(book);
  return book;
}

export async function importFromUrl(url) {
  const sourceUrl = normalizeImportUrl(url);
  const res = await fetch(sourceUrl);
  if (!res.ok) throw new Error(`Could not fetch URL (${res.status})`);
  const text = await res.text();
  const title = tryTitleFromHtml(text) || sourceUrl.split("/").pop() || "Web import";
  const book = createEmptyBook({
    title: title.slice(0, 120),
    type: "url",
    text: htmlToPlain(text),
    sourceUrl,
  });
  await saveBook(book);
  return book;
}

function normalizeImportUrl(url) {
  const trimmed = String(url || "").trim();
  if (!trimmed) throw new Error("Paste a URL first.");
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(withProtocol);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs can be imported.");
  }
  return parsed.href;
}

function tryTitleFromHtml(html) {
  return html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
}

function htmlToPlain(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, nav, footer").forEach((n) => n.remove());
  return (doc.body?.textContent || "").replace(/\s+/g, " ").trim();
}

export function progressPercent(book, totalChunks) {
  if (!totalChunks) return 0;
  const idx = book?.progress?.chunkIndex ?? 0;
  return Math.min(100, Math.round(((idx + 1) / totalChunks) * 100));
}
