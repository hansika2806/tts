const http = require("http");
const { handleRequest } = require("./webapp-server/router");

const rootDir = __dirname;
const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);

http
  .createServer((req, res) => {
    handleRequest(req, res, rootDir, `http://${req.headers.host || `${host}:${port}`}`)
      .catch((error) => {
        console.error(error);
        res.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ error: error.message }));
      });
  })
  .listen(port, host, () => {
    console.log(`Standalone Read Aloud webapp available at http://${host}:${port}`);
  });
