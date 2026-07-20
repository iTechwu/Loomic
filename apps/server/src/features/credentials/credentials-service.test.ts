import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProvisionLockResult,
  UserCredentialRow,
  UserCredentialsRepository,
} from "./credentials-repository.js";
import { createCredentialsService } from "./credentials-service.js";
import { provisionSeedanceCredentials } from "./models-client.js";

vi.mock("./models-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models-client.js")>()),
  provisionSeedanceCredentials: vi.fn(),
}));

const LOCAL_USER_ID = "00000000-0000-4000-8000-000000000010";
const SSO_USER_ID = "00000000-0000-4000-8000-000000000011";
const TEAM_ID = "00000000-0000-4000-8000-000000000012";

function readyRow(overrides?: Partial<UserCredentialRow>): UserCredentialRow {
  return {
    id: "credential-row",
    userId: LOCAL_USER_ID,
    ssoUserId: SSO_USER_ID,
    ssoTeamId: TEAM_ID,
    modelsApiKeyId: "api-key-id",
    modelsKeyPrefix: "sk-test",
    apikeyCiphertext: "enc:sk-secret",
    modelsCredentialId: "asset-id",
    accessKeyId: "AKtest",
    secretAccessKeyCiphertext: "enc:AKSKsecret",
    provisionState: "ready",
    provisioningStartedAt: null,
    provisionAttemptCount: 0,
    lastProvisionError: null,
    ...overrides,
  };
}

function makeRepository(initial: {
  lock: ProvisionLockResult;
  ready?: UserCredentialRow | null;
}): UserCredentialsRepository & {
  setLock: (lock: ProvisionLockResult) => void;
  saveReadyCalls: number;
  saveFailedCalls: number;
} {
  let current = initial.lock;
  let savedReady: UserCredentialRow | null = initial.ready ?? null;
  let saveReadyCalls = 0;
  let saveFailedCalls = 0;
  return {
    findReady: vi.fn(async () => savedReady),
    findAny: vi.fn(async () => savedReady ?? current.row),
    takeProvisionLock: vi.fn(async () => current),
    saveReady: vi.fn(async (input) => {
      saveReadyCalls += 1;
      savedReady = readyRow({
        modelsApiKeyId: input.modelsApiKeyId,
        modelsKeyPrefix: input.modelsKeyPrefix,
        apikeyCiphertext: input.apikeyCiphertext,
        secretAccessKeyCiphertext: input.secretAccessKeyCiphertext,
        accessKeyId: input.accessKeyId,
        modelsCredentialId: input.modelsCredentialId,
        ssoUserId: input.ssoUserId,
        ssoTeamId: input.ssoTeamId,
      });
      current = { status: "ready", row: savedReady };
    }),
    saveFailed: vi.fn(async () => {
      saveFailedCalls += 1;
    }),
    setLock: (lock) => {
      current = lock;
    },
    get saveReadyCalls() {
      return saveReadyCalls;
    },
    get saveFailedCalls() {
      return saveFailedCalls;
    },
  } as UserCredentialsRepository & {
    setLock: (lock: ProvisionLockResult) => void;
    saveReadyCalls: number;
    saveFailedCalls: number;
  };
}

function makeService(repository: UserCredentialsRepository) {
  return createCredentialsService({
    repository,
    crypto: {
      enabled: true,
      encrypt: (value) => `enc:${value}`,
      decrypt: (value) => value.slice(4),
    },
    provisionConfig: {
      baseUrl: "https://ixicai.cn/api",
      serviceName: "lovart.dofe.ai",
      internalApiSecret: "test-secret",
    },
  });
}

describe("CredentialsService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("provisions Models on first call and reuses the ready lock on the second", async () => {
    const repository = makeRepository({
      lock: {
        status: "locked",
        row: readyRow({
          provisionState: "provisioning",
          apikeyCiphertext: null,
          secretAccessKeyCiphertext: null,
          modelsApiKeyId: null,
          provisionAttemptCount: 1,
        }),
      },
    });
    vi.mocked(provisionSeedanceCredentials).mockResolvedValue({
      apiKey: { id: "api-key-id", keyPrefix: "sk-test", apiKey: "sk-secret" },
      assetCredential: {
        id: "asset-id",
        accessKeyId: "AKtest",
        secretAccessKey: "AKSKsecret",
      },
    });
    const service = makeService(repository);

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
      expect.objectContaining({
        userId: SSO_USER_ID,
        ssoTeamId: TEAM_ID,
        correlationId: expect.any(String),
      }),
    );
    await expect(service.getByUserId(LOCAL_USER_ID)).resolves.toMatchObject({
      designApiKey: "sk-secret",
      seedanceSecretAccessKey: "AKSKsecret",
    });
  });

  it("skips the remote call when another caller is already in flight", async () => {
    const repository = makeRepository({
      lock: {
        status: "in_flight",
        row: readyRow({
          provisionState: "provisioning",
          provisionAttemptCount: 1,
          provisioningStartedAt: new Date(),
        }),
      },
    });
    vi.mocked(provisionSeedanceCredentials).mockResolvedValue({
      apiKey: { id: "akid", keyPrefix: "sk-test", apiKey: "sk-secret" },
      assetCredential: {
        id: "acid",
        accessKeyId: "AKtest",
        secretAccessKey: "AKSKsecret",
      },
    });
    const service = makeService(repository);

    await service.ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });

    expect(provisionSeedanceCredentials).not.toHaveBeenCalled();
  });

  it("records a sanitized failure and retries on the next call", async () => {
    const repository = makeRepository({
      lock: {
        status: "locked",
        row: readyRow({
          provisionState: "provisioning",
          provisionAttemptCount: 1,
          apikeyCiphertext: null,
        }),
      },
    });
    vi.mocked(provisionSeedanceCredentials).mockRejectedValueOnce(
      Object.assign(new Error("provision HTTP 503"), {
        status: 503,
        code: "http",
      }),
    );
    vi.mocked(provisionSeedanceCredentials).mockResolvedValueOnce({
      apiKey: { id: "akid", keyPrefix: "sk-test", apiKey: "sk-secret" },
      assetCredential: {
        id: "acid",
        accessKeyId: "AKtest",
        secretAccessKey: "AKSKsecret",
      },
    });
    const service = makeService(repository);

    await service.ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });
    expect(repository.saveFailed).toHaveBeenCalledTimes(1);
    const failure = vi.mocked(repository.saveFailed).mock.calls[0];
    if (!failure) throw new Error("expected saveFailed to have been called");
    // The persisted error must not leak response body or secrets — only the
    // classification and a correlation handle.
    expect(failure[2]).toMatch(/models provision http \(5xx\) corr=/);

    // Second attempt: lock returns locked again, provision succeeds.
    repository.setLock({
      status: "locked",
      row: readyRow({
        provisionState: "provisioning",
        provisionAttemptCount: 2,
        apikeyCiphertext: null,
      }),
    });
    await service.ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });
    expect(provisionSeedanceCredentials).toHaveBeenCalledTimes(2);
    await expect(service.getByUserId(LOCAL_USER_ID)).resolves.toMatchObject({
      designApiKey: "sk-secret",
    });
  });

  it("does not fall back when credentials are not ready", async () => {
    const repository = makeRepository({
      lock: {
        status: "locked",
        row: readyRow({
          provisionState: "provisioning",
          apikeyCiphertext: null,
          provisionAttemptCount: 1,
        }),
      },
      ready: null,
    });
    const service = makeService(repository);
    await expect(service.getByUserId(LOCAL_USER_ID)).rejects.toThrow(
      /Models credentials are not ready/,
    );
  });

  it("issues at most one remote POST under concurrent ensureProvisioned calls", async () => {
    // Simulate the real repository's concurrency contract: the first
    // takeProvisionLock wins ("locked"); any caller that arrives while the
    // remote POST is still in flight observes the provisioning row ("in_flight")
    // and returns without touching models. Once saveReady commits, subsequent
    // callers see "ready".
    let provisioning = false;
    let readyCommitted = false;
    let resolveProvision: () => void = () => {};
    const lockCalls: Array<{ userId: string; ssoTeamId: string }> = [];

    const repository: UserCredentialsRepository = {
      findReady: vi.fn(async () =>
        readyCommitted ? readyRow({ provisionAttemptCount: 0 }) : null,
      ),
      findAny: vi.fn(async () => null),
      takeProvisionLock: vi.fn(
        async ({ userId, ssoTeamId }): Promise<ProvisionLockResult> => {
          lockCalls.push({ userId, ssoTeamId });
          if (readyCommitted) {
            return {
              status: "ready",
              row: readyRow({ provisionAttemptCount: 0 }),
            };
          }
          if (provisioning) {
            return {
              status: "in_flight",
              row: readyRow({
                provisionState: "provisioning",
                provisionAttemptCount: 1,
                provisioningStartedAt: new Date(),
                apikeyCiphertext: null,
              }),
            };
          }
          provisioning = true;
          return {
            status: "locked",
            row: readyRow({
              provisionState: "provisioning",
              provisionAttemptCount: 1,
              apikeyCiphertext: null,
            }),
          };
        },
      ),
      saveReady: vi.fn(async () => {
        readyCommitted = true;
        provisioning = false;
      }),
      saveFailed: vi.fn(async () => {}),
    };

    // Hold the remote POST open until both callers have entered the service.
    vi.mocked(provisionSeedanceCredentials).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveProvision = () =>
            resolve({
              apiKey: {
                id: "akid",
                keyPrefix: "sk-test",
                apiKey: "sk-secret",
              },
              assetCredential: {
                id: "acid",
                accessKeyId: "AKtest",
                secretAccessKey: "AKSKsecret",
              },
            });
        }),
    );

    const service = makeService(repository);

    // Fire two concurrent provisions for the same user/team.
    const pending = Promise.all([
      service.ensureProvisioned({
        userId: LOCAL_USER_ID,
        ssoUserId: SSO_USER_ID,
        ssoTeamId: TEAM_ID,
      }),
      service.ensureProvisioned({
        userId: LOCAL_USER_ID,
        ssoUserId: SSO_USER_ID,
        ssoTeamId: TEAM_ID,
      }),
    ]);
    // Yield so both callers reach takeProvisionLock before the POST resolves.
    await Promise.resolve();
    await Promise.resolve();
    resolveProvision();
    await pending;

    // Both callers consulted the lock; exactly one remote POST was issued.
    expect(lockCalls).toHaveLength(2);
    expect(
      lockCalls.every(
        (c) => c.userId === LOCAL_USER_ID && c.ssoTeamId === TEAM_ID,
      ),
    ).toBe(true);
    expect(provisionSeedanceCredentials).toHaveBeenCalledTimes(1);
    expect(repository.saveReady).toHaveBeenCalledTimes(1);
  });
});
