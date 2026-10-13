// The reasoning layer: one photo + one-liner in, the app's JSON out.
// Runs on the server only, so the Groq key never reaches the browser.
import { readFileSync } from "node:fs";

const PROMPT = readFileSync(new URL("./prompt.txt", import.meta.url), "utf8");

const BASE = (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, "");
const MODEL = process.env.GROQ_MODEL || "qwen/qwen3.8-27b";
const EFFORT = process.env.GROQ_REASONING_EFFORT ?? "low";   // "" to leave it out
const MAX_IMAGE_BYTES = 4_000_000;                            // after base64; the page sends ~300KB
const ROLES = ["background", "surface", "text", "primary", "primary_label", "accent"];
const HEX = /^#[0-9a-f]{6}$/i;

export class GenError extends Error {
  constructor(code, status, detail) { super(code); this.code = code; this.status = status; this.detail = detail; }
}

/** Check what the page sent. Only the one-liner and the photo come from the client: the prompt lives here. */
export function readInput(body) {
  const one = typeof body?.one_liner === "string" ? body.one_liner.trim().slice(0, 200) : "";
  const image = body?.image;
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image))
    throw new GenError("bad_image", 400);
  if (image.length > MAX_IMAGE_BYTES) throw new GenError("image_too_large", 413);
  return { one, image };
}

/** Is this the shape the app expects? (The page re-checks and repairs details such as contrast.) */
function looksValid(d) {
  return d && typeof d === "object"
    && ["app", "website", "poster", "story"].includes(d.preview?.type)
    && Array.isArray(d.looks) && d.looks.length === 5
    && d.looks.every(L => ROLES.every(k => HEX.test(L?.colors?.[k] || "")))
    && Array.isArray(d.font_pairs) && d.font_pairs.length >= 4;
}

async function callGroq(prompt, image, { effort, signal }) {
  const body = {
    model: MODEL,
    messages: [{ role: "user", content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: image } },
    ] }],
    response_format: { type: "json_object" },
    reasoning_format: "hidden",              // JSON mode needs "hidden" or "parsed"; we only want the answer
    temperature: 0.6,
    top_p: 0.95,
    max_completion_tokens: 4000,
  };
  if (effort) body.reasoning_effort = effort;
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify(body),
    signal,
  });
  const text = await res.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  if (!res.ok) {
    const msg = j?.error?.message || text.slice(0, 300);
    if (res.status === 429) throw new GenError("rate_limited", 429, msg);
    if (res.status === 400 && /json_validate_failed|failed to generate json/i.test(j?.error?.code + " " + msg))
      throw new GenError("invalid_json", 502, msg);
    if (res.status === 400 && effort && /reasoning_effort/i.test(msg))
      throw new GenError("effort_unsupported", 400, msg);
    throw new GenError("upstream", 502, `${res.status} ${msg}`);
  }
  const content = j?.choices?.[0]?.message?.content || "";
  try { return JSON.parse(content.replace(/^\s*```(?:json)?|```\s*$/g, "")); }
  catch { throw new GenError("invalid_json", 502, content.slice(0, 300)); }
}

/* When the AI's colours will need a readability repair in the page, log the colours only (no photo, no brief, no text),
   so live cases can be diagnosed in Vercel's logs. */
const lum = h => { const [r, g, b] = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * r + .7152 * g + .0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + .05) / (y + .05); };
export function repairFlags(d) {
  return (d.looks || []).map((L, i) => {
    const c = L.colors, f = [];
    if ((lum(c.background) < .125) !== (lum(c.surface) < .125)) f.push("page_and_cards_opposite");
    if (ratio(c.text, c.background) < 4.5) f.push("text_on_page");
    if (ratio(c.text, c.surface) < 4.5) f.push("text_on_cards");
    if (ratio(c.primary_label, c.primary) < 4.5) f.push("button_label");
    if (ratio(c.accent, c.background) < 3) f.push("highlight_on_page");
    return f.length ? { look: i + 1, flags: f, colors: c } : null;
  }).filter(Boolean);
}

/** Ask Groq, and try once more if the answer isn't usable JSON. */
export async function generate({ one, image }, { signal } = {}) {
  if (!process.env.GROQ_API_KEY) throw new GenError("not_configured", 500, "GROQ_API_KEY is not set");
  const prompt = PROMPT.replace("{one_liner}", one);
  let effort = EFFORT || null, last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const d = await callGroq(prompt, image, { effort, signal });
      if (looksValid(d)) {
        try { const r = repairFlags(d); if (r.length) console.log("[colours needing repair]", JSON.stringify({ model: MODEL, looks: r })); } catch {}
        return d;
      }
      last = new GenError("invalid_json", 502, "answer was JSON but not the expected shape");
    } catch (e) {
      if (e.code === "effort_unsupported") { effort = null; continue; }   // older/newer models: drop the knob and retry
      if (e.code !== "invalid_json") throw e;
      last = e;
    }
    if (attempt >= 1) break;                                             // at most one retry for a bad answer
  }
  throw last;
}

/** Best-effort limit per visitor, per warm server instance. Groq's own limits still apply. */
const hits = new Map();
export function allow(ip, perMinute = Number(process.env.RATE_PER_MINUTE || 6)) {
  const now = Date.now(), list = (hits.get(ip) || []).filter(t => now - t < 60_000);
  if (list.length >= perMinute) { hits.set(ip, list); return false; }
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return true;
}
