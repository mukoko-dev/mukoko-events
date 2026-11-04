// Generates public/sw.js from scripts/sw.template.js with this build's
// commit sha injected. Runs as the first step of `npm run build`.
//
// Why the version lives INSIDE the script, not in its URL: the page calls
// registration.update() whenever the PWA becomes visible or focused again,
// and update() re-fetches the registration's EXISTING script URL. A
// URL-versioned worker (/sw.js?v=<sha>) therefore re-fetches the old URL and
// can never observe a new deploy — an open or background PWA (or a kiosk
// unit) stayed on the old build until a fresh navigation happened. With the
// sha in the script bytes and /sw.js served `Cache-Control: no-store`
// (next.config.ts), update() byte-compares fresh content and finds the new
// release. This is the mukoko-weather / mukoko-news platform pattern.
//
// public/sw.js is generated, gitignored, and never committed; the template is
// the source of truth.

import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function buildSha() {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (fromEnv && /^[0-9a-f]{7,40}$/i.test(fromEnv)) return fromEnv.slice(0, 40);
  try {
    return execSync("git rev-parse --short=7 HEAD", {
      cwd: root,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return "";
  }
}

const template = readFileSync(join(root, "scripts/sw.template.js"), "utf8");
const generated = template.replaceAll("__SW_SHA__", buildSha());

writeFileSync(join(root, "public/sw.js"), generated);
