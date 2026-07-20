const baseUrl = new URL(
  process.env.COMPOSE_RUNTIME_BASE_URL ?? "http://127.0.0.1:8080",
);

async function request(path) {
  return fetch(new URL(path, baseUrl), { redirect: "manual" });
}

const health = await request("/api/health");
if (!health.ok) {
  throw new Error(`Compose runtime health check returned ${health.status}.`);
}

const payload = await health.json();
if (payload.ok !== true || payload.service !== "lovart-dofe-server") {
  throw new Error("Compose runtime did not proxy the Fastify health contract.");
}

// The CI override deliberately omits SSO credentials. A typed Fastify 503 is
// therefore the expected proof that /api remains behind the reverse proxy and
// is never swallowed by Nginx's static-export fallback.
const oidcStart = await request("/api/auth/oidc/start?returnTo=%2Fprojects");
const oidcFailure = await oidcStart.json().catch(() => null);
if (
  oidcStart.status !== 503 ||
  oidcFailure?.error !== "sso_not_configured" ||
  !oidcStart.headers.get("x-request-id")
) {
  throw new Error(
    "Compose runtime did not proxy the typed Fastify OIDC configuration failure.",
  );
}

for (const legacyPath of ["/login", "/register"]) {
  const response = await request(legacyPath);
  const location = response.headers.get("location");
  if (
    response.status !== 302 ||
    !location ||
    new URL(location, baseUrl).origin !== baseUrl.origin ||
    new URL(location, baseUrl).pathname !== "/api/auth/oidc/start"
  ) {
    throw new Error(`${legacyPath} did not retain the same-origin OIDC entry.`);
  }
}

const landing = await request("/");
const requiredHeaderValues = {
  "content-security-policy": [
    "default-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
  ],
  "permissions-policy": ["camera=()", "microphone=()"],
  "referrer-policy": ["strict-origin-when-cross-origin"],
  "strict-transport-security": ["max-age=31536000", "includeSubDomains"],
  "x-content-type-options": ["nosniff"],
};
for (const [header, fragments] of Object.entries(requiredHeaderValues)) {
  const value = landing.headers.get(header);
  if (!value || !fragments.every((fragment) => value.includes(fragment))) {
    throw new Error(`Compose runtime landing response is missing ${header}.`);
  }
}

// A plain HTTP request is not a WebSocket handshake, so Fastify may return a
// 4xx response. The important boundary is that Nginx proxies it to Fastify
// rather than falling through to static index.html.
const websocketProbe = await request("/api/ws");
const websocketBody = await websocketProbe.text();
if (websocketProbe.status === 200 || /<html[\s>]/i.test(websocketBody)) {
  throw new Error(
    "Compose runtime did not retain Fastify ownership of /api/ws.",
  );
}

console.log(`Verified Compose Nginx + Fastify runtime at ${baseUrl.origin}.`);
