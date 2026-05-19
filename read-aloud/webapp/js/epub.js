/**
 * Lightweight EPUB to plain text (spine order).
 * Keeps parsing local so EPUB import still works when CDN modules are blocked.
 */

export async function extractTextFromEpub(file) {
  const zip = await openZip(await file.arrayBuffer());

  const containerXml = await readZipText(zip, "META-INF/container.xml");
  const containerDoc = parseXml(containerXml, "container.xml");
  const rootPath = containerDoc.querySelector("rootfile")?.getAttribute("full-path");
  if (!rootPath) throw new Error("Invalid EPUB: no rootfile");

  const opf = await readZipText(zip, rootPath);
  const opfDoc = parseXml(opf, rootPath);
  const opfDir = rootPath.includes("/") ? rootPath.replace(/[^/]+$/, "") : "";

  const manifest = {};
  opfDoc.querySelectorAll("manifest > item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifest[id] = resolvePath(opfDir, href);
  });

  const spineIds = [];
  opfDoc.querySelectorAll("spine > itemref").forEach((item) => {
    const idref = item.getAttribute("idref");
    if (idref && item.getAttribute("linear") !== "no") spineIds.push(idref);
  });

  const title =
    metadataText(opfDoc, "title") ||
    file.name.replace(/\.[^.]+$/, "");
  const author = metadataText(opfDoc, "creator");

  const parts = [];
  const chapters = [];
  for (const id of spineIds) {
    const href = manifest[id];
    if (!href) continue;
    const html = await readZipText(zip, href);
    const chapter = htmlToChapter(html, href);
    if (!chapter.text) continue;
    chapters.push(chapter);
    parts.push(`${chapter.title}\n\n${chapter.text}`);
  }

  const text = parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("EPUB imported, but no readable text was found.");

  return {
    title,
    author,
    chapters,
    text,
  };
}

async function readZipText(zip, path) {
  const text = await zip.readText(path);
  if (text == null) throw new Error(`EPUB missing file: ${path}`);
  return text;
}

async function openZip(buffer) {
  const view = new DataView(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  if (eocdOffset < 0) throw new Error("Invalid EPUB: ZIP directory not found");

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map();
  let offset = centralDirOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error("Invalid EPUB: corrupted ZIP directory");
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const rawName = new Uint8Array(buffer, offset + 46, nameLength);
    const name = new TextDecoder("utf-8").decode(rawName);

    entries.set(normalizeZipPath(name), {
      method,
      compressedSize,
      uncompressedSize,
      localOffset,
    });

    offset += 46 + nameLength + extraLength + commentLength;
  }

  return {
    async readText(path) {
      const entry = entries.get(normalizeZipPath(path));
      if (!entry) return null;
      const bytes = await readZipEntry(buffer, view, entry);
      return new TextDecoder("utf-8").decode(bytes);
    },
  };
}

function findEndOfCentralDirectory(view) {
  const min = Math.max(0, view.byteLength - 0xffff - 22);
  for (let i = view.byteLength - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) return i;
  }
  return -1;
}

async function readZipEntry(buffer, view, entry) {
  const offset = entry.localOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) {
    throw new Error("Invalid EPUB: corrupted ZIP entry");
  }

  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const dataOffset = offset + 30 + nameLength + extraLength;
  const compressed = new Uint8Array(buffer, dataOffset, entry.compressedSize);

  if (entry.method === 0) return compressed;
  if (entry.method !== 8) {
    throw new Error("Unsupported EPUB compression method");
  }
  if (!("DecompressionStream" in globalThis)) {
    throw new Error("This browser cannot decompress EPUB files. Try the latest Chrome or Edge.");
  }

  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
  if (entry.uncompressedSize && inflated.length !== entry.uncompressedSize) {
    console.warn("EPUB entry size mismatch; continuing with decoded text.");
  }
  return inflated;
}

function normalizeZipPath(path) {
  const clean = String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
  try {
    return decodeURIComponent(clean);
  } catch {
    return clean;
  }
}

function resolvePath(base, href) {
  const path = href.split("#")[0];
  if (!base) return normalizeRelativePath(path);
  if (path.startsWith("/")) return normalizeRelativePath(path.slice(1));
  return normalizeRelativePath(base + path);
}

function normalizeRelativePath(path) {
  const parts = [];
  for (const part of String(path || "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function parseXml(xml, label) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const error = doc.querySelector("parsererror");
  if (error) throw new Error(`Invalid EPUB XML: ${label}`);
  return doc;
}

function metadataText(doc, localName) {
  const direct = Array.from(doc.getElementsByTagName("*")).find(
    (node) => node.localName?.toLowerCase() === localName
  );
  return direct?.textContent?.replace(/\s+/g, " ").trim() || "";
}

function htmlToChapter(html, href) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script, style, nav, noscript, [hidden]").forEach((n) => n.remove());

  const title =
    doc.body?.querySelector("h1, h2, h3")?.textContent?.replace(/\s+/g, " ").trim() ||
    doc.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim() ||
    titleFromHref(href);

  const blocks = [];
  collectBlocks(doc.body || doc.documentElement, blocks);
  while (blocks[0] && normalizeText(blocks[0]) === normalizeText(title)) {
    blocks.shift();
  }

  return {
    href,
    title,
    text: blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim(),
  };
}

function collectBlocks(root, blocks) {
  const blockSelector = "h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,div,section,article";
  const candidates = Array.from(root.querySelectorAll(blockSelector));
  const leaves = candidates.filter((node) => !node.querySelector(blockSelector));

  for (const node of leaves) {
    const text = node.textContent?.replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) continue;
    const last = blocks[blocks.length - 1];
    if (last !== text) blocks.push(text);
  }

  if (!blocks.length) {
    const fallback = root.textContent?.replace(/\s+/g, " ").trim();
    if (fallback) blocks.push(fallback);
  }
}

function titleFromHref(href) {
  const name = String(href || "")
    .split("/")
    .pop()
    ?.replace(/\.[^.]+$/, "")
    ?.replace(/[_-]+/g, " ")
    ?.trim();
  return name || "Chapter";
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim().toLowerCase();
}
