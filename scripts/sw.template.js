// Mukoko Events service worker TEMPLATE.
//
// scripts/inject-sw-version.mjs generates public/sw.js from this file at
// build time with the deploy's commit sha in the BUILD constant below. The
// version lives in the script BYTES, not in its URL, because the page calls
// registration.update() whenever the PWA becomes visible or focused — and
// update() re-fetches the registration's existing script URL, so a
// URL-versioned worker can never observe a new deploy. /sw.js is served
// `Cache-Control: no-store` (next.config.ts) so every update check
// byte-compares fresh content. A changed BUILD means a changed script → the
// browser installs the new worker → skipWaiting activates it → the page
// reloads once (src/components/pwa/sw-register.tsx) → activate deletes every
// other version's cache.
//
// public/sw.js is generated, gitignored, and never committed; this template
// is the source of truth.

// Injected at build time: the deploy's commit sha (VERCEL_GIT_COMMIT_SHA /
// git rev-parse). Empty only in a build without git.
const BUILD = { sha: "__SW_SHA__" };
const CACHE_VERSION = `nhimbe-${BUILD.sha || "dev"}`;

self.addEventListener("install", (event) => {
  // Skip waiting to activate immediately
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Only http(s) GET responses can be safely cached. chrome-extension://, data:,
// blob: and partial/opaque responses must be skipped to avoid runtime errors.
function isCacheable(request, response) {
  if (!response || !response.ok) return false;
  if (response.type === "opaque" || response.type === "opaqueredirect")
    return false;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return true;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(request, response)) {
      const clone = response.clone();
      caches
        .open(CACHE_VERSION)
        .then((cache) => cache.put(request, clone))
        .catch(() => {});
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (isCacheable(request, response)) {
      const clone = response.clone();
      caches
        .open(CACHE_VERSION)
        .then((cache) => cache.put(request, clone))
        .catch(() => {});
    }
    return response;
  } catch {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  // Only handle GET requests
  if (event.request.method !== "GET") return;

  let url;
  try {
    url = new URL(event.request.url);
  } catch {
    return;
  }

  // Skip non-http(s) schemes (chrome-extension://, blob:, data:, etc.)
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  // Skip cross-origin requests entirely — let the browser handle them
  if (url.origin !== self.location.origin) return;

  // Network-first for API calls
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Cache-first for immutable hashed assets (_next/static)
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  // Network-first for HTML pages and everything else
  event.respondWith(networkFirst(event.request));
});
