// Readability test: every piece of text the 4 previews draw (also used by the brand sheet) must meet WCAG AA
// against what it actually sits on — for every look, every font pair, the built-in example and the tricky fixtures.
//   npm i --no-save playwright && npx playwright install chromium && node tests/readability.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const page_html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const fixtures = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url), "utf8"));
const sets = { example: null, socks: fixtures.socks, perfume: fixtures.perfume, tricky: fixtures.tricky };

const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push(String(e)));
await page.route("https://fonts.**", r => r.fulfill({ status: 200, body: "" }));     // offline and repeatable
await page.setContent(page_html);

let pairs = 0, looks = 0;
const failures = [];
for (const [name, data] of Object.entries(sets)) {
  const res = await page.evaluate(d => {
    // Independent of the app's own readability(): find what each text sits on, blend any transparency, apply WCAG AA.
    const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const blend = (fg, bg, a) => "#" + hex(fg).map((v, i) => Math.round(v * a + hex(bg)[i] * (1 - a)).toString(16).padStart(2, "0")).join("");
    const r = readResult(d || EXAMPLE);
    APP.preview = r.preview; APP.looks = r.looks; APP.pairs = r.pairs;
    const out = []; let drawn = 0, disagree = 0;
    r.looks.forEach((L, li) => r.pairs.forEach(FP => {
      let mine = 0;
      for (const [type] of TYPES) {
        const P = buildPreview(type, L, APP.preview, FP).P;
        P.forEach((q, i) => { if (q.t !== "t") return; drawn++;
          const cx = q.x + Math.min(q.w, measure(q.s, q.font, q.ls || 0)) / 2, cy = q.y + q.h / 2; let bg = L.c.background;
          for (let j = i - 1; j >= 0; j--) { const b = P[j];
            const inside = cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h;
            if (b.t === "r" && !b.stroke && (b.a ?? 1) >= .99 && inside) { bg = b.fill; break; }
            if (b.t === "art" && inside) { bg = b.ground; break; } }
          const col = (q.a ?? 1) < 1 ? blend(q.col, bg, q.a) : q.col, m = q.font.match(/^(\d+) ([\d.]+)px/);
          const need = (+m[2] >= 24 || (+m[2] >= 18.66 && +m[1] >= 700)) ? 3 : 4.5, cr = ratio(col, bg);
          if (cr < need) { mine++; out.push({ look: `${li + 1} ${L.name}`, pair: FP.heading, type, s: q.s, col, bg, r: +cr.toFixed(2) }); }
        });
      }
      if (typeof readability === "function" && (readability(L, FP).length > 0) !== (mine > 0)) disagree++;   // the app's own check must agree
    }));
    return { out, drawn, n: r.looks.length, disagree };
  }, data);
  if (res.disagree) failures.push({ set: name, look: "-", pair: "-", type: "-", s: `app's readability() disagreed ${res.disagree}x`, col: "", bg: "", r: 0 });
  pairs += res.drawn; looks += res.n;
  failures.push(...res.out.map(f => ({ set: name, ...f })));
}
await browser.close();

console.log(`${looks} looks x ${8} font pairs x 4 previews: ${pairs} drawn text pairs checked`);
if (errors.length) { console.error("page errors:", errors); process.exit(1); }
if (failures.length) {
  console.error(`${failures.length} below WCAG AA:`);
  for (const f of failures.slice(0, 20)) console.error(`  ${f.set}/${f.look} [${f.pair}] ${f.type}: "${f.s}" ${f.col} on ${f.bg} = ${f.r}:1`);
  process.exit(1);
}
console.log("All text meets WCAG AA.");
