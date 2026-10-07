import { readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("out");

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(full)));
    else files.push(full);
  }
  return files;
}

const files = await walk(outDir);
const urls = new Set();

for (const file of files) {
  const rel = path.relative(outDir, file).split(path.sep).join("/");
  if (rel === "sw.js" || rel.endsWith(".apk") || rel.endsWith(".map")) continue;
  if (rel.endsWith("/index.html") || rel === "index.html") {
    const dir = rel.slice(0, -"index.html".length);
    urls.add(dir === "" ? "/" : `/${dir}`);
  }
  urls.add(`/${rel}`);
}

const version = new Date().toISOString().replace(/[:.]/g, "-");
const body = `/* 한박자 오프라인 캐시. 빌드 때 생성됩니다. */
const CACHE = "hanbakja-${version}";
const PRECACHE = ${JSON.stringify([...urls].sort(), null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith(".apk")) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      try {
        const fresh = await fetch(request);
        if (fresh.ok) await cache.put(request, fresh.clone());
        return fresh;
      } catch {
        if (cached) return cached;
        const pathName = url.pathname.endsWith("/") ? url.pathname : url.pathname + "/";
        return (
          (await cache.match(pathName)) ||
          (await cache.match(pathName + "index.html")) ||
          (await cache.match("/")) ||
          new Response("오프라인 상태이고 이 화면은 아직 저장되지 않았습니다.", {
            status: 503,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          })
        );
      }
    })(),
  );
});
`;

await writeFile(path.join(outDir, "sw.js"), body);
console.log(`service worker precache ${urls.size} urls`);
