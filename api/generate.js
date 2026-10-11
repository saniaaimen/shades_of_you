// Vercel serverless function: POST /api/generate  { one_liner, image (data URL) }  ->  the looks JSON
import { handle } from "../lib/handler.js";

export const config = { maxDuration: 60 };

export default async function (req, res) {
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  await handle(req, body, (status, json) => res.status(status).setHeader("cache-control", "no-store").json(json));
}
