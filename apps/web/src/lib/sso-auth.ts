export type SsoSession = {
  access_token: string;
  expires_at: number;
  tenant_context?: SsoTenantTeamContext;
  user: {
    email: string;
    id: string;
    user_metadata: Record<string, unknown>;
  };
};

export type SsoTenantTeamContext = {
  tenant: { id: string; name: string; slug: string };
  teams: Array<{ id: string; name: string; role: string }>;
};

type OidcSessionResponse = {
  accessToken?: unknown;
  error?: unknown;
  expiresAt?: unknown;
  logoutUrl?: unknown;
  requestId?: unknown;
  returnTo?: unknown;
  tenantContext?: unknown;
  user?: { email?: unknown; id?: unknown; userMetadata?: unknown };
};

const OIDC_API_BASE = "/api/auth/oidc";
const PENDING_RETURN_TO_KEY = "lovart.dofe:sso-return-to";
const MAX_RETURN_TO_LENGTH = 2_048;
export const SSO_UI_LOCALES = ["zh-CN", "en"] as const;
export type SsoUiLocale = (typeof SSO_UI_LOCALES)[number];

export class SsoExchangeError extends Error {
  readonly requestId: string | undefined;

  constructor(message: string, requestId?: string) {
    super(message);
    this.name = "SsoExchangeError";
    this.requestId = requestId;
  }
}

/**
 * A refresh failure is not proof that the user has signed out. Callers keep
 * the current session and offer recovery when SSO or the local API is down.
 */
export class SsoSessionRefreshError extends Error {
  readonly requestId: string | undefined;

  constructor(message: string, requestId?: string) {
    super(message);
    this.name = "SsoSessionRefreshError";
    this.requestId = requestId;
  }
}

/**
 * Creates the only browser-facing entry point for DoFe identity. The API still
 * validates the destination before it writes the PKCE transaction cookie.
 */
export function buildSsoStartHref(
  returnTo = "/home",
  uiLocale?: SsoUiLocale,
): string {
  const safePath = isSafeReturnTo(returnTo) ? returnTo : "/home";
  const params = new URLSearchParams({ returnTo: safePath });
  if (uiLocale) params.set("uiLocale", uiLocale);
  return `${OIDC_API_BASE}/start?${params.toString()}`;
}

/** Preserves the complete in-app destination before an authentication redirect. */
export function getCurrentReturnTo(
  pathname: string,
  search = "",
  hash = "",
): string {
  const destination = `${pathname}${search}${hash}`;
  return isSafeReturnTo(destination) ? destination : "/home";
}

/** Reads the current browser location without making route components parse it independently. */
export function getBrowserReturnTo(): string {
  if (typeof window === "undefined") return "/home";
  return getCurrentReturnTo(
    window.location.pathname,
    window.location.search,
    window.location.hash,
  );
}

export function beginSsoLogin(returnTo = "/home"): void {
  const safePath = rememberSsoReturnTo(returnTo);
  window.location.assign(buildSsoStartHref(safePath, getBrowserSsoUiLocale()));
}

/** Replaces a protected, unauthenticated history entry before entering SSO. */
export function replaceWithSsoLogin(returnTo = "/home"): void {
  const safePath = rememberSsoReturnTo(returnTo);
  window.location.replace(buildSsoStartHref(safePath, getBrowserSsoUiLocale()));
}

/** Records a same-tab public entry so a cancelled SSO flow can retry in place. */
export function rememberSsoReturnTo(returnTo = "/home"): string {
  const safePath = isSafeReturnTo(returnTo) ? returnTo : "/home";
  rememberPendingSsoReturnTo(safePath);
  return safePath;
}

/** Maps browser language ranges to the SSO contract's exact locale values. */
export function getBrowserSsoUiLocale(): SsoUiLocale {
  if (typeof navigator === "undefined") return "zh-CN";
  const candidates = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  return selectSsoUiLocale(candidates);
}

/** Selects the first browser language represented by the SSO's exact locale set. */
export function selectSsoUiLocale(candidates: readonly string[]): SsoUiLocale {
  for (const locale of candidates) {
    const language = locale.toLowerCase();
    if (language.startsWith("zh")) return "zh-CN";
    if (language.startsWith("en")) return "en";
  }
  return "zh-CN";
}

/** Returns the explicitly configured SSO account centre URL, never derived from API URLs. */
export function getSsoAccountUrl(
  value = process.env.NEXT_PUBLIC_SSO_ACCOUNT_URL,
): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Returns the last same-tab, same-origin destination for a recoverable retry. */
export function getPendingSsoReturnTo(): string {
  if (typeof window === "undefined") return "/home";
  try {
    const value = window.sessionStorage.getItem(PENDING_RETURN_TO_KEY);
    return value && isSafeReturnTo(value) ? value : "/home";
  } catch {
    return "/home";
  }
}

export function clearPendingSsoReturnTo(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PENDING_RETURN_TO_KEY);
  } catch {
    // Storage access can be disabled; the server-side returnTo remains authoritative.
  }
}

function rememberPendingSsoReturnTo(returnTo: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(PENDING_RETURN_TO_KEY, returnTo);
  } catch {
    // Storage access can be disabled; retry safely falls back to /home.
  }
}

export async function exchangeSsoCode(
  code: string,
  state: string,
): Promise<{ returnTo: string; session: SsoSession }> {
  const response = await fetch(`${OIDC_API_BASE}/exchange`, {
    body: JSON.stringify({ code, state }),
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return parseSessionResponse(response, true);
}

export async function refreshSsoSession(): Promise<SsoSession | null> {
  let response: Response;
  try {
    response = await fetch(`${OIDC_API_BASE}/refresh`, {
      credentials: "same-origin",
      method: "POST",
    });
  } catch {
    throw new SsoSessionRefreshError("service_unavailable");
  }

  if (response.status === 401) return null;
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as OidcSessionResponse | null;
    throw new SsoSessionRefreshError(
      response.status >= 500 || body?.error === "sso_not_configured"
        ? "service_unavailable"
        : "session_refresh_failed",
      typeof body?.requestId === "string" ? body.requestId : undefined,
    );
  }
  return (await parseSessionResponse(response, false)).session;
}

export async function signOutFromSso(): Promise<string | null> {
  try {
    const response = await fetch(`${OIDC_API_BASE}/logout`, {
      credentials: "same-origin",
      method: "POST",
    });
    const body = (await response
      .json()
      .catch(() => null)) as OidcSessionResponse | null;
    return typeof body?.logoutUrl === "string"
      ? getSafeSsoLogoutUrl(body.logoutUrl)
      : null;
  } catch {
    return null;
  }
}

/**
 * Accept only the standards-based global logout URL constructed by this RP.
 * The Fastify response remains authoritative; this prevents a malformed
 * response from turning browser logout into an arbitrary external redirect.
 */
export function getSafeSsoLogoutUrl(
  value: string,
  currentOrigin = typeof window === "undefined" ? "" : window.location.origin,
): string | null {
  if (!currentOrigin) return null;
  try {
    const url = new URL(value);
    if (
      (url.protocol !== "https:" && url.protocol !== "http:") ||
      url.username ||
      url.password ||
      !url.pathname.endsWith("/oauth/logout")
    ) {
      return null;
    }
    const expectedReturnTo = `${currentOrigin.replace(/\/+$/, "")}/?signed_out=1`;
    if (url.searchParams.get("post_logout_redirect_uri") !== expectedReturnTo) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

async function parseSessionResponse(
  response: Response,
  includesReturnTo: boolean,
): Promise<{ returnTo: string; session: SsoSession }> {
  const body = (await response
    .json()
    .catch(() => null)) as OidcSessionResponse | null;
  if (!response.ok) {
    throw new SsoExchangeError(
      typeof body?.error === "string" ? body.error : "authentication_failed",
      typeof body?.requestId === "string" ? body.requestId : undefined,
    );
  }
  if (
    typeof body?.accessToken !== "string" ||
    typeof body.expiresAt !== "number" ||
    typeof body.user?.id !== "string" ||
    typeof body.user.email !== "string"
  ) {
    throw new Error("invalid_session_response");
  }
  const tenantContext = parseTenantContext(body.tenantContext);
  return {
    returnTo:
      includesReturnTo &&
      typeof body.returnTo === "string" &&
      isSafeReturnTo(body.returnTo)
        ? body.returnTo
        : "/home",
    session: {
      access_token: body.accessToken,
      expires_at: body.expiresAt,
      ...(tenantContext ? { tenant_context: tenantContext } : {}),
      user: {
        email: body.user.email,
        id: body.user.id,
        user_metadata:
          body.user.userMetadata && typeof body.user.userMetadata === "object"
            ? (body.user.userMetadata as Record<string, unknown>)
            : {},
      },
    },
  };
}

function parseTenantContext(value: unknown): SsoTenantTeamContext | undefined {
  if (
    !isRecord(value) ||
    !isRecord(value.tenant) ||
    !Array.isArray(value.teams)
  ) {
    return undefined;
  }
  const tenant = value.tenant;
  if (
    typeof tenant.id !== "string" ||
    typeof tenant.name !== "string" ||
    typeof tenant.slug !== "string"
  ) {
    return undefined;
  }
  const teams = value.teams
    .filter(isRecord)
    .filter(
      (team) =>
        typeof team.id === "string" &&
        typeof team.name === "string" &&
        typeof team.role === "string",
    )
    .map((team) => ({
      id: team.id as string,
      name: team.name as string,
      role: team.role as string,
    }));
  return {
    tenant: { id: tenant.id, name: tenant.name, slug: tenant.slug },
    teams,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isSafeReturnTo(value: string): boolean {
  return (
    value.length <= MAX_RETURN_TO_LENGTH &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
  );
}
