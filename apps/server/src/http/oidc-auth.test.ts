import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import type { ServerEnv } from "../config/env.js";
import { registerOidcAuthRoutes } from "./oidc-auth.js";

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
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createTestApp(env: ServerEnv) {
  const app = Fastify({ logger: false });
  apps.push(app);
  return app;
}

describe("OIDC auth routes", () => {
  it("returns a diagnosable error when SSO is not configured", async () => {
    const { ssoClientSecret: _unused, ...env } = configuredEnv;
    const app = createTestApp(env);
    await registerOidcAuthRoutes(app, { env, getAdminClient: () => null as never });

    const response = await app.inject({ method: "GET", url: "/api/auth/oidc/start" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ error: "sso_not_configured" });
  });

  it("starts a PKCE authorization request with the allowed SSO scopes", async () => {
    const app = createTestApp(configuredEnv);
    await registerOidcAuthRoutes(app, { env: configuredEnv, getAdminClient: () => null as never });

    const response = await app.inject({ method: "GET", url: "/api/auth/oidc/start?returnTo=%2Fpricing" });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain("scope=openid+profile+email");
    expect(response.headers.location).toContain("code_challenge_method=S256");
    expect(response.headers.location).toContain("redirect_uri=https%3A%2F%2Flovart.example.test%2Fauth%2Fcallback");
    expect(response.headers["set-cookie"]).toContain("lovart_oidc_pkce=");
    expect(response.headers["set-cookie"]).toContain("HttpOnly");
    expect(response.headers["set-cookie"]).toContain("Secure");
  });
});
