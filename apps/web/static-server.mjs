import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { basename, extname, join, resolve } from 'node:path';

const root = resolve(process.env.STATIC_ROOT ?? '/app');
const port = Number.parseInt(process.env.PORT ?? '3005', 10);
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function resolveAsset(requestUrl) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(requestUrl, 'http://localhost').pathname);
  } catch {
    return null;
  }

  const asset = resolve(root, `.${pathname}`);
  if (asset !== root && !asset.startsWith(`${root}/`)) {
    return null;
  }

  if (existsSync(asset) && statSync(asset).isFile()) {
    return asset;
  }

  const index = join(asset, 'index.html');
  return existsSync(index) && statSync(index).isFile() ? index : join(root, 'index.html');
}

createServer((request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const asset = resolveAsset(request.url ?? '/');
  if (!asset || !existsSync(asset)) {
    response.writeHead(400).end();
    return;
  }

  response.writeHead(200, {
    'Content-Type': contentTypes[extname(asset)] ?? 'application/octet-stream',
    'Content-Length': statSync(asset).size,
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(asset).pipe(response);
}).listen(port, '0.0.0.0', () => {
  console.log(`Serving ${basename(root)} on port ${port}`);
});
