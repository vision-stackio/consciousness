import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./env.js";
import { loadLLMConfig, isConfigured } from "./llm.js";
import { think } from "./cortex.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnv(path.join(root, ".env"));

const cfg = loadLLMConfig(process.env);
const PORT = Number(process.env.PORT ?? 8787);
const MAX_THINKS = Number(process.env.MAX_THINKS_PER_MINUTE ?? 12);
const CLIENT_DIR = path.join(root, "client");
const LOG_FILE = path.join(root, "data", "mind-log.jsonl");
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".obj": "text/plain; charset=utf-8", ".ico": "image/x-icon",
};

const hits = new Map<string, number[]>();
function rateLimited(ip: string) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60000);
  list.push(now); hits.set(ip, list);
  return list.length > MAX_THINKS;
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage, limit = 700_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => { size += c.length; if (size > limit) { reject(new Error("payload too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    // "//" or other odd paths must never reach the URL parser as a protocol-relative URL (that threw a 500)
    const url = new URL((req.url ?? "/").replace(/^\/{2,}/, "/"), "http://localhost");

    if (url.pathname === "/api/health") {
      return send(res, 200, { llm: { configured: isConfigured(cfg), provider: cfg.provider, model: cfg.model, vision: cfg.vision }, limits: { thinksPerMinute: MAX_THINKS } });
    }

    if (url.pathname === "/api/think" && req.method === "POST") {
      if (!isConfigured(cfg)) return send(res, 503, { error: "no LLM configured (set a key in .env)" });
      if (rateLimited(req.socket.remoteAddress ?? "local")) return send(res, 429, { error: "thinking too fast (rate limit)" });
      const body = JSON.parse(await readBody(req));
      const frame = typeof body.frame === "string" && body.frame.length < 400_000 ? body.frame : null;
      const decision = await think(cfg, body.request, frame);
      fs.appendFile(LOG_FILE, JSON.stringify({ t: new Date().toISOString(), mood: body.request?.state?.mood, heard: body.request?.heard, sawImage: !!frame, decision }) + "\n", () => {});
      return send(res, 200, { decision });
    }

    // static files (client/ only, no path traversal)
    let rel = decodeURIComponent(url.pathname);
    if (rel === "/") rel = "/index.html";
    const file = path.normalize(path.join(CLIENT_DIR, rel));
    if (!file.startsWith(CLIENT_DIR + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end("not found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(file)] ?? "application/octet-stream", "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    if (e instanceof URIError) return send(res, 400, { error: "bad request path" });
    send(res, 500, { error: (e as Error).message });
  }
});

server.listen(PORT, () => {
  console.log(`\n  Vision consciousness sandbox  ->  http://localhost:${PORT}`);
  console.log(`  AI mind: ${isConfigured(cfg) ? `${cfg.provider} / ${cfg.model}` : "not configured (local mind still works)"}\n`);
});
