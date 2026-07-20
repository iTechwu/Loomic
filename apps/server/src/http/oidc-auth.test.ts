import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerEnv } from "../config/env.js";
import { ssoProfileEmail } from "../sso-identity-email.js";
import { chooseDataUserId, registerOidcAuthRoutes } from "./oidc-auth.js";

const configuredEnv: ServerEnv = {
  agentBackendMode: "state",
  agentModel: "test",
  internalApiSecret: "test-secret",
  port: 3001,
  ssoApiUrl: "https://sso.example.test/api",
  ssoClientId: "lovart-test-client",
  ssoClientSecret: "client-secret",
  ssoIssuer: "https://sso.example.test/api",
  ssoJwksUri: "https://sso.example.test/api/.well-known/jwks.json",
  ssoRedirectUri: "https://lovart.example.test/auth/callback",
  version: "test",
  webOrigin: "https://lovart.example.test",
};

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createTestApp(env: ServerEnv) {
  const app = Fastify({ logger: false });
  apps.push(app);
  return app;
}

describe("OIDC auth routes", () => {
  it("creates a stable local profile email for an SSO subject without email", () => {
    const subject = "00000000-0000-4000-8000-000000000001";

    expect(ssoProfileEmail(subject)).toBe(
      "sso-00000000-0000-4000-8000-000000000001@dofe.invalid",
    );
    expect(ssoProfileEmail(subject, " maker@example.com ")).toBe(
      "maker@example.com",
    );
  });

  it("preserves a mapped or uniquely matched legacy data user", () => {
    expect(chooseDataUserId("sso-user", "mapped-user", [])).toBe("mapped-user");
    expect(chooseDataUserId("sso-user", null, ["legacy-user"])).toBe(
      "legacy-user",
    );
    expect(chooseDataUserId("sso-user", null, ["legacy-a", "legacy-b"])).toBe(
      "sso-user",
    );
  });

  it("returns a diagnosable error when SSO is not configured", async () => {
    const { ssoClientSecret: _unused, ...env } = configuredEnv;
    const app = createTestApp(env);
    await registerOidcAuthRoutes(app, {
      env,
      identities: {
        resolve: async () => "00000000-0000-4000-8000-000000000001",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/oidc/start",
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "sso_not_configured" });
  });

  it("starts a PKCE authorization request with refresh-capable SSO scopes", async () => {
    const app = createTestApp(configuredEnv);
    await registerOidcAuthRoutes(app, {
      env: configuredEnv,
      identities: {
        resolve: async () => "00000000-0000-4000-8000-000000000001",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/auth/oidc/start?returnTo=%2Fpricing",
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain(
      "scope=openid+profile+email+offline_access",
    );
    expect(response.headers.location).toContain("code_challenge_method=S256");
    expect(response.headers.location).toContain(
      "redirect_uri=https%3A%2F%2Flovart.example.test%2Fauth%2Fcallback",
    );
    expect(response.headers["set-cookie"]).toContain("lovart_oidc_pkce=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Secure");
    expect(response.headers["set-cookie"]).toContain("SameSite=None");
  });

  it("falls back to home when a returnTo value would exceed the PKCE cookie budget", async () => {
    const app = createTestApp(configuredEnv);
    await registerOidcAuthRoutes(app, {
      env: configuredEnv,
      identities: {
        resolve: async () => "00000000-0000-4000-8000-000000000001",
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/auth/oidc/start?returnTo=%2F${"a".repeat(2_048)}`,
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers["set-cookie"]).toContain("lovart_oidc_pkce=");
    const encodedTransaction = String(response.headers["set-cookie"])
      .split(";")[0]
      ?.split("=", 2)[1];
    expect(encodedTransaction).toBeDefined();
    if (!encodedTransaction) throw new Error("missing PKCE transaction cookie");
    const transaction = JSON.parse(
      Buffer.from(encodedTransaction, "base64url").toString("utf8"),
    ) as { returnTo: string };
    expect(transaction.returnTo).toBe("/home");
  });

  it("forwards only an allowlisted locale hint to the SSO authorization endpoint", async () => {
    const app = createTestApp(configuredEnv);
    await registerOidcAuthRoutes(app, {
      env: configuredEnv,
      identities: {
        resolve: async () => "00000000-0000-4000-8000-000000000001",
      },
    });

    const allowed = await app.inject({
      method: "GET",
      url: "/api/auth/oidc/start?uiLocale=en",
    });
    const rejected = await app.inject({
      method: "GET",
      url: "/api/auth/oidc/start?uiLocale=fr",
    });

    expect(allowed.headers.location).toContain("ui_locales=en");
    expect(rejected.headers.location).not.toContain("ui_locales=");
  });

  it("returns a support-safe request ID when the callback transaction is invalid", async () => {
    const app = createTestApp(configuredEnv);
    await registerOidcAuthRoutes(app, {
      env: configuredEnv,
      identities: {
        resolve: async () => "00000000-0000-4000-8000-000000000001",
      },
    });

    const response = await app.inject({
      method: "POST",
      payload: { code: "authorization-code", state: "missing-cookie-state" },
      url: "/api/auth/oidc/exchange",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "invalid_callback",
      requestId: expect.any(String),
    });
    expect(response.headers["x-request-id"]).toBe(response.json().requestId);
  });

  it("uses an HttpOnly ID token hint for standards-compliant global SSO logout", async () => {
    const app = createTestApp(configuredEnv);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    );
    await registerOidcAuthRoutes(app, {
      env: configuredEnv,
      identities: {
        resolve: async () => "00000000-0000-4000-8000-000000000001",
      },
    });

    const response = await app.inject({
      headers: {
        cookie:
          "lovart_oidc_refresh=refresh-token; lovart_oidc_id=id-token-hint",
      },
      method: "POST",
      url: "/api/auth/oidc/logout",
    });
    const body = response.json() as { logoutUrl: string };

    expect(response.statusCode).toBe(200);
    expect(body.logoutUrl).toContain(
      "post_logout_redirect_uri=https%3A%2F%2Flovart.example.test%2F%3Fsigned_out%3D1",
    );
    expect(body.logoutUrl).toContain("id_token_hint=id-token-hint");
    const cookies = Array.isArray(response.headers["set-cookie"])
      ? response.headers["set-cookie"].join("\n")
      : response.headers["set-cookie"];
    expect(cookies).toContain("Max-Age=0");
    expect(cookies).toContain("lovart_oidc_id=");
    expect(cookies).toContain("lovart_oidc_id=; Max-Age=0");
  });

  it("keeps logout local when no ID token hint is available", async () => {
    const app = createTestApp(configuredEnv);
    await registerOidcAuthRoutes(app, {
      env: configuredEnv,
      identities: {
        resolve: async () => "00000000-0000-4000-8000-000000000001",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/auth/oidc/logout",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ logoutUrl: null });
  });
});
