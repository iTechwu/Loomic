const baseUrl = new URL(
  process.env.E2E_BASE_URL ?? "https://lovart.local.dofe.ai",
);
const expectedSsoOrigin = process.env.E2E_SSO_ORIGIN;

async function request(path) {
  return fetch(new URL(path, baseUrl), { redirect: "manual" });
}

const health = await request("/api/health");
if (!health.ok) {
  throw new Error(`Same-origin Fastify health check returned ${health.status}.`);
}

const healthPayload = await health.json();
if (healthPayload.ok !== true || healthPayload.service !== "lovart-dofe-server") {
  throw new Error("Same-origin /api/health did not return the Fastify health contract.");
}

const legacyLogin = await request("/login");
const oidcStartLocation = legacyLogin.headers.get("location");
const oidcStartUrl = oidcStartLocation
  ? new URL(oidcStartLocation, baseUrl)
  : null;
if (
  legacyLogin.status !== 302 ||
  !oidcStartUrl ||
  oidcStartUrl.origin !== baseUrl.origin ||
  oidcStartUrl.pathname !== "/api/auth/oidc/start"
) {
  throw new Error("/login did not issue the required same-origin OIDC redirect.");
}

const authorization = await fetch(oidcStartUrl, { redirect: "manual" });
const providerLocation = authorization.headers.get("location");
if (authorization.status !== 302 || !providerLocation) {
  throw new Error("OIDC start did not redirect the browser to the provider.");
}

const providerUrl = new URL(providerLocation);
if (
  !["https:", "http:"].includes(providerUrl.protocol) ||
  !providerUrl.pathname.endsWith("/oauth/authorize") ||
  (expectedSsoOrigin && providerUrl.origin !== expectedSsoOrigin)
) {
  throw new Error("OIDC start returned an unexpected provider authorization endpoint.");
}

console.log(
  `Verified same-origin Web + Fastify runtime at ${baseUrl.origin}; provider origin ${providerUrl.origin}.`,
);
