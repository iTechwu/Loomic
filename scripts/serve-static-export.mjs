import { createReadStream, existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.env.STATIC_EXPORT_ROOT ?? "apps/web/out");
const port = Number.parseInt(process.env.STATIC_EXPORT_PORT ?? "3006", 10);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

function resolveAsset(urlPath) {
  const pathname = decodeURIComponent(urlPath.split("?", 1)[0] ?? "/");
  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const candidate = resolve(root, normalize(relativePath));
  if (!candidate.startsWith(`${root}/`) && candidate !== root) return null;
  if (existsSync(candidate)) return candidate;
  if (!extname(candidate) && existsSync(`${candidate}.html`)) return `${candidate}.html`;
  return join(root, "index.html");
}

const server = createServer(async (request, response) => {
  const filePath = resolveAsset(request.url ?? "/");
  if (!filePath) {
    response.writeHead(400).end("Bad Request");
    return;
  }
  try {
    const metadata = await stat(filePath);
    if (!metadata.isFile()) throw new Error("Not a file");
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream",
    });
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404).end("Not Found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Static Lovart export listening at http://127.0.0.1:${port}`);
});
