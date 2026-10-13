# shades of you (hosted, Groq)

Turn a photo you love into brand colours and fonts.

This version runs on your own hosting. The photo and one-liner are read by **Groq** (`qwen/qwen3.8-27b`, its vision model). Before, they were read by Claude.

## How it fits together

```
browser (public/index.html)
  └─ POST /api/generate  { one_liner, image }      ← photo shrunk to 1280px JPEG first
        └─ lib/groq.js  → Groq chat completions     ← key + prompt live here, never in the page
              model: qwen/qwen3.8-27b, JSON mode, reasoning hidden
        ← the same JSON the app always used (preview, 5 looks, 8 font pairs)
```

- `lib/prompt.txt` is the in-app prompt, unchanged.
- The server only accepts a one-liner of up to 200 characters and a photo. So nobody can use your key to ask Groq other things.
- If Groq returns invalid JSON or the wrong shape, the server asks once more.
- Each visitor is limited to 6 requests a minute. This is a best-effort limit, and Groq's own limits still apply.

## Your key

The key never goes in the page or in git.

| Where | How |
| --- | --- |
| On your computer | Copy `.env.example` to `.env` and paste your key after `GROQ_API_KEY=`. `.env` is git-ignored. |
| On Vercel | Go to Project → Settings → Environment Variables and add `GROQ_API_KEY`. |

Create a key at https://console.groq.com/keys

## Run it locally

Needs Node 22 or later.

```
cp .env.example .env      # then add your key
npm run dev               # http://localhost:3000
```

## Deploy to Vercel

1. Push this folder to a GitHub repo, then import it at vercel.com/new. You don't need a framework preset or a build command. `public/` is served as-is, and `api/generate.js` becomes the function.
2. Add `GROQ_API_KEY` under Environment Variables, then deploy.

Or from the terminal: `npx vercel`, then `npx vercel env add GROQ_API_KEY`, then `npx vercel --prod`.

## Settings (all optional)

| Variable | Default | What it does |
| --- | --- | --- |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | Swap the model without touching code. It must accept images and JSON mode. |
| `GROQ_REASONING_EFFORT` | `low` | Use `none` for faster answers, `medium` for more careful colour checks, or empty to leave it out. |
| `RATE_PER_MINUTE` | `6` | Requests allowed per visitor per minute. |

Note: on Groq, `qwen/qwen3.8-27b` is a **preview** model, which Groq says may be withdrawn at short notice. If that happens, set `GROQ_MODEL` to Groq's current vision model.

## Readability test

Every piece of text the 4 previews draw (which the brand sheet also uses) must meet WCAG AA against what it actually sits on. The test covers every look, every font pair, the built-in example and a set of tricky colour answers in `tests/fixtures.json`. It runs on every push (GitHub Actions → "Readability"), or locally:

```
npm i --no-save playwright@1.56.0 && npx playwright install chromium
node tests/readability.mjs
```

When the AI's colours need a repair, the server logs the colour values only (no photo, no brief) under `[colours needing repair]` in Vercel's logs.
