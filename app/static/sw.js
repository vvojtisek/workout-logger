"use strict";

const CACHE_NAME = "workout-logger-v7";
const SHELL_KEY = "/";

const NEVER_CACHE_PREFIXES = ["/api/v1", "/health", "/docs", "/openapi.json"];

async function cacheShell(cache, response) {
  // Vite's generated shell names its public entry bundle and static imports.
  // Save them before replacing the document that refers to them.
  const html = await response.clone().text();
  const urls = new Set(["/manifest.webmanifest"]);
  for (const match of html.matchAll(/\b(?:href|src)="(\/static\/dist\/assets\/[^"<>]+)"/g)) {
    const asset = new URL(match[1], self.location.origin);
    if (asset.pathname.startsWith("/static/dist/assets/")) urls.add(asset.href);
  }
  const missing = await Promise.all([...urls].map(async (url) => (await cache.match(url)) ? null : url));
  await cache.addAll(missing.filter(Boolean));
  await cache.put(SHELL_KEY, response);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const response = await fetch(SHELL_KEY, { cache: "reload" });
    if (!response.ok) throw new Error("Workout shell is unavailable");
    await cacheShell(await caches.open(CACHE_NAME), response);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("workout-logger-") && key !== CACHE_NAME)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

function isNeverCached(pathname) {
  return NEVER_CACHE_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isStaticAsset(pathname) {
  return pathname.startsWith("/static/") || pathname === "/manifest.webmanifest";
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cacheShell(cache, response.clone()).catch(() => undefined);
    return response;
  } catch (err) {
    const cached = await cache.match(SHELL_KEY);
    if (cached) return cached;
    throw err;
  }
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;

  if (isNeverCached(url.pathname)) {
    event.respondWith(fetch(event.request));
    return;
  }

  if (event.request.mode === "navigate" && (url.pathname === "/" || url.pathname === "/workout")) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  if (isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
});
