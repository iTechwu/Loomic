const required = [
  "E2E_BASE_URL",
  "E2E_SSO_ORIGIN",
  "E2E_SSO_USERNAME",
  "E2E_SSO_PASSWORD",
  "E2E_SSO_USERNAME_SELECTOR",
  "E2E_SSO_PASSWORD_SELECTOR",
  "E2E_SSO_SUBMIT_SELECTOR",
];

const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  throw new Error(
    `Real SSO E2E is not configured; missing protected values: ${missing.join(", ")}.`,
  );
}

function parseHttpsOrigin(name) {
  const url = new URL(process.env[name]);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      `${name} must be a credential-free HTTPS origin without a path, query, or hash.`,
    );
  }
  return url;
}

const baseUrl = parseHttpsOrigin("E2E_BASE_URL");
const ssoOrigin = parseHttpsOrigin("E2E_SSO_ORIGIN");

if (baseUrl.origin === ssoOrigin.origin) {
  throw new Error("E2E_BASE_URL and E2E_SSO_ORIGIN must be distinct origins.");
}

console.log("Real SSO E2E protected environment is configured.");
