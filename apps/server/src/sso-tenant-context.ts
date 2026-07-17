const SSO_CONTEXT_TIMEOUT_MS = 5_000;

export type SsoTenantTeamContext = {
  tenant: {
    id: string;
    name: string;
    slug: string;
  };
  teams: Array<{
    id: string;
    name: string;
    role: string;
  }>;
};

type SsoTeamMembership = {
  teamId: string;
  teamName: string;
  role: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
};

export async function fetchSsoTenantTeamContext(options: {
  internalApiSecret?: string;
  internalApiUrl: string;
  userId: string;
}): Promise<SsoTenantTeamContext | undefined> {
  if (!options.internalApiSecret) return undefined;

  const url = new URL(
    `internal/users/${encodeURIComponent(options.userId)}/teams`,
    withTrailingSlash(options.internalApiUrl),
  );
  const response = await fetch(url, {
    headers: {
      authorization: `Bearer ${options.internalApiSecret}`,
      "x-api-version": "1",
    },
    signal: AbortSignal.timeout(SSO_CONTEXT_TIMEOUT_MS),
  });
  if (!response.ok) return undefined;

  const body = (await response.json()) as unknown;
  return parseSsoTenantTeamContext(body);
}

export function parseSsoTenantTeamContext(
  body: unknown,
): SsoTenantTeamContext | undefined {
  if (!isRecord(body) || !Array.isArray(body.data)) return undefined;

  const memberships = body.data
    .map(parseMembership)
    .filter(
      (membership): membership is SsoTeamMembership => membership !== undefined,
    );
  const primary = memberships[0];
  if (!primary) return undefined;

  return {
    tenant: {
      id: primary.tenantId,
      name: primary.tenantName,
      slug: primary.tenantSlug,
    },
    teams: memberships
      .filter((membership) => membership.tenantId === primary.tenantId)
      .map((membership) => ({
        id: membership.teamId,
        name: membership.teamName,
        role: membership.role,
      })),
  };
}

function parseMembership(value: unknown): SsoTeamMembership | undefined {
  if (!isRecord(value)) return undefined;
  const required = [
    "teamId",
    "teamName",
    "role",
    "tenantId",
    "tenantName",
    "tenantSlug",
  ];
  if (required.some((key) => typeof value[key] !== "string")) return undefined;

  return {
    teamId: value.teamId as string,
    teamName: value.teamName as string,
    role: value.role as string,
    tenantId: value.tenantId as string,
    tenantName: value.tenantName as string,
    tenantSlug: value.tenantSlug as string,
  };
}

function withTrailingSlash(url: string) {
  return `${url.replace(/\/+$/, "")}/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
