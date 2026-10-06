#!/usr/bin/env node
// ------------------------------------------------------------------
//  Optional: self-hosted mode (VPS, Docker, Render, Fly.io …).
//  Serves ./public and re-runs build.mjs on a schedule. Zero dependencies.
//
//  PORT=8080 REFRESH_MINUTES=60 node server.mjs
// ------------------------------------------------------------------
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, extname, normalize, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(ROOT, "public");
const PORT = +process.env.PORT || 8080;
const REFRESH_MIN = +process.env.REFRESH_MINUTES || 60;

const TYPES = {
  ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png",
};

function rebuild() {
  const p = spawn(process.execPath, [join(ROOT, "build.mjs")], { stdio: "inherit", env: process.env });
  p.on("exit", code => console.log(`[${new Date().toISOString()}] build exited with ${code}`));
}

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(PUBLIC, path));
    if (!file.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    await stat(file);
    const ext = extname(file);
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      // HTML/data change on every build; images can be cached longer.
      "Cache-Control": [".html", ".json", ".xml"].includes(ext) ? "public, max-age=300" : "public, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
  }
}).listen(PORT, () => console.log(`Serving on :${PORT}, rebuilding every ${REFRESH_MIN} min`));

rebuild();
setInterval(rebuild, REFRESH_MIN * 60_000);
