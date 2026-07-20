import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ProvisionLockResult,
  UserCredentialRow,
  UserCredentialsRepository,
} from "./credentials-repository.js";
import { createCredentialsService } from "./credentials-service.js";
import type { Logger } from "./models-client.js";
import {
  getSeedanceCredentialsStatus,
  provisionSeedanceCredentials,
} from "./models-client.js";

vi.mock("./models-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./models-client.js")>()),
  getSeedanceCredentialsStatus: vi.fn(),
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

function makeService(repository: UserCredentialsRepository, logger?: Logger) {
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
    ...(logger ? { logger } : {}),
  });
}

describe("CredentialsService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Most retry tests exercise normal recovery. Individual tests override
    // this baseline to cover ready, incomplete, and lookup-error outcomes.
    vi.mocked(getSeedanceCredentialsStatus).mockResolvedValue({
      state: "absent",
    });
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
    expect(getSeedanceCredentialsStatus).not.toHaveBeenCalled();
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
      new (await import("./models-client.js")).ModelsProvisionError(
        "provision HTTP 503",
        503,
        "http",
      ),
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
    expect(failure[3]).toEqual({ retainInFlight: false });

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

  it("retains the in-flight lease after a timeout to prevent an immediate replay", async () => {
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
    const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
    vi.mocked(provisionSeedanceCredentials).mockRejectedValueOnce(
      new (await import("./models-client.js")).ModelsProvisionError(
        "provision request timed out",
        0,
        "timeout",
      ),
    );

    await makeService(repository, {
      info: () => {},
      warn: (message, data = {}) => logs.push({ message, data }),
      error: () => {},
    }).ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });

    expect(repository.saveFailed).toHaveBeenCalledWith(
      LOCAL_USER_ID,
      TEAM_ID,
      expect.stringMatching(/models provision timeout \(timeout\) corr=/),
      { retainInFlight: true },
    );
    expect(JSON.stringify(logs)).toContain("models_provision_outcome_unknown");
  });

  it("reconciles a remotely ready retry before recovering secrets through idempotent provision", async () => {
    const repository = makeRepository({
      lock: {
        status: "locked",
        row: readyRow({
          provisionState: "provisioning",
          provisionAttemptCount: 2,
          apikeyCiphertext: null,
          secretAccessKeyCiphertext: null,
        }),
      },
    });
    vi.mocked(getSeedanceCredentialsStatus).mockResolvedValue({
      state: "ready",
      apiKey: { id: "akid", keyPrefix: "sk-test", status: "active" },
      assetCredential: { id: "acid", accessKeyId: "AKtest", status: "active" },
    });
    vi.mocked(provisionSeedanceCredentials).mockResolvedValue({
      apiKey: { id: "akid", keyPrefix: "sk-test", apiKey: "sk-secret" },
      assetCredential: {
        id: "acid",
        accessKeyId: "AKtest",
        secretAccessKey: "AKSKsecret",
      },
    });
    const logs: Array<{ message: string; data: Record<string, unknown> }> = [];

    await makeService(repository, {
      info: (message, data = {}) => logs.push({ message, data }),
      warn: () => {},
      error: () => {},
    }).ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });

    expect(getSeedanceCredentialsStatus).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: SSO_USER_ID,
        ssoTeamId: TEAM_ID,
        correlationId: expect.any(String),
      }),
    );
    expect(provisionSeedanceCredentials).toHaveBeenCalledTimes(1);
    expect(repository.saveReady).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(logs)).toContain("provision_status_reconciled");
    expect(JSON.stringify(logs)).not.toContain("sk-secret");
    expect(JSON.stringify(logs)).not.toContain("AKSKsecret");
  });

  it("fails closed and retains the lease when models reports an incomplete pair", async () => {
    const repository = makeRepository({
      lock: {
        status: "locked",
        row: readyRow({
          provisionState: "provisioning",
          provisionAttemptCount: 2,
          apikeyCiphertext: null,
        }),
      },
    });
    vi.mocked(getSeedanceCredentialsStatus).mockResolvedValue({
      state: "incomplete",
      apiKey: { id: "akid", keyPrefix: "sk-test", status: "revoked" },
    });

    await makeService(repository).ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });

    expect(provisionSeedanceCredentials).not.toHaveBeenCalled();
    expect(repository.saveReady).not.toHaveBeenCalled();
    expect(repository.saveFailed).toHaveBeenCalledWith(
      LOCAL_USER_ID,
      TEAM_ID,
      expect.stringMatching(/models provision state \(remote_state\) corr=/),
      { retainInFlight: true },
    );
  });

  it("defers retry without POST when remote status cannot be determined", async () => {
    const repository = makeRepository({
      lock: {
        status: "locked",
        row: readyRow({
          provisionState: "provisioning",
          provisionAttemptCount: 2,
          apikeyCiphertext: null,
        }),
      },
    });
    const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
    vi.mocked(getSeedanceCredentialsStatus).mockRejectedValue(
      new (await import("./models-client.js")).ModelsProvisionError(
        "status lookup timed out",
        0,
        "timeout",
      ),
    );

    await makeService(repository, {
      info: () => {},
      warn: (message, data = {}) => logs.push({ message, data }),
      error: () => {},
    }).ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });

    expect(provisionSeedanceCredentials).not.toHaveBeenCalled();
    expect(repository.saveFailed).toHaveBeenCalledWith(
      LOCAL_USER_ID,
      TEAM_ID,
      expect.stringMatching(/models provision timeout \(timeout\) corr=/),
      { retainInFlight: true },
    );
    expect(JSON.stringify(logs)).toContain("models_provision_outcome_unknown");
  });

  it("does not write local identity, SSO identity, team, or storage errors to logs", async () => {
    const repository = makeRepository({
      lock: {
        status: "locked",
        row: readyRow({
          provisionState: "provisioning",
          apikeyCiphertext: null,
          provisionAttemptCount: 1,
        }),
      },
    });
    vi.mocked(provisionSeedanceCredentials).mockRejectedValue(
      Object.assign(new Error("remote response token=secret"), {
        status: 503,
        code: "http",
      }),
    );
    vi.mocked(repository.saveFailed).mockRejectedValue(
      new Error("database connection for user-1 failed"),
    );
    const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
    const logger: Logger = {
      info: (message, data = {}) => logs.push({ message, data }),
      warn: (message, data = {}) => logs.push({ message, data }),
      error: (message, data = {}) => logs.push({ message, data }),
    };

    await makeService(repository, logger).ensureProvisioned({
      userId: LOCAL_USER_ID,
      ssoUserId: SSO_USER_ID,
      ssoTeamId: TEAM_ID,
    });

    const output = JSON.stringify(logs);
    expect(output).not.toContain(LOCAL_USER_ID);
    expect(output).not.toContain(SSO_USER_ID);
    expect(output).not.toContain(TEAM_ID);
    expect(output).not.toContain("remote response token=secret");
    expect(output).not.toContain("database connection");
    expect(output).toContain("credential_failure_state_persist");
  });

  it("re-provisions when a ready row was recorded under a different SSO subject", async () => {
    // Migration safety net: rows created before SSO-subject tracking
    // (migration 0012) have ssoUserId = null. On the first login after the
    // migration, the ready row's ssoUserId does not match the caller's, so the
    // repository atomically transitions it to provisioning before the service
    // re-provisions. This preserves the single-POST invariant under concurrency.
    const repository = makeRepository({
      lock: {
        status: "locked",
        row: readyRow({
          ssoUserId: SSO_USER_ID,
          provisionState: "provisioning",
          provisionAttemptCount: 1,
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

    // Re-provisioned with the real SSO subject, and the new row persists it.
    expect(provisionSeedanceCredentials).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ userId: SSO_USER_ID }),
    );
    expect(repository.saveReady).toHaveBeenCalledTimes(1);
    await expect(repository.findReady(LOCAL_USER_ID)).resolves.toMatchObject({
      ssoUserId: SSO_USER_ID,
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

  it("maps an undecryptable ready row to a clean not-provisioned error", async () => {
    // Simulates a key rotation / corrupt row: decrypt throws. The caller must
    // see CredentialsNotProvisionedError, not a raw crypto stack trace.
    const repository: UserCredentialsRepository = {
      findReady: vi.fn(async () => readyRow()),
      findAny: vi.fn(async () => readyRow()),
      takeProvisionLock: vi.fn(),
      saveReady: vi.fn(),
      saveFailed: vi.fn(),
    };
    const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
    const service = createCredentialsService({
      repository,
      crypto: {
        enabled: true,
        encrypt: (value) => `enc:${value}`,
        decrypt: () => {
          throw new Error("Unsupported state or unable to authenticate data");
        },
      },
      provisionConfig: {
        baseUrl: "https://ixicai.cn/api",
        serviceName: "lovart.dofe.ai",
        internalApiSecret: "test-secret",
      },
      logger: {
        info: () => {},
        warn: () => {},
        error: (message, data = {}) => logs.push({ message, data }),
      },
    });

    await expect(service.getByUserId(LOCAL_USER_ID)).rejects.toThrow(
      /Models credentials are not ready/,
    );
    // The crypto error message must not leak; only the failure category is logged.
    const output = JSON.stringify(logs);
    expect(output).toContain("credential_decrypt_failed");
    expect(output).not.toContain("Unsupported state");
    expect(output).not.toContain("secret");
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
