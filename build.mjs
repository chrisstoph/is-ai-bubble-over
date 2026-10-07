#!/usr/bin/env node
// ------------------------------------------------------------------
//  Fetch all criteria, decide the verdict, and pre-render the page.
//  Output goes to ./public (index.html, data.json, sitemap.xml, robots.txt).
//
//  Usage:  node build.mjs          → live data
//          MOCK=1 node build.mjs   → sample data, no network (for testing)
// ------------------------------------------------------------------
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SITE, CRITERIA } from "./config.mjs";
import { FETCHERS } from "./sources.mjs";

const ROOT = dirname(fileURLToPath(import.meta.url));
const OUT = join(ROOT, "public");
const STALE_AFTER_DAYS = 7; // keep last good value this long if a source fails

const MOCK = {
  nvda:  { value: 4.2,  detail: "NVDA at $226.50 vs. all-time high of $236.54 (2026-05-14).", source: "Mock", sourceUrl: "#" },
  ndx:   { value: 0.8,  detail: "Nasdaq-100 at 30,950 vs. all-time high of 31,200 (2026-09-23).", source: "Mock", sourceUrl: "#" },
  capex: { value: 77.0, detail: "2026 Q2: $171.9B combined vs. $97.1B a year earlier.", source: "Mock", sourceUrl: "#" },
  gpu:   { value: 1.98, detail: "Median of 42 live H100 offers (range $1.49–$3.20).", source: "Mock", sourceUrl: "#" },
};

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const isMet = (c, v) => v != null && (c.op === "gte" ? v >= c.threshold : v < c.threshold);

async function loadPrevious() {
  try { return JSON.parse(await readFile(join(OUT, "data.json"), "utf8")); } catch { return null; }
}

async function collect(prev) {
  const now = new Date().toISOString();
  const results = [];
  for (const c of CRITERIA) {
    process.stdout.write(`• ${c.id.padEnd(6)} `);
    let r, fetchedAt = now, stale = false;
    try {
      r = process.env.MOCK ? MOCK[c.id] : await FETCHERS[c.id]();
      console.log(`ok   ${r.value}`);
    } catch (e) {
      const old = prev?.criteria?.find(x => x.id === c.id && x.value != null);
      const ageDays = old ? (Date.now() - Date.parse(old.fetchedAt)) / 864e5 : Infinity;
      if (old && ageDays <= STALE_AFTER_DAYS) {
        r = old; fetchedAt = old.fetchedAt; stale = true;
        console.log(`FAIL (${e.message}) → reusing value from ${old.fetchedAt}`);
      } else {
        r = { value: null, detail: "Data temporarily unavailable.", source: "", sourceUrl: "" };
        console.log(`FAIL (${e.message}) → no recent value`);
      }
    }
    results.push({
      id: c.id, title: c.title, rule: c.rule, why: c.why, op: c.op, threshold: c.threshold,
      value: r.value, display: r.value == null ? "n/a" : c.format(r.value),
      met: isMet(c, r.value), detail: r.detail, source: r.source, sourceUrl: r.sourceUrl,
      fetchedAt, stale,
    });
  }
  return results;
}

// Each question targets a real search query; answers use live numbers so the
// text changes with every update (fresh, unique content that search engines reward).
function faqFor({ verdict, met, total, updatedHuman, criteria }) {
  const list = criteria.map(c => c.rule.replace(/\.$/, "")).join("; ");
  const metNames = criteria.filter(c => c.met).map(c => c.title.toLowerCase());
  const by = Object.fromEntries(criteria.map(c => [c.id, c]));
  const now = c => (c && c.value != null ? c.display : "currently unavailable");
  const isYes = verdict === "Yes.";
  return [
    {
      q: "Is the AI bubble over?",
      a: isYes
        ? `Yes. As of ${updatedHuman}, all ${total} of our bubble criteria are met at the same time: Nvidia and the Nasdaq-100 are in deep drawdowns, Big Tech is cutting AI capex, and GPU rental prices have collapsed.`
        : `Not yet. As of ${updatedHuman}, ${met} of ${total} criteria that would signal the end of the AI bubble are met${metNames.length ? ` (${metNames.join(", ")})` : ""}. The answer only changes to yes when all ${total} are met at once.`,
    },
    {
      q: "Has the AI bubble burst?",
      a: isYes
        ? `By our measures, yes: every signal of a burst is present at once as of ${updatedHuman}.`
        : `No. A burst would show up as a crash in AI stocks, a deep tech bear market, falling Big Tech AI spending and a glut of cheap GPUs. As of ${updatedHuman}, ${met} of these ${total} signals are present.`,
    },
    {
      q: "Is Nvidia in a bubble?",
      a: `Nvidia is the clearest public bet on AI, so its stock is our first signal. Right now NVDA is ${now(by.nvda)}. ${by.nvda?.detail || ""} We would count it as a burst only at 50% or more below its all-time high; in 2000, Cisco, the leader of the dot-com boom, fell about 80%.`,
    },
    {
      q: "Are AI stocks crashing?",
      a: `Not by our definition unless the tech-heavy Nasdaq-100 is at least 30% below its record. It is currently ${now(by.ndx)}. ${by.ndx?.detail || ""}`,
    },
    {
      q: "Is Big Tech still spending on AI?",
      a: `Combined quarterly capital spending of Microsoft, Alphabet, Amazon and Meta is running at ${now(by.capex)}. ${by.capex?.detail || ""} Spending that funds data centers and chips is the fuel of the AI boom; a year-over-year decline would be a major warning sign.`,
    },
    {
      q: "Are GPUs getting cheap? (H100 rental prices)",
      a: `The median on-demand rental price of an Nvidia H100 GPU is ${now(by.gpu)}. ${by.gpu?.detail || ""} A price below $1 per GPU-hour would suggest the world built far more AI capacity than it can use.`,
    },
    {
      q: "AI bubble vs. dot-com bubble: how do they compare?",
      a: "Both share record capital spending on infrastructure ahead of profits and a few market leaders carrying the index. The dot-com bust ended with the Nasdaq-100 down about 83% and leaders like Cisco down about 80%. Unlike 2000, today's AI leaders are highly profitable, which is why our criteria require the money flow itself (capex, GPU prices) to reverse, not just stock prices.",
    },
    {
      q: "How do you decide whether the AI bubble has burst?",
      a: `We track ${total} measurable signals and update them automatically from public data: ${list}. Each one alone can happen in a normal correction; all of them together describe a bubble that has popped.`,
    },
    {
      q: "Is AI actually a bubble?",
      a: "That is debated. Bulls point to fast-growing AI revenue at cloud providers and chip makers. Skeptics point to record capital spending running far ahead of the profits it produces, a pattern seen in the dot-com and railway booms. This page doesn't predict; it only reports whether the classic signs of a burst have appeared.",
    },
    {
      q: "Where does the data come from and how often is it updated?",
      a: "Stock and index prices come from Yahoo Finance (with Nasdaq.com as a fallback), Big Tech capital expenditures from quarterly SEC filings, and GPU rental prices from the Vast.ai marketplace. The page rebuilds automatically several times a day. This is not financial advice.",
    },
  ];
}

function render(tpl, data) {
  const { criteria, verdict, met, total, updatedIso, updatedHuman, faq } = data;
  const isYes = verdict === "Yes.";
  const month = new Date(updatedIso).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

  // Title: question + answer + freshness. ~55 chars so Google doesn't truncate it.
  const title = `Is the AI Bubble Over? ${verdict} Live Tracker (${month})`;
  // Description: answer first, then the related terms people search for. ~150 chars.
  const short = new Date(updatedIso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
  const description = isYes
    ? `Yes: the AI bubble has burst. All ${total} signals hit: Nvidia stock crash, AI stocks bear market, Big Tech capex cuts, GPU glut. Updated ${short}.`
    : `Not yet. ${met}/${total} AI bubble signals hit. Live data on Nvidia stock, AI stocks, Big Tech AI spending and GPU prices. Updated ${short}.`;
  const keywords = [
    "AI bubble", "is the AI bubble over", "AI bubble burst", "has the AI bubble burst", "AI bubble tracker",
    "Nvidia bubble", "is Nvidia a bubble", "NVDA stock", "AI stocks", "AI stock bubble", "AI stocks crash",
    "tech bubble", "Nasdaq 100", "dot-com bubble vs AI", "AI capex", "hyperscaler capex", "GPU prices", "H100 price",
  ].join(", ");

  const criteriaHtml = criteria.map((c, i) => `      <li class="item">
        <h3>${i + 1}. ${esc(c.title)}</h3>
        <span class="pill${c.met ? " met" : ""}">${c.met ? "Met" : "Not met"}</span>
        <p class="rule">${esc(c.rule)}</p>
        <p class="now">Now: <strong>${esc(c.display)}</strong>${c.stale ? ` <span class="stale">(last known value)</span>` : ""}</p>
        <p class="why">${esc(c.why)}</p>
        <p class="src">${esc(c.detail)}${c.sourceUrl ? ` Source: <a href="${esc(c.sourceUrl)}" rel="noopener nofollow" target="_blank">${esc(c.source)}</a>` : ""}</p>
      </li>`).join("\n");

  const faqHtml = faq.map(f => `    <details${f === faq[0] ? " open" : ""}>
      <summary>${esc(f.q)}</summary>
      <p>${esc(f.a)}</p>
    </details>`).join("\n");

  const pageUrl = `${SITE.url}/`;
  const ogImage = isYes ? "og-yes.png" : "og-not-yet.png";
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebSite", "@id": `${pageUrl}#website`, url: pageUrl, name: SITE.name, inLanguage: "en" },
      {
        "@type": "WebPage", "@id": `${pageUrl}#webpage`, url: pageUrl, name: title, description,
        isPartOf: { "@id": `${pageUrl}#website` }, inLanguage: "en",
        dateModified: updatedIso, datePublished: "2026-10-06",
        primaryImageOfPage: { "@type": "ImageObject", url: `${SITE.url}/hero-1200.jpg`, width: 1200, height: 427,
          caption: "A red balloon with the AI sparkle symbol about to be popped by a needle" },
        image: [`${SITE.url}/hero-1200.jpg`, `${SITE.url}/${ogImage}`],
        keywords,
        about: [
          { "@type": "Thing", name: "AI bubble" },
          { "@type": "Thing", name: "Artificial intelligence", sameAs: "https://en.wikipedia.org/wiki/Artificial_intelligence" },
          { "@type": "Thing", name: "Economic bubble", sameAs: "https://en.wikipedia.org/wiki/Economic_bubble" },
        ],
        mentions: [
          { "@type": "Corporation", name: "Nvidia", tickerSymbol: "NVDA", sameAs: "https://en.wikipedia.org/wiki/Nvidia" },
          { "@type": "Thing", name: "Nasdaq-100", sameAs: "https://en.wikipedia.org/wiki/Nasdaq-100" },
          { "@type": "Corporation", name: "Microsoft", tickerSymbol: "MSFT" },
          { "@type": "Corporation", name: "Alphabet", tickerSymbol: "GOOGL" },
          { "@type": "Corporation", name: "Amazon", tickerSymbol: "AMZN" },
          { "@type": "Corporation", name: "Meta Platforms", tickerSymbol: "META" },
          { "@type": "Thing", name: "Dot-com bubble", sameAs: "https://en.wikipedia.org/wiki/Dot-com_bubble" },
        ],
      },
      {
        "@type": "FAQPage", "@id": `${pageUrl}#faq`,
        mainEntity: faq.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
      },
      {
        "@type": "Dataset", "@id": `${pageUrl}#dataset`,
        name: "AI bubble indicators",
        description: `Live indicators of whether the AI bubble has burst: ${criteria.map(c => c.title).join(", ")}.`,
        url: pageUrl, dateModified: updatedIso, isAccessibleForFree: true,
        license: "https://creativecommons.org/licenses/by/4.0/",
        creator: { "@type": "Organization", name: SITE.name, url: pageUrl },
        variableMeasured: criteria.map(c => ({ "@type": "PropertyValue", name: c.title, value: c.value, description: c.rule })),
        distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE.url}/data.json` }],
      },
    ],
  };

  const ga = SITE.gaId ? `<link rel="preconnect" href="https://www.googletagmanager.com">
<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(SITE.gaId)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(SITE.gaId)}',{verdict:'${isYes ? "yes" : "not_yet"}',criteria_met:${met}});</script>` : "";

  const tokens = {
    TITLE: esc(title),
    OG_TITLE: esc(`Is the AI Bubble over? ${verdict}`),
    DESCRIPTION: esc(description),
    KEYWORDS: esc(keywords),
    URL: SITE.url,
    SITE_NAME: esc(SITE.name),
    OG_IMAGE: ogImage,
    VERDICT: esc(verdict),
    VERDICT_CLASS: isYes ? " yes" : "",
    UPDATED_ISO: updatedIso,
    UPDATED_HUMAN: esc(updatedHuman),
    MET: String(met),
    TOTAL: String(total),
    TOTAL_WORD: WORDS[total] || String(total),
    CRITERIA_HTML: criteriaHtml,
    FAQ_HTML: faqHtml,
    JSON_LD: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
    GA: ga,
    TWITTER_SITE: SITE.twitter ? `<meta name="twitter:site" content="${esc(SITE.twitter)}">` : "",
  };
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in tokens ? tokens[k] : ""));
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const prev = await loadPrevious();
  const criteria = await collect(prev);

  const met = criteria.filter(c => c.met).length;
  const total = criteria.length;
  const verdict = met === total ? "Yes." : "Not yet.";
  const updatedIso = new Date().toISOString();
  const updatedHuman = new Date(updatedIso).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", timeZoneName: "short",
  });
  const faq = faqFor({ verdict, met, total, updatedHuman, criteria });

  const tpl = await readFile(join(ROOT, "template.html"), "utf8");
  await writeFile(join(OUT, "index.html"), render(tpl, { criteria, verdict, met, total, updatedIso, updatedHuman, faq }));
  await writeFile(join(OUT, "data.json"), JSON.stringify({ verdict, met, total, updated: updatedIso, criteria }, null, 2));
  await writeFile(join(OUT, "sitemap.xml"),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE.url}/</loc><lastmod>${updatedIso}</lastmod><changefreq>hourly</changefreq><priority>1.0</priority></url>
</urlset>
`);
  // Welcome search and AI-answer crawlers explicitly (ChatGPT, Perplexity, Claude, Google AI).
  const bots = ["*", "Googlebot", "Bingbot", "GPTBot", "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "ClaudeBot", "Claude-SearchBot", "Google-Extended", "Applebot"];
  await writeFile(join(OUT, "robots.txt"),
    bots.map(b => `User-agent: ${b}\nAllow: /\n`).join("\n") + `\nSitemap: ${SITE.url}/sitemap.xml\n`);

  // llms.txt: plain-text summary for AI search/answer engines, with the live verdict.
  await writeFile(join(OUT, "llms.txt"),
`# Is the AI Bubble Over?

> Live tracker answering "Is the AI bubble over?" with four measurable criteria, updated automatically several times a day. Current answer: ${verdict} (${met} of ${total} criteria met, updated ${updatedHuman}).

## Current criteria
${criteria.map(c => `- ${c.title}: ${c.rule} Now: ${c.display}. ${c.met ? "MET" : "NOT MET"}.`).join("\n")}

## Links
- [Live page](${SITE.url}/): verdict and explanation
- [Raw data (JSON)](${SITE.url}/data.json): machine-readable values

Sources: Yahoo Finance / Nasdaq.com (prices), SEC EDGAR (capex), Vast.ai (GPU rental prices). Not financial advice.
`);

  // Static assets live in ./static and are copied as-is.
  for (const f of ["favicon.svg", "favicon.ico", "favicon-96.png", "apple-touch-icon.png", "icon-192.png", "icon-512.png",
                   "site.webmanifest", "og-not-yet.png", "og-yes.png",
                   ...[400, 800, 1200].flatMap(w => [`hero-${w}.webp`, `hero-${w}.jpg`])]) {
    const src = join(ROOT, "static", f);
    if (existsSync(src)) await copyFile(src, join(OUT, f));
  }
  console.log(`\nVerdict: ${verdict} (${met}/${total} met) → public/index.html`);
}

main().catch(e => { console.error(e); process.exit(1); });
