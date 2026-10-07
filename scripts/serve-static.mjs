import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve(process.argv[2] ?? "out");
const port = Number(process.env.PORT ?? 47231);
const host = process.env.HOST ?? "0.0.0.0";

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".apk": "application/vnd.android.package-archive",
  ".map": "application/json; charset=utf-8",
};

function fileFor(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  const rel = path.normalize(decoded).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  try {
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const index = path.join(full, "index.html");
      statSync(index);
      return index;
    }
    return full;
  } catch {
    if (!path.extname(full)) {
      const html = `${full}.html`;
      try {
        statSync(html);
        return html;
      } catch {
        return null;
      }
    }
    return null;
  }
}

const server = createServer((req, res) => {
  const file = fileFor(req.url ?? "/");
  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("찾을 수 없습니다.");
    return;
  }
  const ext = path.extname(file);
  res.writeHead(200, {
    "Content-Type": types[ext] ?? "application/octet-stream",
    "Cache-Control": ext === ".html" || ext === ".webmanifest" ? "no-cache" : "public, max-age=3600",
    "Service-Worker-Allowed": "/",
  });
  createReadStream(file).pipe(res);
});

server.listen(port, host, () => {
  console.log(`한박자 static ${host}:${port} -> ${root}`);
});
