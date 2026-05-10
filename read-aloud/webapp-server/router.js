const fs = require("fs");
const path = require("path");
const contentTypes = require("./content-types");
const googleTranslate = require("./google-translate");

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
