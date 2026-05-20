/** Tracks which book type is active so PDF/EPUB UI do not leak into each other. */

let activeBookType = null;

export function setActiveBookType(type) {
  activeBookType = type || null;
}

export function getActiveBookType() {
  return activeBookType;
}

export function isPdfSession() {
  return activeBookType === "pdf";
}

export function isEpubLikeSession() {
  return activeBookType === "epub" || activeBookType === "txt";
}
