// ------------------------------------------------------------------
//  Data sources — all free, no API keys.
//  Each fetcher returns { value, detail, source, sourceUrl } or throws.
// ------------------------------------------------------------------
import { SITE } from "./config.mjs";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36";

async function getJson(url, headers = {}, timeoutMs = 20000) {
  const res = await fetch(url, {
    headers: { "User-Agent": BROWSER_UA, Accept: "application/json", ...headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// ---------- Prices: drawdown from all-time high ----------

/** Yahoo Finance chart API (primary). Returns [{date, close}] daily, full history. */
async function yahooHistory(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=max&interval=1d`;
  const j = await getJson(url);
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`Yahoo: no result for ${symbol}`);
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const rows = ts
    .map((t, i) => ({ date: new Date(t * 1000).toISOString().slice(0, 10), close: closes[i] }))
    .filter(x => Number.isFinite(x.close));
  // Make sure today's live price is included even if the daily bar isn't closed yet.
  const live = r.meta?.regularMarketPrice;
  if (Number.isFinite(live)) rows.push({ date: new Date().toISOString().slice(0, 10), close: live });
  if (rows.length < 100) throw new Error(`Yahoo: too little history for ${symbol}`);
  return rows;
}

/** Nasdaq.com API (fallback). ~10 years of daily history. */
async function nasdaqHistory(symbol, assetclass) {
  const from = new Date(Date.now() - 10 * 365 * 864e5).toISOString().slice(0, 10);
  const url = `https://api.nasdaq.com/api/quote/${encodeURIComponent(symbol)}/historical?assetclass=${assetclass}&fromdate=${from}&limit=9999`;
  const j = await getJson(url, { Origin: "https://www.nasdaq.com", Referer: "https://www.nasdaq.com/" });
  const rows = (j?.data?.tradesTable?.rows || [])
    .map(r => ({
      date: r.date,
      close: parseFloat(String(r.close).replace(/[$,]/g, "")),
    }))
    .filter(x => Number.isFinite(x.close));
  if (rows.length < 100) throw new Error(`Nasdaq: too little history for ${symbol}`);
  return rows;
}

function drawdown(rows) {
  let peak = -Infinity, peakDate = "";
  for (const r of rows) if (r.close > peak) { peak = r.close; peakDate = r.date; }
  const last = rows.reduce((a, b) => (a.date > b.date ? a : b));
  return { pct: round((1 - last.close / peak) * 100, 1), peak, peakDate, last };
}

async function drawdownFor({ yahoo, nasdaq, assetclass, label, money }) {
  let rows, source, sourceUrl;
  try {
    rows = await yahooHistory(yahoo);
    source = "Yahoo Finance";
    sourceUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(yahoo)}/history`;
  } catch (e) {
    console.warn(`  Yahoo failed for ${yahoo}: ${e.message} — trying Nasdaq`);
    rows = await nasdaqHistory(nasdaq, assetclass);
    source = "Nasdaq.com";
    sourceUrl = `https://www.nasdaq.com/market-activity/${assetclass === "index" ? "index" : "stocks"}/${nasdaq.toLowerCase()}/historical`;
  }
  const d = drawdown(rows);
  const f = n => (money ? `$${n.toFixed(2)}` : n.toLocaleString("en-US", { maximumFractionDigits: 0 }));
  return {
    value: d.pct,
    detail: `${label} at ${f(d.last.close)} vs. all-time high of ${f(d.peak)} (${d.peakDate}).`,
    source, sourceUrl,
  };
}

export const fetchNvda = () =>
  drawdownFor({ yahoo: "NVDA", nasdaq: "NVDA", assetclass: "stocks", label: "NVDA", money: true });

export const fetchNdx = () =>
  drawdownFor({ yahoo: "^NDX", nasdaq: "NDX", assetclass: "index", label: "Nasdaq-100", money: false });

// ---------- SEC EDGAR: hyperscaler capex ----------

const HYPERSCALERS = [
  { name: "Microsoft", cik: "0000789019" },
  { name: "Alphabet",  cik: "0001652044" },
  { name: "Amazon",    cik: "0001018724" },
  { name: "Meta",      cik: "0001326801" },
];
// Cash-flow tags companies use for capex (Amazon uses "ProductiveAssets").
const CAPEX_TAGS = ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"];

const days = (a, b) => (Date.parse(b) - Date.parse(a)) / 864e5;
const calQuarter = end => {
  const d = new Date(end + "T00:00:00Z");
  // Quarter ending e.g. 2026-06-30 → 2026Q2 (allow fiscal ends a few days off month-end)
  const shifted = new Date(d.getTime() + 10 * 864e5);
  const m = shifted.getUTCMonth(); // 0..11, quarter-end months are 2,5,8,11 → after shift 3,6,9,0
  const y = shifted.getUTCFullYear() - (m === 0 ? 1 : 0);
  const q = m === 0 ? 4 : Math.ceil(m / 3);
  return `${y}Q${q}`;
};

/**
 * Turn SEC XBRL facts (mix of 3-month, YTD and full-year durations) into
 * quarterly values keyed by calendar quarter, e.g. { "2026Q2": 44.9e9 }.
 * Exported for testing.
 */
export function quarterlyFromFacts(facts) {
  // Keep the most recently filed value for each (start, end) pair.
  const byKey = new Map();
  for (const f of facts) {
    if (!f.start || !f.end || !Number.isFinite(f.val)) continue;
    if (!/^10-[QK]/.test(f.form || "")) continue;
    const k = `${f.start}|${f.end}`;
    const prev = byKey.get(k);
    if (!prev || (f.filed || "") > (prev.filed || "")) byKey.set(k, f);
  }
  const all = [...byKey.values()];
  const out = {};
  const ends = [...new Set(all.map(f => f.end))].sort();
  for (const end of ends) {
    const atEnd = all.filter(f => f.end === end);
    // 1) a direct ~3-month fact
    const q = atEnd.find(f => { const d = days(f.start, f.end); return d > 80 && d < 100; });
    if (q) { out[calQuarter(end)] = q.val; continue; }
    // 2) YTD at this end minus YTD at the previous quarter-end with the same start
    for (const ytd of atEnd) {
      const prior = all
        .filter(f => f.start === ytd.start && f.end < end && days(f.end, end) > 80 && days(f.end, end) < 100)
        .sort((a, b) => (a.end < b.end ? 1 : -1))[0];
      if (prior) { out[calQuarter(end)] = ytd.val - prior.val; break; }
    }
  }
  return out;
}

async function companyQuarters(c) {
  let best = {};
  for (const tag of CAPEX_TAGS) {
    try {
      const j = await getJson(
        `https://data.sec.gov/api/xbrl/companyconcept/CIK${c.cik}/us-gaap/${tag}.json`,
        { "User-Agent": SITE.secUserAgent }
      );
      const q = quarterlyFromFacts(j?.units?.USD || []);
      const latest = Object.keys(q).sort().pop() || "";
      const bestLatest = Object.keys(best).sort().pop() || "";
      if (latest > bestLatest) best = q;
    } catch { /* tag not used by this company */ }
  }
  if (!Object.keys(best).length) throw new Error(`SEC: no capex data for ${c.name}`);
  return best;
}

export async function fetchCapex() {
  const per = [];
  for (const c of HYPERSCALERS) {
    per.push({ ...c, q: await companyQuarters(c) });
    await new Promise(r => setTimeout(r, 200)); // be polite: SEC allows 10 req/s
  }
  const prevYear = k => `${+k.slice(0, 4) - 1}${k.slice(4)}`;
  // Latest quarter that all four have reported, with a year-ago comparison.
  const common = Object.keys(per[0].q)
    .filter(k => per.every(p => p.q[k] != null && p.q[prevYear(k)] != null))
    .sort();
  const k = common.pop();
  if (!k) throw new Error("SEC: no common quarter across hyperscalers");
  const now = per.reduce((s, p) => s + p.q[k], 0);
  const ago = per.reduce((s, p) => s + p.q[prevYear(k)], 0);
  const label = `${k.slice(0, 4)} ${k.slice(4)}`;
  return {
    value: round((now / ago - 1) * 100, 1),
    detail: `${label}: $${(now / 1e9).toFixed(1)}B combined vs. $${(ago / 1e9).toFixed(1)}B a year earlier.`,
    source: "SEC EDGAR filings",
    sourceUrl: "https://www.sec.gov/edgar/search/",
  };
}

// ---------- Vast.ai: H100 rental marketplace ----------

export async function fetchGpu() {
  const q = {
    gpu_name: { in: ["H100 SXM", "H100 PCIE", "H100 NVL"] },
    type: "on-demand",
    limit: 1000,
  };
  const j = await getJson(`https://console.vast.ai/api/v0/bundles/?q=${encodeURIComponent(JSON.stringify(q))}`);
  const offers = (j?.offers || []).filter(
    o => /H100/i.test(o.gpu_name || "") && o.num_gpus > 0 && Number.isFinite(o.dph_total)
  );
  if (offers.length < 5) throw new Error(`Vast.ai: only ${offers.length} H100 offers returned`);
  const avail = offers.filter(o => o.rentable);
  const pool = avail.length >= 5 ? avail : offers;
  const prices = pool.map(o => o.dph_total / o.num_gpus).sort((a, b) => a - b);
  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
  return {
    value: round(median, 2),
    detail: `Median of ${prices.length} live H100 offers (range $${prices[0].toFixed(2)}–$${prices.at(-1).toFixed(2)}).`,
    source: "Vast.ai GPU marketplace",
    sourceUrl: "https://vast.ai/pricing",
  };
}

export const FETCHERS = { nvda: fetchNvda, ndx: fetchNdx, capex: fetchCapex, gpu: fetchGpu };
