import { createHmac } from "node:crypto";

/**
 * Client for models.dofe.ai (ixicai.cn) service-to-service credential APIs.
 *
 * The only operation lovart needs today is provisioning a per-user design
 * apikey + seedance asset AK/SK via `POST /internal/seedance/credentials`. That
 * route is guarded by models' InternalAuthGuard, which expects an HMAC-signed
 * Bearer token bound to a whitelisted service name (lovart.dofe.ai is on the
 * default list).
 */

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
  constructor(message: string, status: number) {
    super(message);
    this.name = "ModelsProvisionError";
    this.status = status;
  }
}

/**
 * Build the HMAC-signed Bearer token expected by models' InternalAuthGuard:
 *   `Bearer <unix-seconds>:<HMAC-SHA256("${ts}:${service}", secret).hex>:<service>`
 *
 * Mirrors models' `validateSignedToken`
 * (models.dofe.ai apps/api/src/modules/internal-api/internal-auth.guard.ts) and
 * `@dofe/models-sdk`'s `createModelsInternalApiAuthorization`. Implemented
 * inline so lovart stays free of an extra dependency for a 3-line signature;
 * switch to the SDK helper if the algorithm ever diverges.
 */
export function signModelsInternalToken(
  secret: string,
  timestampSec: number,
  serviceName: string,
): string {
  const signature = createHmac("sha256", secret)
    .update(`${timestampSec}:${serviceName}`)
    .digest("hex");
  return `Bearer ${timestampSec}:${signature}:${serviceName}`;
}

/**
 * Provision a per-user design apikey and seedance asset AK/SK.
 *
 * NOTE: models' provision endpoint is **not idempotent** — every successful
 * call mints fresh credentials. Callers must guard re-invocation (see
 * CredentialsService.ensureProvisioned, which only calls when no ready row
 * exists).
 */
export async function provisionSeedanceCredentials(
  config: ModelsProvisionConfig,
  input: { userId: string; ssoTeamId: string; name?: string; expiresAt?: Date },
): Promise<ProvisionedCredentials> {
  // The internal route is served beneath the /api prefix on ixicai.cn.
  const url = `${config.baseUrl.replace(/\/$/, "")}/internal/seedance/credentials`;
  const timestampSec = Math.floor(Date.now() / 1000);
  const authorization = signModelsInternalToken(
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

  const response = await fetch(url, {
    method: "POST",
    headers: {
      authorization,
      "x-service-name": config.serviceName,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(config.timeoutMs ?? 8_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new ModelsProvisionError(
      `provision HTTP ${response.status}: ${detail.slice(0, 500)}`,
      response.status,
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
    );
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string {
  return typeof value === "string" ? value : "";
}
