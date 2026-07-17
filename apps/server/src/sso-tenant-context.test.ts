import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSsoTenantTeamContext,
  parseSsoTenantTeamContext,
} from "./sso-tenant-context.js";

afterEach(() => vi.unstubAllGlobals());

describe("SSO tenant team context", () => {
  it("keeps only the primary tenant's teams from the internal SSO response", () => {
    expect(
      parseSsoTenantTeamContext({
        code: 0,
        data: [
          {
            teamId: "team-a",
            teamName: "Design",
            role: "MEMBER",
            tenantId: "tenant-a",
            tenantName: "Acme",
            tenantSlug: "acme",
          },
          {
            teamId: "team-b",
            teamName: "Engineering",
            role: "ADMIN",
            tenantId: "tenant-a",
            tenantName: "Acme",
            tenantSlug: "acme",
          },
          {
            teamId: "team-c",
            teamName: "Other",
            role: "MEMBER",
            tenantId: "tenant-c",
            tenantName: "Other",
            tenantSlug: "other",
          },
        ],
      }),
    ).toEqual({
      tenant: { id: "tenant-a", name: "Acme", slug: "acme" },
      teams: [
        { id: "team-a", name: "Design", role: "MEMBER" },
        { id: "team-b", name: "Engineering", role: "ADMIN" },
      ],
    });
  });

  it("uses the configured internal SSO endpoint and never calls it without a service secret", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ code: 0, data: [] }),
      ok: true,
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      fetchSsoTenantTeamContext({
        internalApiSecret: "internal-service-secret",
        internalApiUrl: "https://sso.example.test/api",
        userId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      new URL(
        "https://sso.example.test/api/internal/users/00000000-0000-4000-8000-000000000001/teams",
      ),
      expect.objectContaining({
        headers: expect.objectContaining({ "x-api-version": "1" }),
      }),
    );

    fetchMock.mockClear();
    await expect(
      fetchSsoTenantTeamContext({
        internalApiUrl: "https://sso.example.test/api",
        userId: "00000000-0000-4000-8000-000000000001",
      }),
    ).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
