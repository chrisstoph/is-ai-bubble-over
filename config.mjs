// ------------------------------------------------------------------
//  Site configuration — edit these before deploying.
// ------------------------------------------------------------------
export const SITE = {
  // Public URL of the page, no trailing slash. Used for canonical, OG, sitemap.
  url: process.env.SITE_URL || "https://istheaibubbleover.com",
  name: "Is the AI Bubble Over?",
  // GA4 Measurement ID. Leave empty to disable analytics.
  gaId: process.env.GA_ID || "G-XXXXXXXXXX",
  // SEC requires a descriptive User-Agent with a contact address.
  secUserAgent: process.env.SEC_USER_AGENT || "istheaibubbleover.com contact@istheaibubbleover.com",
  // Optional: your X/Twitter handle for twitter:site, e.g. "@kristof"
  twitter: process.env.TWITTER_HANDLE || "",
};

// ------------------------------------------------------------------
//  The criteria. The verdict is "Yes" only when ALL are met.
//  op: "gte" → met when value >= threshold, "lt" → met when value < threshold
// ------------------------------------------------------------------
export const CRITERIA = [
  {
    id: "nvda",
    title: "Nvidia stock crashes",
    rule: "NVDA trades at least 50% below its all-time high.",
    op: "gte", threshold: 50,
    format: v => `${v.toFixed(1)}% below peak`,
    why: "Nvidia is the purest public bet on AI. Every past tech bubble ended with its leader losing more than half its value (Cisco fell ~80% after 2000).",
  },
  {
    id: "ndx",
    title: "AI and tech stocks enter a bear market",
    rule: "The Nasdaq-100 is at least 30% below its all-time high.",
    op: "gte", threshold: 30,
    format: v => `${v.toFixed(1)}% below peak`,
    why: "A bubble bursting drags the whole sector, not just one stock. The Nasdaq-100 fell 33% in 2022 and 83% after the dot-com peak.",
  },
  {
    id: "capex",
    title: "Big Tech cuts AI spending",
    rule: "Combined quarterly capex of Microsoft, Alphabet, Amazon and Meta falls year-over-year.",
    op: "lt", threshold: 0,
    format: v => `${v >= 0 ? "+" : ""}${v.toFixed(0)}% YoY`,
    why: "Hyperscaler data-center spending is the money that funds the whole AI supply chain. When it shrinks, the boom has stopped.",
  },
  {
    id: "gpu",
    title: "GPU glut: H100 prices collapse",
    rule: "Median on-demand H100 rental price falls below $1.00 per GPU-hour.",
    op: "lt", threshold: 1.0,
    format: v => `$${v.toFixed(2)} / GPU-hour`,
    why: "If GPUs become nearly free to rent, the world built more AI capacity than anyone is willing to pay for — the classic overbuild of a bubble.",
  },
];
