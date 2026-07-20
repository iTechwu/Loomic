const baseUrl = new URL(
  process.env.E2E_BASE_URL ?? "https://lovart.local.dofe.ai",
);
const expectedSsoOrigin = process.env.E2E_SSO_ORIGIN;
const requireSecurityHeaders = process.env.E2E_REQUIRE_SECURITY_HEADERS === "1";
const requireExpectedSsoOrigin =
  process.env.E2E_REQUIRE_EXPECTED_SSO_ORIGIN === "1";

if (requireExpectedSsoOrigin && !expectedSsoOrigin) {
  throw new Error("E2E_SSO_ORIGIN is required for credentialed runtime verification.");
}

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

async function verifyLegacyEntry(path) {
  const legacyResponse = await request(path);
  const oidcStartLocation = legacyResponse.headers.get("location");
  const oidcStartUrl = oidcStartLocation
    ? new URL(oidcStartLocation, baseUrl)
    : null;
  if (
    legacyResponse.status !== 302 ||
    !oidcStartUrl ||
    oidcStartUrl.origin !== baseUrl.origin ||
    oidcStartUrl.pathname !== "/api/auth/oidc/start"
  ) {
    throw new Error(`${path} did not issue the required same-origin OIDC redirect.`);
  }
  return oidcStartUrl;
}

const oidcStartUrl = await verifyLegacyEntry("/login");
await verifyLegacyEntry("/register");

const authorization = await fetch(oidcStartUrl, { redirect: "manual" });
const providerLocation = authorization.headers.get("location");
if (authorization.status !== 302 || !providerLocation) {
  throw new Error("OIDC start did not redirect the browser to the provider.");
}

const pkceCookie = authorization.headers.get("set-cookie") ?? "";
if (!/HttpOnly/i.test(pkceCookie) || !/SameSite=None/i.test(pkceCookie)) {
  throw new Error("OIDC start did not set the required HttpOnly SameSite=None PKCE cookie.");
}
if (baseUrl.protocol === "https:" && !/Secure/i.test(pkceCookie)) {
  throw new Error("HTTPS OIDC start did not set a Secure PKCE cookie.");
}

if (requireSecurityHeaders) {
  const landing = await request("/");
  const requiredHeaderValues = {
    "content-security-policy": ["default-src 'self'", "object-src 'none'", "frame-ancestors 'self'"],
    "permissions-policy": ["camera=()", "microphone=()"],
    "referrer-policy": ["strict-origin-when-cross-origin"],
    "strict-transport-security": ["max-age="],
    "x-content-type-options": ["nosniff"],
  };
  for (const [header, fragments] of Object.entries(requiredHeaderValues)) {
    const value = landing.headers.get(header);
    if (!value || !fragments.every((fragment) => value.includes(fragment))) {
      throw new Error(`Same-origin landing response is missing the required ${header} policy.`);
    }
  }
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
