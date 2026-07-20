import { randomUUID } from "node:crypto";

import type { UserCredentialsRepository } from "./credentials-repository.js";
import type { CredentialCrypto } from "./crypto.js";
import {
  type Logger,
  type ModelsProvisionConfig,
  ModelsProvisionError,
  getSeedanceCredentialsStatus,
  provisionSeedanceCredentials,
} from "./models-client.js";

export type ResolvedCredentials = {
  /** Design apikey (sk-...) — Bearer for /v1/* and /v1/generation/tasks data plane. */
  designApiKey: string;
  /** Seedance asset access key id (team-scoped, for asset OpenAPI HMAC signing). */
  seedanceAccessKeyId: string;
  /** Seedance asset secret access key. */
  seedanceSecretAccessKey: string;
  /** models-side gateway_user_api_key row id (for future rotation). */
  modelsApiKeyId: string;
  /** models-side tenant_asset_credential row id. */
  modelsCredentialId: string;
};

/**
 * Raised when a model call is attempted but the user has no ready credentials.
 * Strict no-fallback policy (per product decision): callers surface this error
 * rather than silently falling back to the shared DOFE_MODEL_API_KEY.
 */
export class CredentialsNotProvisionedError extends Error {
  readonly code = "credentials_not_provisioned";
  readonly statusCode = 424; // Failed Dependency
  constructor(userId: string) {
    super(
      `Models credentials are not ready for user ${userId}. Re-login to trigger provisioning or contact an administrator.`,
    );
    this.name = "CredentialsNotProvisionedError";
  }
}

export type CredentialsService = {
  /**
   * Idempotently ensure a ready credential row exists for the user. Does NOT
   * throw — provisioning failures are recorded as 'failed' and retried on the
   * next call, so a transient models outage never blocks login/viewer. Strict
   * no-fallback is enforced at getByUserId time instead.
   *
   * Concurrency: a database-level advisory lock + in-flight state guarantees at
   * most one in-flight POST to models per (userId, ssoTeamId). Concurrent or
   * retried callers that arrive while provisioning is in flight (and not stale)
   * return immediately without touching models.
   *
   * `ssoTeamId` is required on first provisioning (the OIDC login path carries
   * it). When omitted (e.g. the ensureViewer retry path, which only has a
   * user id), it is recovered from any existing row; if no row exists yet the
   * call is a no-op and logged, deferring to the next login.
   */
  ensureProvisioned(input: {
    userId: string;
    /** Stable SSO subject used as the Models credential owner. */
    ssoUserId?: string;
    ssoTeamId?: string;
  }): Promise<void>;
  /**
   * Resolve ready credentials for a model call. Throws
   * CredentialsNotProvisionedError when none are ready.
   */
  getByUserId(userId: string): Promise<ResolvedCredentials>;
};

export type CredentialsServiceOptions = {
  repository: UserCredentialsRepository;
  crypto: CredentialCrypto;
  provisionConfig: ModelsProvisionConfig;
  /** Display name recorded on the models side during provisioning. */
  provisionName?: string;
  /** Structured logger; defaults to console when not provided (e.g. worker). */
  logger?: Logger;
  /**
   * How long an in-flight `provisioning` row is considered active before another
   * caller may take it over. Must be >= the models request timeout.
   */
  inFlightTimeoutMs?: number;
};

const DEFAULT_PROVISION_NAME = "lovart.dofe.ai integration";
const DEFAULT_IN_FLIGHT_TIMEOUT_MS = 15_000;

export function createCredentialsService(
  options: CredentialsServiceOptions,
): CredentialsService {
  const { repository, crypto, provisionConfig } = options;
  const logger = options.logger ?? consoleLogger;
  const inFlightTimeoutMs =
    options.inFlightTimeoutMs ??
    Math.max(provisionConfig.timeoutMs ?? 8_000, DEFAULT_IN_FLIGHT_TIMEOUT_MS);

  return {
    async ensureProvisioned({ userId, ssoUserId, ssoTeamId }) {
      // Retry path (ensureViewer) may arrive without ssoTeamId/ssoUserId; recover
      // either from any existing row with a single read. If we have neither, we
      // cannot provision — defer to the next login which carries the real ids.
      const existing =
        ssoTeamId && ssoUserId ? null : await repository.findAny(userId);
      const resolvedTeamId = ssoTeamId ?? existing?.ssoTeamId;
      if (!resolvedTeamId) {
        logger.warn("[credentials] ensure_skipped_no_team", {
          failureCategory: "credential_team_unavailable",
        });
        return;
      }
      const resolvedSsoUserId = ssoUserId ?? existing?.ssoUserId ?? undefined;
      if (!resolvedSsoUserId) {
        logger.warn("[credentials] ensure_skipped_no_sso_subject", {
          failureCategory: "credential_sso_subject_unavailable",
        });
        return;
      }

      const lock = await repository.takeProvisionLock({
        userId,
        ssoUserId: resolvedSsoUserId,
        ssoTeamId: resolvedTeamId,
        timeoutMs: inFlightTimeoutMs,
      });

      // Repository ownership: `takeProvisionLock` decides whether a ready row
      // belongs to this SSO subject while holding its advisory lock. A mismatch
      // is atomically converted to `provisioning`, preventing duplicate
      // re-provisioning during the migration/identity-change path.
      if (lock.status === "ready") {
        return;
      }
      if (lock.status === "in_flight") {
        logger.info("[credentials] ensure_skipped_in_flight", {
          attemptCount: lock.row.provisionAttemptCount,
        });
        return;
      }

      const correlationId = randomUUID();
      const attemptCount = lock.row.provisionAttemptCount;
      logger.info("[credentials] provision_attempt", {
        correlationId,
        attemptCount,
      });

      const startedAt = performance.now();
      try {
        // A retry means a previous caller may have reached models but lost its
        // response. Query the models-owned pair first. Initial provision and
        // explicit SSO-subject rotation have attemptCount 1 and intentionally
        // skip this extra round trip.
        if (attemptCount > 1) {
          const remoteStatus = await getSeedanceCredentialsStatus(
            provisionConfig,
            {
              userId: resolvedSsoUserId,
              ssoTeamId: resolvedTeamId,
              correlationId,
              logger,
            },
          );
          logger.info("[credentials] provision_status_reconciled", {
            correlationId,
            attemptCount,
            remoteState: remoteStatus.state,
          });
          if (remoteStatus.state === "incomplete") {
            // models reports a partial/disabled pair. Do not overwrite it or
            // create a second ownership record; preserve the lease for ops to
            // reconcile from the models authority.
            throw new ModelsProvisionError(
              "models reported incomplete credential state",
              0,
              "state",
            );
          }
          // `ready` still continues to provision: models' service-owned
          // ensure paths return the same credential pair, allowing Lovart to
          // restore encrypted local secrets without a second secret-read API.
        }
        const provisioned = await provisionSeedanceCredentials(
          provisionConfig,
          {
            userId: resolvedSsoUserId,
            ssoTeamId: resolvedTeamId,
            name: options.provisionName ?? DEFAULT_PROVISION_NAME,
            correlationId,
            logger,
          },
        );
        await repository.saveReady({
          userId,
          ssoUserId: resolvedSsoUserId,
          ssoTeamId: resolvedTeamId,
          modelsApiKeyId: provisioned.apiKey.id,
          modelsKeyPrefix: provisioned.apiKey.keyPrefix,
          apikeyCiphertext: crypto.encrypt(provisioned.apiKey.apiKey),
          modelsCredentialId: provisioned.assetCredential.id,
          accessKeyId: provisioned.assetCredential.accessKeyId,
          secretAccessKeyCiphertext: crypto.encrypt(
            provisioned.assetCredential.secretAccessKey,
          ),
        });
        logger.info("[credentials] provision_ok", {
          correlationId,
          keyPrefix: provisioned.apiKey.keyPrefix,
          modelsApiKeyId: provisioned.apiKey.id,
          modelsCredentialId: provisioned.assetCredential.id,
          attemptCount,
          cryptoEnabled: crypto.enabled,
          latencyMs: Math.round(performance.now() - startedAt),
        });
      } catch (error) {
        const code =
          error instanceof ModelsProvisionError ? error.code : "http";
        const status = error instanceof ModelsProvisionError ? error.status : 0;
        const statusCategory =
          code === "timeout"
            ? "timeout"
            : code === "state"
              ? "remote_state"
              : `${Math.floor(status / 100) || 5}xx`;
        // Sanitized error: correlationId + classification only, never the raw
        // message (which may carry response fragments) or any secret.
        const sanitizedError = `models provision ${code} (${statusCategory}) corr=${correlationId}`;
        logger.error("[credentials] provision_failed", {
          correlationId,
          attemptCount,
          code,
          statusCategory,
          status,
          latencyMs: Math.round(performance.now() - startedAt),
        });
        // `status === 0` means we do not know whether Models received the
        // non-idempotent POST. Keep the database lease until its TTL expires;
        // an immediate retry could mint duplicate credentials. Known HTTP
        // responses (including 5xx) can safely move to `failed` and retry.
        const retainInFlight =
          code === "timeout" || code === "state" || status === 0;
        if (retainInFlight) {
          logger.warn("[credentials] provision_retry_deferred", {
            correlationId,
            attemptCount,
            failureCategory: "models_provision_outcome_unknown",
          });
        }
        // Record the failure so it shows up in ops queries; swallow save errors
        // so a DB hiccup never propagates into the login path.
        await repository
          .saveFailed(userId, resolvedTeamId, sanitizedError, {
            retainInFlight,
          })
          .catch(() => {
            logger.error("[credentials] save_failed_error", {
              correlationId,
              failureCategory: "credential_failure_state_persist",
            });
          });
      }
    },

    async getByUserId(userId) {
      const row = await repository.findReady(userId);
      if (!row || !row.apikeyCiphertext || !row.secretAccessKeyCiphertext) {
        throw new CredentialsNotProvisionedError(userId);
      }
      try {
        const resolved: ResolvedCredentials = {
          designApiKey: crypto.decrypt(row.apikeyCiphertext),
          seedanceAccessKeyId: row.accessKeyId ?? "",
          seedanceSecretAccessKey: crypto.decrypt(
            row.secretAccessKeyCiphertext,
          ),
          modelsApiKeyId: row.modelsApiKeyId ?? "",
          modelsCredentialId: row.modelsCredentialId ?? "",
        };
        return resolved;
      } catch (error) {
        // Decrypt fails when the encryption key was rotated (rows encrypted
        // under an old key) or a row is corrupt (GCM auth-tag mismatch).
        // Surface a clean "not provisioned" signal with a sanitized log rather
        // than letting a raw crypto stack trace reach the model-call path as a
        // 500. NOTE: a ready-but-undecryptable row is not auto-re-provisioned
        // by ensureProvisioned (it sees status 'ready'); ops must rotate the
        // key back or clear the row. Logged distinctly for that runbook.
        logger.error("[credentials] decrypt_failed", {
          failureCategory: "credential_decrypt_failed",
          cryptoEnabled: crypto.enabled,
          message: error instanceof Error ? error.name : "unknown",
        });
        throw new CredentialsNotProvisionedError(userId);
      }
    },
  };
}

const consoleLogger: Logger = {
  info: (message, data) => console.info(message, data ?? {}),
  warn: (message, data) => console.warn(message, data ?? {}),
  error: (message, data) => console.error(message, data ?? {}),
};
