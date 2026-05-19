const fs = require("fs");
const path = require("path");
const contentTypes = require("./content-types");
const googleTranslate = require("./google-translate");

const pdfUploads = new Map();
const MAX_PDF_UPLOAD_BYTES = 80 * 1024 * 1024;

async function handleRequest(req, res, rootDir, fallbackOrigin) {
  const url = new URL(req.url, fallbackOrigin);

  if (url.pathname === "/api/google-translate/voices" && req.method === "GET") {
    return sendJson(res, 200, await googleTranslate.getVoices());
  }

  if (url.pathname === "/api/google-translate/speak" && req.method === "POST") {
    const body = await readJson(req);
    const audio = await googleTranslate.synthesizeSpeech(body.text, body.lang);
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    });
    res.end(audio);
    return;
  }

  if (url.pathname === "/api/pdf-upload" && req.method === "POST") {
    const pdf = await readBuffer(req, MAX_PDF_UPLOAD_BYTES);
    if (!pdf.length) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Empty PDF upload" }));
      return;
    }
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    pdfUploads.set(id, {
      data: pdf,
      expiresAt: Date.now() + 60 * 60 * 1000,
    });
    prunePdfUploads();
    return sendJson(res, 200, { url: `/api/pdf-file/${id}` });
  }

  if (url.pathname.startsWith("/api/pdf-file/") && req.method === "GET") {
    prunePdfUploads();
    const id = url.pathname.slice("/api/pdf-file/".length);
    const entry = pdfUploads.get(id);
    if (!entry) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("PDF not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": "application/pdf",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": fallbackOrigin,
    });
    res.end(entry.data);
    return;
  }

  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/webapp/index.html";

  const normalized = path.normalize(path.join(rootDir, pathname));
  if (!normalized.startsWith(rootDir)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(normalized, (statErr, stats) => {
    if (statErr) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const filePath = stats.isDirectory() ? path.join(normalized, "index.html") : normalized;
    fs.readFile(filePath, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }

      const ext = path.extname(filePath).toLowerCase();
      res.writeHead(200, {
        "Content-Type": contentTypes[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      res.end(data);
    });
  });
}

function prunePdfUploads() {
  const now = Date.now();
  for (const [id, entry] of pdfUploads) {
    if (entry.expiresAt <= now) pdfUploads.delete(id);
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function readBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("PDF upload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

module.exports = {
  handleRequest,
};
