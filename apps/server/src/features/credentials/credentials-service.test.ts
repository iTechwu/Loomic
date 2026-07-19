import { describe, expect, it, vi } from "vitest";

import { createCredentialsService } from "./credentials-service.js";
import type { UserCredentialRow } from "./credentials-repository.js";
import { provisionSeedanceCredentials } from "./models-client.js";

vi.mock("./models-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models-client.js")>()),
  provisionSeedanceCredentials: vi.fn(),
}));

const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000010";
const SSO_USER_ID = "00000000-0000-4000-8000-000000000011";
const TEAM_ID = "00000000-0000-4000-8000-000000000012";

describe("CredentialsService", () => {
  it("provisions Models with the SSO subject and reuses the ready tenant/team row", async () => {
    let ready: UserCredentialRow | null = null;
    const repository = {
      findReady: vi.fn(async () => ready),
      findAny: vi.fn(async () => ready),
      saveReady: vi.fn(async (input) => {
        ready = {
          id: "credential-row",
          userId: input.userId,
          ssoUserId: input.ssoUserId,
          ssoTeamId: input.ssoTeamId,
          modelsApiKeyId: input.modelsApiKeyId,
          modelsKeyPrefix: input.modelsKeyPrefix,
          apikeyCiphertext: input.apikeyCiphertext,
          modelsCredentialId: input.modelsCredentialId,
          accessKeyId: input.accessKeyId,
          secretAccessKeyCiphertext: input.secretAccessKeyCiphertext,
          provisionState: "ready" as const,
          lastProvisionError: null,
        };
      }),
      saveFailed: vi.fn(),
    };
    vi.mocked(provisionSeedanceCredentials).mockResolvedValue({
      apiKey: { id: "api-key-id", keyPrefix: "sk-test", apiKey: "sk-secret" },
      assetCredential: { id: "asset-id", accessKeyId: "AKtest", secretAccessKey: "AKSKsecret" },
    });
    const service = createCredentialsService({
      repository,
      crypto: { enabled: true, encrypt: (value) => `enc:${value}`, decrypt: (value) => value.slice(4) },
      provisionConfig: {
        baseUrl: "https://ixicai.cn/api",
        serviceName: "lovart.dofe.ai",
        internalApiSecret: "test-secret",
      },
    });

    await service.ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });
    await service.ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });

    expect(provisionSeedanceCredentials).toHaveBeenCalledTimes(1);
    expect(provisionSeedanceCredentials).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: SSO_USER_ID, ssoTeamId: TEAM_ID }),
    );
    await expect(service.getByUserId(LOCAL_USER_ID)).resolves.toMatchObject({
      designApiKey: "sk-secret",
      seedanceSecretAccessKey: "AKSKsecret",
    });
  });
});
