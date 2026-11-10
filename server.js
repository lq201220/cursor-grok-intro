const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = 8765;
const ROOT = __dirname;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

function loadMaasKey() {
  try {
    const text = fs.readFileSync(path.join(ROOT, "config.local.js"), "utf8");
    const match = text.match(/key:\s*"([^"]+)"/);
    if (match) return match[1];
  } catch (e) {}
  return process.env.MAAS_API_KEY || "";
}

function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8" });
  res.end(body);
}

function proxyMaas(req, res, body) {
  const key = loadMaasKey();
  if (!key) {
    send(res, 500, JSON.stringify({ error: { message: "本机未配置华为云密钥" } }), "application/json");
    return;
  }
  const payload = Buffer.from(body || "{}");
  const upstream = https.request(
    {
      hostname: "api.modelarts-maas.com",
      path: "/openai/v1/chat/completions",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
        "Content-Length": payload.length
      }
    },
    (up) => {
      const chunks = [];
      up.on("data", (c) => chunks.push(c));
      up.on("end", () => {
        res.writeHead(up.statusCode || 502, { "Content-Type": "application/json; charset=utf-8" });
        res.end(Buffer.concat(chunks));
      });
    }
  );
  upstream.on("error", (err) => {
    send(res, 502, JSON.stringify({ error: { message: err.message } }), "application/json");
  });
  upstream.write(payload);
  upstream.end();
}

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || "/").split("?")[0]);
  if (req.method === "POST" && url === "/api/maas") {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => proxyMaas(req, res, Buffer.concat(chunks).toString("utf8")));
    return;
  }
  const file = path.join(ROOT, url === "/" ? "index.html" : url.replace(/^\//, ""));
  if (!file.startsWith(ROOT)) {
    send(res, 403, "forbidden");
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      send(res, 404, "not found");
      return;
    }
    send(res, 200, data, MIME[path.extname(file).toLowerCase()] || "application/octet-stream");
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("listening http://127.0.0.1:" + PORT);
});
