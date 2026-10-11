// Local preview without Vercel: put GROQ_API_KEY in .env, then  npm run dev  ->  http://localhost:3000
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { handle } from "./lib/handler.js";

const PORT = Number(process.env.PORT || 3000);
const ROOT = new URL("./public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/generate") {
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 5_000_000) { res.writeHead(413).end(); return; } chunks.push(c); }
    let body = null; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
    return handle(req, body, (s, j) => { if (!res.headersSent) { res.writeHead(s, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(j)); } });
  }
  const path = normalize(join(ROOT, url.pathname === "/" ? "index.html" : url.pathname));
  if (!path.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try { const f = await readFile(path); res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream" }); res.end(f); }
  catch { res.writeHead(404).end("Not found"); }
}).listen(PORT, () => console.log(`shades of you on http://localhost:${PORT}${process.env.GROQ_API_KEY ? "" : "  (GROQ_API_KEY not set)"}`));
