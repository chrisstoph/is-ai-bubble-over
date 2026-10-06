# Is the AI Bubble Over?

A one-page live tracker. The big answer ("Not yet." / "Yes.") is computed from four criteria that are fetched automatically from free public data. The page is **pre-rendered as static HTML** on every update, so search engines see the real answer without running JavaScript.

## The criteria

| # | Criterion | Met when | Source (free, no key) |
|---|-----------|----------|-----------------------|
| 1 | Nvidia crashes | NVDA ≥ 50% below all-time high | Yahoo Finance chart API → Nasdaq.com fallback |
| 2 | Tech bear market | Nasdaq-100 ≥ 30% below all-time high | Yahoo Finance chart API → Nasdaq.com fallback |
| 3 | Big Tech cuts AI spending | MSFT+GOOGL+AMZN+META quarterly capex falls YoY | SEC EDGAR XBRL API |
| 4 | Compute glut | Median H100 rental < $1.00/GPU-hour | Vast.ai public marketplace API |

The verdict is **Yes** only when all four are met. Thresholds and wording live in `config.mjs`.

If a source fails, the last good value is reused for up to 7 days and marked "(last known value)" on the page. After that the criterion shows "n/a" and counts as not met.

## Files

```
config.mjs      site URL, GA4 ID, criteria + thresholds   ← edit this
sources.mjs     one fetcher per criterion
build.mjs       fetch → evaluate → write public/ (index.html, data.json, sitemap.xml, robots.txt)
template.html   page layout, styles, meta tags
server.mjs      optional self-hosted server that rebuilds on a timer
static/         favicon, share images (copied into public/)
.github/workflows/update.yml   GitHub Pages deploy every 3 hours
```

No dependencies. Node 18+.

## Run locally

```bash
MOCK=1 node build.mjs   # sample data, no network
node build.mjs          # live data
npx serve public        # or: node server.mjs
```

## Deploy

**Option A — GitHub Pages (free, recommended)**
1. Push this folder to a GitHub repo.
2. Settings → Pages → Source: **GitHub Actions**.
3. Settings → Secrets and variables → Actions → **Variables**: add `SITE_URL` (e.g. `https://isaibubbleover.com`), `GA_ID` (your `G-…` ID), `SEC_USER_AGENT` (`yoursite.com you@email.com`).
4. Settings → Pages → Custom domain, if you have one.

The workflow rebuilds every 3 hours and commits `public/data.json` so the fallback values persist.

**Option B — any server**
```bash
SITE_URL=https://… GA_ID=G-… REFRESH_MINUTES=60 node server.mjs
```

## SEO built in

- Verdict in `<title>`, meta description, H1/answer text and FAQ, all server-rendered.
- Canonical URL, `robots` meta with large image previews, `sitemap.xml` with live `lastmod`, `robots.txt`.
- Open Graph + Twitter cards with a share image that switches between "NOT YET." and "YES.".
- JSON-LD: `WebSite`, `WebPage` (with `dateModified`), `FAQPage` (matches the visible FAQ), and `Dataset` (pointing at `data.json`, eligible for Google Dataset Search).
- Semantic HTML, no web fonts, inlined CSS, async GA → fast Core Web Vitals.

After launch: verify the domain in Google Search Console, submit `sitemap.xml`, and check the page with the Rich Results Test. Rankings for a query this competitive depend mostly on backlinks: posting it on Hacker News, Reddit and X when the market is moving is the biggest lever.
