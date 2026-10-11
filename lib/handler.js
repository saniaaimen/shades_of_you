// One request handler for both Vercel (api/generate.js) and the local dev server.
import { readInput, generate, allow, GenError } from "./groq.js";

const MESSAGES = {
  rate_limited: "Too many requests right now. Try again in a minute.",
  bad_image: "That photo couldn't be read.",
  image_too_large: "That photo is too large.",
  not_configured: "The server has no Groq key yet.",
};

export async function handle(req, body, send) {
  if (req.method !== "POST") return send(405, { error: "method_not_allowed" });
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "?").split(",")[0].trim();
  if (!allow(ip)) return send(429, { error: "rate_limited", message: MESSAGES.rate_limited });
  try {
    const input = readInput(body);
    const ctl = new AbortController();
    req.socket?.once?.("close", () => ctl.abort());          // visitor pressed Stop or left: stop paying for tokens
    const data = await generate(input, { signal: ctl.signal });
    return send(200, data);
  } catch (e) {
    if (e?.name === "AbortError") return send(499, { error: "cancelled" });
    const code = e instanceof GenError ? e.code : "server_error";
    if (!(e instanceof GenError) || e.status >= 500) console.error("[generate]", code, e?.detail || e);
    return send(e?.status || 500, { error: code, message: MESSAGES[code] || "Something went wrong." });
  }
}
