import type { FastifyRequest } from "fastify";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { ServerEnv } from "../config/env.js";
import type { SsoIdentityRepository } from "../database/sso-identity-repository.js";

export type AuthenticatedUser = {
  accessToken: string;
  email: string;
  id: string;
  /** SSO tenant is the financial owner; fallback is the personal tenant UUID. */
  tenantId: string;
  userMetadata: Record<string, unknown>;
};

export type RequestAuthenticator = {
  authenticate(
    request: Pick<FastifyRequest, "headers">,
  ): Promise<AuthenticatedUser | null>;
};

const AUTH_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedAuth = { user: AuthenticatedUser; expiresAt: number };
const authCache = new Map<string, CachedAuth>();

function getCachedAuth(token: string): AuthenticatedUser | null {
  const entry = authCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    authCache.delete(token);
    return null;
  }
  return entry.user;
}

function setCachedAuth(token: string, user: AuthenticatedUser): void {
  authCache.set(token, { user, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });

  // Lazy eviction: remove expired entries when cache grows large
  if (authCache.size > 500) {
    const now = Date.now();
    for (const [key, val] of authCache) {
      if (now > val.expiresAt) authCache.delete(key);
    }
  }
}

/** Validates only SSO-issued bearer tokens; no TOS/CDN Auth fallback exists. */
export function createSsoRequestAuthenticator(
  env: Pick<ServerEnv, "ssoClientId" | "ssoIssuer" | "ssoJwksUri">,
  identities: SsoIdentityRepository,
): RequestAuthenticator {
  const jwks = env.ssoJwksUri ? createRemoteJWKSet(new URL(env.ssoJwksUri)) : null;

  return {
    async authenticate(request) {
      const accessToken = readBearerToken(request.headers.authorization);
      if (!accessToken || !jwks || !env.ssoIssuer || !env.ssoClientId) return null;
      const cached = getCachedAuth(accessToken);
      if (cached) return cached;
      try {
        const { payload } = await jwtVerify(accessToken, jwks, {
          audience: env.ssoClientId,
          issuer: env.ssoIssuer,
        });
        if (typeof payload.sub !== "string" || !isUuid(payload.sub) || typeof payload.email !== "string") return null;
        const metadata = isRecord(payload.user_metadata) ? payload.user_metadata : {
          ...(typeof payload.name === "string" ? { name: payload.name } : {}),
          ...(typeof payload.picture === "string" ? { avatar_url: payload.picture } : {}),
        };
        const userId = await identities.resolve({ email: payload.email, ssoUserId: payload.sub });
        const user: AuthenticatedUser = {
          accessToken,
          email: payload.email,
          id: userId,
          tenantId: resolveTenantId(metadata, payload.tenant_id, payload.tenantId, userId),
          userMetadata: metadata,
        };
        setCachedAuth(accessToken, user);
        return user;
      } catch {
        return null;
      }
    },
  };
}

function readBearerToken(
  authorizationHeader: string | string[] | undefined,
): string | null {
  if (typeof authorizationHeader !== "string") {
    return null;
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2);

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolveTenantId(
  metadata: Record<string, unknown>,
  claimSnake: unknown,
  claimCamel: unknown,
  personalTenantId: string,
): string {
  for (const value of [claimSnake, claimCamel, metadata.tenant_id, metadata.tenantId]) {
    if (typeof value === "string" && isUuid(value)) return value;
  }
  return personalTenantId;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
