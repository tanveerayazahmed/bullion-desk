// Runs on GitHub's servers. Two kinds of source:
//
//   API sources    — plain HTTP, fast, reliable. Gold/silver spot, FX, Brent.
//   Scrape sources — headless Chrome, slow, fragile. Islamicly, Dar Al Sabaek.
//
// Every value carries its own status. A source that fails writes null and says
// why; it NEVER inherits a previous value silently. Staleness is visible.
//
// Writes docs/prices.json (latest) and docs/history.json (one row per day).

import { readFile, writeFile, mkdir } from "node:fs/promises";

const OUT = "docs/prices.json";
const HIST = "docs/history.json";
const OZ = 31.1034768;

// A scraped local price must land within this band of the spot-implied price,
// otherwise we assume the scraper broke and reject the value.
// Local retail sits above spot (duty, GST, margin) but not far above, and never
// below by much. An asymmetric band is tighter than a symmetric one and, being
// tighter on the downside, rejects a 22K price masquerading as 24K (22K is
// 91.6% of 24K = -8.4%, outside the -6% floor).
const BAND_LO = 0.94;   // reject below 94% of spot-implied
const BAND_HI = 1.30;   // reject above 130% of spot-implied

const out = {
  updated: new Date().toISOString(),
  status: {},                   // per source: "ok" | "failed: …" | "skipped: …"
  usAu: null, usAg: null,       // spot, USD/oz
  usdInr: null, usdKwd: null,   // FX
  oil: null,                    // Brent, USD/bbl
  inAu: null, inAg: null,       // India, INR/gram   (scraped)
  kwAu: null, kwAg: null,       // Kuwait, KWD/gram  (scraped)
};

function mark(key, msg) {
  out.status[key] = msg;
  console.log(`${key}: ${msg}`);
}

/* ------------------------------------------------------------------ */
/* API sources                                                         */
/* ------------------------------------------------------------------ */

async function json(url) {
  const r = await fetch(url, {
    headers: { "user-agent": "bullion-desk price fetcher" },
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

async function apiMetals() {
  const [au, ag] = await Promise.all([
    json("https://api.gold-api.com/price/XAU"),
    json("https://api.gold-api.com/price/XAG"),
  ]);
  if (!au?.price || !ag?.price) throw new Error("missing price field");
  out.usAu = au.price;
  out.usAg = ag.price;
}

async function apiFx() {
  const d = await json("https://open.er-api.com/v6/latest/USD");
  if (!d?.rates?.INR || !d?.rates?.KWD) throw new Error("missing rates");
  out.usdInr = d.rates.INR;
  out.usdKwd = d.rates.KWD;
}

async function apiBrent() {
  const d = await json(
    "https://query1.finance.yahoo.com/v8/finance/chart/BZ=F?interval=1d&range=1d"
  );
  const p = d?.chart?.result?.[0]?.meta?.regularMarketPrice;
  if (typeof p !== "number") throw new Error("no price in response");
  out.oil = p;
}

/* ------------------------------------------------------------------ */
/* Scrape sources — headless Chrome                                    */
/* ------------------------------------------------------------------ */

// Pull every plausible number out of the rendered page text, then pick the one
// closest to what spot implies. A redesign moves elements around, but the right
// number stays near spot — this survives layout changes that a CSS selector
// would not.
function pickNearest(text, expected, lo, hi) {
  const nums = (text.match(/[\d][\d,]*\.?\d*/g) || [])
    .map((s) => parseFloat(s.replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n >= lo && n <= hi);
  if (!nums.length) return null;
  return nums.reduce((best, n) =>
    Math.abs(n - expected) < Math.abs(best - expected) ? n : best
  );
}

async function scrape(browser, { key, url, expected, settle }) {
  if (expected == null) {
    mark(key, "skipped: no spot reference to validate against");
    return null;
  }
  const lo = expected * BAND_LO;
  const hi = expected * BAND_HI;

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  });
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });

    // Wait until a number in the plausible band actually appears on screen.
    await page.waitForFunction(
      ([l, h]) => {
        const t = document.body.innerText;
        if (t.includes("{{")) return false;            // template not rendered
        return (t.match(/[\d][\d,]*\.?\d*/g) || []).some((s) => {
          const n = parseFloat(s.replace(/,/g, ""));
          return n >= l && n <= h;
        });
      },
      [lo, hi],
      { timeout: 30000 }
    );

    if (settle) await page.waitForTimeout(settle);
    const text = await page.innerText("body");
    const val = pickNearest(text, expected, lo, hi);

    if (val == null) {
      mark(key, "failed: no number in plausible range on rendered page");
      return null;
    }
    const drift = ((val - expected) / expected) * 100;
    mark(key, `ok (${drift >= 0 ? "+" : ""}${drift.toFixed(1)}% vs spot-implied)`);
    return val;
  } catch (e) {
    mark(key, `failed: ${String(e.message).split("\n")[0].slice(0, 90)}`);
    return null;
  } finally {
    await page.close().catch(() => {});
  }
}

async function runScrapes() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    mark("scraper", "failed: playwright not installed");
    return;
  }

  // Spot-implied local prices — the reference every scrape is validated against.
  const impliedInAu = out.usAu && out.usdInr ? (out.usAu / OZ) * out.usdInr : null;
  const impliedInAg = out.usAg && out.usdInr ? (out.usAg / OZ) * out.usdInr : null;
  const impliedKwAu = out.usAu && out.usdKwd ? (out.usAu / OZ) * out.usdKwd : null;
  const impliedKwAg = out.usAg && out.usdKwd ? (out.usAg / OZ) * out.usdKwd : null;

  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    out.inAu = await scrape(browser, {
      key: "islamicly_gold",
      url: "https://www.islamicly.com/home/gold",
      expected: impliedInAu,
    });
    out.inAg = await scrape(browser, {
      key: "islamicly_silver",
      url: "https://www.islamicly.com/home/silver",
      expected: impliedInAg,
    });
    out.kwAu = await scrape(browser, {
      key: "daralsabaek_gold",
      url: "https://daralsabaek.com/",
      expected: impliedKwAu,
      settle: 3000,
    });
    out.kwAg = await scrape(browser, {
      key: "daralsabaek_silver",
      url: "https://daralsabaek.com/",
      expected: impliedKwAg,
      settle: 3000,
    });
  } finally {
    await browser.close().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Run                                                                 */
/* ------------------------------------------------------------------ */

for (const [key, fn] of [
  ["metals", apiMetals],
  ["fx", apiFx],
  ["brent", apiBrent],
]) {
  try {
    await fn();
    mark(key, "ok");
  } catch (e) {
    mark(key, `failed: ${e.message}`);
  }
}

await runScrapes();

/* ------------------------------------------------------------------ */
/* Carry forward — explicitly, never silently                          */
/* ------------------------------------------------------------------ */

let prev = null;
try {
  prev = JSON.parse(await readFile(OUT, "utf8"));
} catch {}

if (prev) {
  const ageH = prev.updated
    ? (Date.now() - new Date(prev.updated).getTime()) / 3.6e6
    : Infinity;
  for (const k of ["usAu","usAg","usdInr","usdKwd","oil","inAu","inAg","kwAu","kwAg"]) {
    if (out[k] == null && prev[k] != null && ageH < 48) {
      out[k] = prev[k];
      out.status[k + "_carried"] = `from ${prev.updated} (${ageH.toFixed(1)}h old)`;
    }
  }
}

/* history — one row per UTC day, last write wins */
let hist = [];
try {
  hist = JSON.parse(await readFile(HIST, "utf8"));
} catch {}
const day = out.updated.slice(0, 10);
const row = {
  d: day, usAu: out.usAu, usAg: out.usAg, oil: out.oil,
  inAu: out.inAu, inAg: out.inAg, kwAu: out.kwAu, kwAg: out.kwAg,
};
const i = hist.findIndex((x) => x.d === day);
if (i >= 0) hist[i] = row; else hist.push(row);
hist = hist.slice(-400);

await mkdir("docs", { recursive: true });
await writeFile(OUT, JSON.stringify(out, null, 2) + "\n");
await writeFile(HIST, JSON.stringify(hist) + "\n");

console.log("\n--- summary ---");
for (const [k, v] of Object.entries(out.status)) console.log(`${k}: ${v}`);
