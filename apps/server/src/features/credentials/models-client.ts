import { createSignedModelsInternalDataClient } from "@dofe/models-sdk/internal-node";
import { ModelsInternalApiError } from "@dofe/models-sdk/response";

/**
 * Client for models.dofe.ai (ixicai.cn) service-to-service credential APIs.
 *
 * The only operation lovart needs today is provisioning a per-user design
 * apikey + seedance asset AK/SK via `POST /internal/seedance/credentials`. As
 * of `@dofe/models-sdk@0.2.10` that route is exposed as the typed
 * `seedanceCredentials.create` method, so this adapter delegates to the SDK's
 * signed data client (HMAC auth, x-service-name, timeout, envelope unwrap) and
 * only owns: config validation, correlation-id propagation, sanitized logging,
 * and mapping SDK errors onto lovart's `ModelsProvisionError`.
 *
 * The SDK import is server-side only and must never leak into the browser bundle.
 */

export type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

export type ModelsProvisionConfig = {
  /**
   * models data-plane base, already normalized to `https://ixicai.cn/api`.
   * The internal route is served beneath the same `/api` prefix.
   */
  baseUrl: string;
  /** Service name whitelisted in models' MODELS_SEEDANCE_CREDENTIAL_SERVICE_NAMES. */
  serviceName: string;
  /** Shared INTERNAL_API_SECRET (same value models uses to verify signatures). */
  internalApiSecret: string;
  timeoutMs?: number;
};

export type ProvisionedCredentials = {
  apiKey: { id: string; keyPrefix: string; apiKey: string };
  assetCredential: { id: string; accessKeyId: string; secretAccessKey: string };
};

export class ModelsProvisionError extends Error {
  readonly status: number;
  readonly code: "http" | "timeout" | "sdk";
  constructor(
    message: string,
    status: number,
    code: "http" | "timeout" | "sdk" = "http",
  ) {
    super(message);
    this.name = "ModelsProvisionError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Provision a per-user design apikey and seedance asset AK/SK via the SDK's
 * typed `seedanceCredentials.create` method.
 *
 * NOTE: models' provision endpoint is **not idempotent** — every successful
 * call mints fresh credentials. Callers must guard re-invocation (see
 * CredentialsService.ensureProvisioned, which uses a database-level lock and
 * in-flight state).
 */
export async function provisionSeedanceCredentials(
  config: ModelsProvisionConfig,
  input: {
    userId: string;
    ssoTeamId: string;
    name?: string;
    expiresAt?: Date;
    correlationId: string;
    logger?: Logger;
  },
): Promise<ProvisionedCredentials> {
  validateConfig(config);

  // Construct per call so the correlation id is bound to this request via
  // baseHeaders. Construction is pure (no I/O); provisioning runs at most once
  // per user, so this cost is negligible.
  const client = createSignedModelsInternalDataClient({
    baseUrl: config.baseUrl,
    serviceName: config.serviceName,
    internalApiSecret: config.internalApiSecret,
    timeoutMs: config.timeoutMs ?? 8_000,
    baseHeaders: { "x-correlation-id": input.correlationId },
  });

  const log = input.logger ?? silentLogger();
  const startedAt = performance.now();

  try {
    const data = await client.seedanceCredentials.create({
      body: {
        userId: input.userId,
        ssoTeamId: input.ssoTeamId,
        ...(input.name ? { name: input.name } : {}),
        ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      },
    });

    const result: ProvisionedCredentials = {
      apiKey: {
        id: data.apiKey.id,
        keyPrefix: data.apiKey.keyPrefix,
        apiKey: data.apiKey.apiKey,
      },
      assetCredential: {
        id: data.assetCredential.id,
        accessKeyId: data.assetCredential.accessKeyId,
        secretAccessKey: data.assetCredential.secretAccessKey,
      },
    };

    if (!result.apiKey.apiKey || !result.assetCredential.secretAccessKey) {
      throw new ModelsProvisionError(
        "provision response was missing apiKey.apiKey or assetCredential.secretAccessKey",
        200,
        "http",
      );
    }

    log.info("[credentials] provision_remote_ok", {
      correlationId: input.correlationId,
      latencyMs: Math.round(performance.now() - startedAt),
      statusCategory: "2xx",
      modelsApiKeyId: result.apiKey.id,
      modelsCredentialId: result.assetCredential.id,
    });

    return result;
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);

    if (error instanceof ModelsProvisionError) {
      // Re-raise our own validation errors untouched.
      log.error("[credentials] provision_remote_failed", {
        correlationId: input.correlationId,
        latencyMs,
        statusCategory: `${Math.floor(error.status / 100) || 5}xx`,
        status: error.status,
        code: error.code,
      });
      throw error;
    }

    if (error instanceof ModelsInternalApiError) {
      // status === 0 means the SDK's own request timer elapsed (timeout) or the
      // request was aborted. Any other status is an HTTP failure classified by
      // the models envelope. We never persist error.message — it may carry the
      // envelope's msg text — only the status/code classification.
      if (error.status === 0) {
        log.error("[credentials] provision_remote_timeout", {
          correlationId: input.correlationId,
          latencyMs,
          statusCategory: "timeout",
        });
        throw new ModelsProvisionError(
          "provision request timed out",
          0,
          "timeout",
        );
      }
      log.error("[credentials] provision_remote_failed", {
        correlationId: input.correlationId,
        latencyMs,
        statusCategory: `${Math.floor(error.status / 100) || 5}xx`,
        status: error.status,
        code: "http",
      });
      throw new ModelsProvisionError(
        `provision HTTP ${error.status}`,
        error.status,
        "http",
      );
    }

    if (isTimeoutError(error)) {
      log.error("[credentials] provision_remote_timeout", {
        correlationId: input.correlationId,
        latencyMs,
        statusCategory: "timeout",
      });
      throw new ModelsProvisionError(
        "provision request timed out",
        0,
        "timeout",
      );
    }

    // Unexpected error (network, fetcher, JSON) can carry request details or
    // response text. Keep both persisted logs and callers on a stable category.
    log.error("[credentials] provision_remote_error", {
      correlationId: input.correlationId,
      latencyMs,
      statusCategory: "5xx",
      failureCategory: "models_provision_unexpected",
    });
    throw new ModelsProvisionError("provision request failed", 0, "http");
  }
}

function validateConfig(config: ModelsProvisionConfig): void {
  if (!config.internalApiSecret?.trim()) {
    throw new ModelsProvisionError("internalApiSecret is required", 0, "sdk");
  }
  if (!config.serviceName?.trim()) {
    throw new ModelsProvisionError("serviceName is required", 0, "sdk");
  }
  if (!config.baseUrl?.trim()) {
    throw new ModelsProvisionError("baseUrl is required", 0, "sdk");
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  const cause = (error as { cause?: Error }).cause;
  if (cause && (cause.name === "TimeoutError" || cause.name === "AbortError"))
    return true;
  return false;
}

function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}
