import { describe, expect, it, vi } from "vitest";

import type { AuthenticatedUser } from "../../auth/sso-authenticator.js";
import type {
  ProvisionState,
  UserCredentialsRepository,
} from "../credentials/credentials-repository.js";
import {
  BillingServiceError,
  createBillingService,
} from "./billing-service.js";

const USER_ID = "00000000-0000-4000-8000-000000000010";
const TENANT_ID = "00000000-0000-4000-8000-000000000020";
const TEAM_ID = "00000000-0000-4000-8000-000000000030";
const API_KEY_ID = "00000000-0000-4000-8000-000000000040";

const USER: AuthenticatedUser = {
  id: USER_ID,
  tenantId: TENANT_ID,
  email: "test@example.com",
  accessToken: "token",
  userMetadata: {},
};

function makeRepository(overrides?: {
  readyTeamId?: string | null;
  apiKeyId?: string | null;
}): UserCredentialsRepository {
  return {
    findReady: vi.fn(async (_userId, ssoTeamId) =>
      ssoTeamId === overrides?.readyTeamId
        ? {
            id: "row",
            userId: USER_ID,
            ssoUserId: "sso-user",
            ssoTeamId,
            modelsApiKeyId: API_KEY_ID,
            modelsKeyPrefix: "sk-test",
            apikeyCiphertext: "enc",
            modelsCredentialId: "asset",
            accessKeyId: "AK",
            secretAccessKeyCiphertext: "enc2",
            provisionState: "ready" as ProvisionState,
            provisioningStartedAt: null,
            provisionAttemptCount: 0,
            lastProvisionError: null,
          }
        : null,
    ),
    findByApiKeyId: vi.fn(async (_userId, apiKeyId) =>
      apiKeyId === overrides?.apiKeyId
        ? {
            id: "row",
            userId: USER_ID,
            ssoUserId: "sso-user",
            ssoTeamId: TEAM_ID,
            modelsApiKeyId: apiKeyId,
            modelsKeyPrefix: "sk-test",
            apikeyCiphertext: "enc",
            modelsCredentialId: "asset",
            accessKeyId: "AK",
            secretAccessKeyCiphertext: "enc2",
            provisionState: "ready" as ProvisionState,
            provisioningStartedAt: null,
            provisionAttemptCount: 0,
            lastProvisionError: null,
          }
        : null,
    ),
    findReadyCandidates: vi.fn(),
    findAny: vi.fn(),
    takeProvisionLock: vi.fn(),
    saveReady: vi.fn(),
    saveFailed: vi.fn(),
  };
}

function makeService(repository: UserCredentialsRepository) {
  return createBillingService({
    modelsClientConfig: {
      baseUrl: "https://ixicai.cn/api",
      serviceName: "lovart.dofe.ai",
      internalApiSecret: "test-secret",
    },
    credentialsRepository: repository,
  });
}

describe("BillingService", () => {
  it("forbids team usage stats when the user has no ready row for the team", async () => {
    const service = makeService(makeRepository({ readyTeamId: null }));
    const context = service.forRequest("corr-1");

    await expect(
      context.getTeamUsageStats(USER, TEAM_ID, {}),
    ).rejects.toThrow(BillingServiceError);

    try {
      await context.getTeamUsageStats(USER, TEAM_ID, {});
    } catch (error) {
      expect((error as BillingServiceError).statusCode).toBe(403);
      expect((error as BillingServiceError).code).toBe("forbidden");
    }
  });

  it("forbids api key usage stats when the user does not own the api key", async () => {
    const service = makeService(makeRepository({ apiKeyId: null }));
    const context = service.forRequest("corr-1");

    await expect(
      context.getApiKeyUsageStats(USER, API_KEY_ID, {}),
    ).rejects.toThrow(BillingServiceError);
  });

  it("uses the user's tenant id for tenant-scoped calls", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        code: 0,
        msg: "ok",
        data: {
          accountId: TENANT_ID,
          balance: "100.00",
          reservedBalance: "10.00",
          availableBalance: "90.00",
          currency: "USD",
          status: "active",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const service = makeService(makeRepository());
    const context = service.forRequest("corr-1");

    try {
      const balance = await context.getTenantBalance(USER);
      expect(balance.accountId).toBe(TENANT_ID);
      const call = fetchMock.mock.calls[0] as unknown as [string, { headers: Record<string, string> }];
      const url = call[0];
      expect(url).toContain(`/internal/billing/accounts/by-tenant/${TENANT_ID}/balance`);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
