import { createModelsInternalApiAuthorization } from "@dofe/models-sdk/internal-node";

/**
 * Client for models.dofe.ai (ixicai.cn) service-to-service credential APIs.
 *
 * The only operation lovart needs today is provisioning a per-user design
 * apikey + seedance asset AK/SK via `POST /internal/seedance/credentials`. That
 * route is guarded by models' InternalAuthGuard, which expects an HMAC-signed
 * Bearer token bound to a whitelisted service name (lovart.dofe.ai is on the
 * default list).
 *
 * Authentication is delegated to `@dofe/models-sdk/internal-node` so the signing
 * algorithm stays in sync with models' InternalAuthGuard. The SDK import is
 * server-side only and must never leak into the browser bundle.
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
 * Provision a per-user design apikey and seedance asset AK/SK.
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

  // The internal route is served beneath the /api prefix on ixicai.cn.
  const url = `${config.baseUrl.replace(/\/$/, "")}/internal/seedance/credentials`;
  const timestampSec = Math.floor(Date.now() / 1000);
  const authorization = createModelsInternalApiAuthorization(
    config.internalApiSecret,
    timestampSec,
    config.serviceName,
  );

  const body: Record<string, unknown> = {
    userId: input.userId,
    ssoTeamId: input.ssoTeamId,
  };
  if (input.name) body.name = input.name;
  if (input.expiresAt) body.expiresAt = input.expiresAt.toISOString();

  const startedAt = performance.now();
  let status = 0;
  const log = input.logger ?? silentLogger();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        authorization,
        "x-service-name": config.serviceName,
        "x-correlation-id": input.correlationId,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs ?? 8_000),
    });
    status = response.status;

    if (!response.ok) {
      // Do not include the response body or Authorization in the error or logs.
      throw new ModelsProvisionError(
        `provision HTTP ${response.status}`,
        response.status,
        "http",
      );
    }

    const payload = (await response.json()) as unknown;
    // models wraps responses as `{ code, msg, data }`; accept either shape.
    const data =
      (isRecord(payload) && isRecord(payload.data)
        ? payload.data
        : isRecord(payload)
          ? payload
          : {}) ?? {};
    const apiKey = isRecord(data.apiKey) ? data.apiKey : {};
    const assetCredential = isRecord(data.assetCredential)
      ? data.assetCredential
      : {};

    const result: ProvisionedCredentials = {
      apiKey: {
        id: stringField(apiKey.id),
        keyPrefix: stringField(apiKey.keyPrefix),
        apiKey: stringField(apiKey.apiKey),
      },
      assetCredential: {
        id: stringField(assetCredential.id),
        accessKeyId: stringField(assetCredential.accessKeyId),
        secretAccessKey: stringField(assetCredential.secretAccessKey),
      },
    };

    if (!result.apiKey.apiKey || !result.assetCredential.secretAccessKey) {
      throw new ModelsProvisionError(
        "provision response was missing apiKey.apiKey or assetCredential.secretAccessKey",
        response.status,
        "http",
      );
    }

    log.info("[credentials] provision_remote_ok", {
      correlationId: input.correlationId,
      latencyMs: Math.round(performance.now() - startedAt),
      statusCategory: `${Math.floor(status / 100)}xx`,
      modelsApiKeyId: result.apiKey.id,
      modelsCredentialId: result.assetCredential.id,
    });

    return result;
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);
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

    if (error instanceof ModelsProvisionError) {
      log.error("[credentials] provision_remote_failed", {
        correlationId: input.correlationId,
        latencyMs,
        statusCategory: `${Math.floor(error.status / 100) || 5}xx`,
        status: error.status,
        code: error.code,
      });
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);
    log.error("[credentials] provision_remote_error", {
      correlationId: input.correlationId,
      latencyMs,
      statusCategory: "5xx",
      message,
    });
    throw new ModelsProvisionError(message, 0, "http");
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
  // Node fetch/undici may throw AbortError with a cause that is a TimeoutError.
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
