import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { ServerEnv } from "../config/env.js";
import type { SsoIdentityRepository } from "../database/sso-identity-repository.js";
import { ssoProfileEmail } from "../sso-identity-email.js";
import {
  type SsoTenantTeamContext,
  fetchSsoTenantTeamContext,
} from "../sso-tenant-context.js";
import type { CredentialsService } from "../features/credentials/credentials-service.js";

const PKCE_COOKIE = "lovart_oidc_pkce";
const REFRESH_COOKIE = "lovart_oidc_refresh";
const OIDC_TIMEOUT_MS = 10_000;
const PKCE_MAX_AGE_SECONDS = 10 * 60;
const REFRESH_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

type PkceState = {
  codeVerifier: string;
  nonce: string;
  returnTo: string;
  state: string;
};

type SsoTokenResponse = {
  access_token?: string;
  expires_in?: number;
  id_token?: string;
  refresh_token?: string;
  token_type?: string;
};

type SsoIdentity = {
  avatarUrl?: string;
  email?: string;
  id: string;
  name?: string;
};

type BrowserSession = {
  accessToken: string;
  expiresAt: number;
  returnTo?: string;
  tenantContext?: SsoTenantTeamContext;
  user: {
    email: string;
    id: string;
    userMetadata: Record<string, unknown>;
  };
};

/** Pure continuity policy, retained for migration diagnostics and unit tests. */
export function chooseDataUserId(
  ssoUserId: string,
  mappedDataUserId: string | null,
  legacyCandidateIds: string[],
): string {
  return (
    mappedDataUserId ??
    (legacyCandidateIds.length === 1
      ? (legacyCandidateIds[0] ?? ssoUserId)
      : ssoUserId)
  );
}

export async function registerOidcAuthRoutes(
  app: FastifyInstance,
  options: {
    env: ServerEnv;
    identities: SsoIdentityRepository;
    credentialsService?: CredentialsService;
  },
) {
  const config = tryLoadOidcConfig(options.env);
  const remoteJwks = config
    ? createRemoteJWKSet(new URL(config.jwksUri))
    : null;
  if (config) {
    app.log.info(
      {
        clientId: config.clientId,
        issuer: config.issuer,
        redirectUri: config.redirectUri,
      },
      "oidc_auth_configured",
    );
  } else {
    app.log.warn("oidc_auth_not_configured");
  }

  app.get("/api/auth/oidc/start", async (request, reply) => {
    if (!config) return sendSsoNotConfigured(reply);
    const returnTo = safeReturnTo(
      (request.query as { returnTo?: string }).returnTo,
    );
    const state = randomUrlValue(32);
    const nonce = randomUrlValue(32);
    const codeVerifier = randomUrlValue(64);
    const codeChallenge = await sha256Base64Url(codeVerifier);
    const authorizationUrl = new URL(
      "oauth/authorize",
      withTrailingSlash(config.apiUrl),
    );

    authorizationUrl.searchParams.set("client_id", config.clientId);
    authorizationUrl.searchParams.set("redirect_uri", config.redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set(
      "scope",
      "openid profile email offline_access",
    );
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    setCookie(
      reply,
      PKCE_COOKIE,
      encodeCookieValue({ codeVerifier, nonce, returnTo, state }),
      {
        httpOnly: true,
        maxAge: PKCE_MAX_AGE_SECONDS,
        path: "/api/auth/oidc/exchange",
        sameSite: "None",
        secure: isSecureCookieRequired(options.env.webOrigin),
      },
    );
    request.log.info(
      { entryRoute: routeOnly(returnTo) },
      "oidc_authorization_started",
    );
    return reply.redirect(authorizationUrl.toString(), 302);
  });

  app.post("/api/auth/oidc/exchange", async (request, reply) => {
    if (!config || !remoteJwks) return sendSsoNotConfigured(reply);
    const body = request.body as
      | { code?: unknown; state?: unknown }
      | undefined;
    const code = typeof body?.code === "string" ? body.code : "";
    const state = typeof body?.state === "string" ? body.state : "";
    const pkce = decodeCookieValue<PkceState>(readCookie(request, PKCE_COOKIE));
    clearCookie(
      reply,
      PKCE_COOKIE,
      "/api/auth/oidc/exchange",
      options.env.webOrigin,
      "None",
    );

    if (!code || !pkce || !constantTimeEqual(state, pkce.state)) {
      request.log.warn(
        { hasCode: Boolean(code), hasState: Boolean(state) },
        "oidc_callback_rejected",
      );
      return reply.code(400).send({ error: "invalid_callback" });
    }

    try {
      const tokens = await exchangeToken(config, {
        code,
        code_verifier: pkce.codeVerifier,
        grant_type: "authorization_code",
      });
      const identity = await resolveIdentity(
        tokens,
        config,
        remoteJwks,
        pkce.nonce,
      );
      const session = await createDataSession(
        identity,
        tokens,
        options.identities,
        config,
        options.credentialsService,
      );

      if (tokens.refresh_token) {
        setCookie(reply, REFRESH_COOKIE, tokens.refresh_token, {
          httpOnly: true,
          maxAge: REFRESH_MAX_AGE_SECONDS,
          path: "/api/auth/oidc",
          secure: isSecureCookieRequired(options.env.webOrigin),
        });
      }

      request.log.info(
        {
          hasTenantContext: Boolean(session.tenantContext),
          userIdHash: hashIdentityId(identity.id),
        },
        "oidc_exchange_completed",
      );
      return reply.code(200).send({ ...session, returnTo: pkce.returnTo });
    } catch {
      request.log.warn(
        { failureCategory: "token_or_identity_validation" },
        "oidc_exchange_failed",
      );
      return reply
        .code(401)
        .send({ error: "authentication_failed", requestId: request.id });
    }
  });

  app.post("/api/auth/oidc/refresh", async (request, reply) => {
    if (!config || !remoteJwks) return sendSsoNotConfigured(reply);
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    if (!refreshToken) {
      return reply.code(401).send({ error: "session_expired" });
    }

    try {
      const tokens = await exchangeToken(config, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      });
      const identity = await resolveIdentity(tokens, config, remoteJwks);
      const session = await createDataSession(
        identity,
        tokens,
        options.identities,
        config,
        options.credentialsService,
      );
      if (tokens.refresh_token) {
        setCookie(reply, REFRESH_COOKIE, tokens.refresh_token, {
          httpOnly: true,
          maxAge: REFRESH_MAX_AGE_SECONDS,
          path: "/api/auth/oidc",
          secure: isSecureCookieRequired(options.env.webOrigin),
        });
      }

      request.log.info(
        { userIdHash: hashIdentityId(identity.id) },
        "oidc_session_refreshed",
      );
      return reply.code(200).send(session);
    } catch {
      clearCookie(
        reply,
        REFRESH_COOKIE,
        "/api/auth/oidc",
        options.env.webOrigin,
      );
      request.log.warn(
        { failureCategory: "token_or_identity_validation" },
        "oidc_refresh_failed",
      );
      return reply.code(401).send({ error: "session_expired" });
    }
  });

  app.post("/api/auth/oidc/logout", async (request, reply) => {
    if (!config) return sendSsoNotConfigured(reply);
    const refreshToken = readCookie(request, REFRESH_COOKIE);
    clearCookie(reply, REFRESH_COOKIE, "/api/auth/oidc", options.env.webOrigin);

    if (refreshToken) {
      try {
        await revokeToken(config, refreshToken);
      } catch {
        request.log.warn(
          { failureCategory: "revocation_failed" },
          "oidc_revocation_failed",
        );
      }
    }

    const logoutUrl = new URL("oauth/logout", withTrailingSlash(config.apiUrl));
    logoutUrl.searchParams.set(
      "post_logout_redirect_uri",
      `${options.env.webOrigin.replace(/\/+$/, "")}/?signed_out=1`,
    );
    request.log.info(
      { revocationAttempted: Boolean(refreshToken) },
      "oidc_logout_completed",
    );
    return reply.code(200).send({ logoutUrl: logoutUrl.toString() });
  });
}

function tryLoadOidcConfig(env: ServerEnv) {
  if (
    !env.ssoApiUrl ||
    !env.ssoClientId ||
    !env.ssoClientSecret ||
    !env.ssoIssuer ||
    !env.ssoJwksUri ||
    !env.ssoRedirectUri
  )
    return null;
  return {
    apiUrl: env.ssoApiUrl,
    clientId: env.ssoClientId,
    clientSecret: env.ssoClientSecret,
    internalApiSecret: env.internalApiSecret,
    issuer: env.ssoIssuer,
    internalApiUrl: env.ssoInternalApiUrl ?? env.ssoApiUrl,
    jwksUri: env.ssoInternalJwksUri ?? env.ssoJwksUri,
    redirectUri: env.ssoRedirectUri,
  };
}

type OidcConfig = NonNullable<ReturnType<typeof tryLoadOidcConfig>>;

function sendSsoNotConfigured(reply: FastifyReply) {
  return reply.code(503).send({ error: "sso_not_configured" });
}

async function exchangeToken(
  config: OidcConfig,
  parameters: Record<string, string>,
): Promise<SsoTokenResponse> {
  const response = await fetch(
    new URL("oauth/token", withTrailingSlash(config.internalApiUrl)),
    {
      body: new URLSearchParams({ ...parameters, client_id: config.clientId }),
      headers: {
        authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      signal: AbortSignal.timeout(OIDC_TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new Error(`SSO token exchange returned ${response.status}`);

  const tokens = (await response.json()) as SsoTokenResponse;
  if (
    !tokens.access_token ||
    !tokens.token_type?.toLowerCase().includes("bearer")
  ) {
    throw new Error("SSO token response did not contain a bearer access token");
  }
  return tokens;
}

async function resolveIdentity(
  tokens: SsoTokenResponse,
  config: OidcConfig,
  remoteJwks: ReturnType<typeof createRemoteJWKSet>,
  nonce?: string,
): Promise<SsoIdentity> {
  if (tokens.id_token) {
    const { payload } = await jwtVerify(tokens.id_token, remoteJwks, {
      audience: config.clientId,
      issuer: config.issuer,
    });
    // jose verifies registered claims. OIDC nonce is an additional RP claim.
    if (nonce && (payload as Record<string, unknown>).nonce !== nonce) {
      throw new Error(
        "SSO ID token nonce did not match the authorization request",
      );
    }
    const email = typeof payload.email === "string" ? payload.email : undefined;
    if (typeof payload.sub === "string") {
      return {
        ...(email ? { email } : {}),
        id: payload.sub,
        ...(typeof payload.picture === "string"
          ? { avatarUrl: payload.picture }
          : {}),
        ...(typeof payload.name === "string"
          ? { name: payload.name }
          : typeof payload.nickname === "string"
            ? { name: payload.nickname }
            : {}),
      };
    }
  }

  const response = await fetch(
    new URL("oauth/userinfo", withTrailingSlash(config.internalApiUrl)),
    {
      headers: { authorization: `Bearer ${tokens.access_token}` },
      signal: AbortSignal.timeout(OIDC_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error(`SSO userinfo returned ${response.status}`);
  const userinfo = (await response.json()) as Record<string, unknown>;
  if (typeof userinfo.sub !== "string") {
    throw new Error("SSO userinfo did not contain sub");
  }
  return {
    ...(typeof userinfo.email === "string" ? { email: userinfo.email } : {}),
    id: userinfo.sub,
    ...(typeof userinfo.picture === "string"
      ? { avatarUrl: userinfo.picture }
      : {}),
    ...(typeof userinfo.name === "string" ? { name: userinfo.name } : {}),
  };
}

async function createDataSession(
  identity: SsoIdentity,
  tokens: SsoTokenResponse,
  identities: SsoIdentityRepository,
  config: OidcConfig,
  credentialsService?: CredentialsService,
): Promise<BrowserSession> {
  if (!isUuid(identity.id))
    throw new Error("SSO subject must be a UUID for the current data schema");
  if (!tokens.access_token)
    throw new Error("SSO token response did not contain an access token");
  const email = ssoProfileEmail(identity.id, identity.email);
  const [dataUserId, tenantContext] = await Promise.all([
    identities.resolve({
      ...(identity.email ? { email: identity.email } : {}),
      ssoUserId: identity.id,
    }),
    fetchSsoTenantTeamContext({
      internalApiUrl: config.internalApiUrl,
      userId: identity.id,
      ...(config.internalApiSecret
        ? { internalApiSecret: config.internalApiSecret }
        : {}),
    }).catch(() => undefined),
  ]);

  // Provision per-user models credentials. The OIDC path is the only one that
  // carries the real SSO team id, so it owns first-time provisioning;
  // ensureViewer handles retries on later requests. Fire-and-forget so a models
  // outage never blocks login.
  const ssoTeamId = tenantContext?.teams?.[0]?.id;
  if (credentialsService && ssoTeamId) {
    void credentialsService
      .ensureProvisioned({
        userId: dataUserId,
        ssoUserId: identity.id,
        ssoTeamId,
      })
      .catch(() => {
        /* provisioning failures are logged inside ensureProvisioned */
      });
  }

  return {
    accessToken: tokens.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + (tokens.expires_in ?? 300),
    user: {
      email,
      id: dataUserId,
      userMetadata: {
        ...(identity.avatarUrl ? { avatar_url: identity.avatarUrl } : {}),
        ...(identity.name ? { name: identity.name } : {}),
      },
    },
    ...(tenantContext ? { tenantContext } : {}),
  };
}

async function revokeToken(config: OidcConfig, token: string) {
  await fetch(
    new URL("oauth/revoke", withTrailingSlash(config.internalApiUrl)),
    {
      body: new URLSearchParams({ client_id: config.clientId, token }),
      headers: {
        authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      method: "POST",
      signal: AbortSignal.timeout(OIDC_TIMEOUT_MS),
    },
  );
}

function withTrailingSlash(url: string) {
  return `${url.replace(/\/+$/, "")}/`;
}

function safeReturnTo(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  )
    return "/home";
  return value;
}

function routeOnly(returnTo: string): string {
  return returnTo.split(/[?#]/, 1)[0] ?? "/home";
}

function hashIdentityId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function randomUrlValue(bytes: number): string {
  return randomBytes(bytes).toString("base64url");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Buffer.from(digest).toString("base64url");
}

function encodeCookieValue(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCookieValue<T>(value: string | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function readCookie(request: FastifyRequest, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function setCookie(
  reply: FastifyReply,
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    maxAge: number;
    path: string;
    sameSite?: "Lax" | "None";
    secure: boolean;
  },
) {
  const parts = [
    `${name}=${value}`,
    `Max-Age=${options.maxAge}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite ?? "Lax"}`,
  ];
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  reply.header("set-cookie", parts.join("; "));
}

function clearCookie(
  reply: FastifyReply,
  name: string,
  path: string,
  webOrigin: string,
  sameSite: "Lax" | "None" = "Lax",
) {
  setCookie(reply, name, "", {
    httpOnly: true,
    maxAge: 0,
    path,
    sameSite,
    secure: isSecureCookieRequired(webOrigin),
  });
}

function isSecureCookieRequired(webOrigin: string): boolean {
  return webOrigin.startsWith("https://");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1)
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return result === 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
