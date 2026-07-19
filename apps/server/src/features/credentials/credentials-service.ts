import type { UserCredentialsRepository } from "./credentials-repository.js";
import type { CredentialCrypto } from "./crypto.js";
import {
  type ModelsProvisionConfig,
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
   * `ssoTeamId` is required on first provisioning (the OIDC login path carries
   * it). When omitted (e.g. the ensureViewer retry path, which only has a
   * user id), it is recovered from any existing row; if no row exists yet the
   * call is a no-op and logged, deferring to the next login.
   */
  ensureProvisioned(input: {
    userId: string;
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
};

const DEFAULT_PROVISION_NAME = "lovart.dofe.ai integration";

export function createCredentialsService(
  options: CredentialsServiceOptions,
): CredentialsService {
  const { repository, crypto, provisionConfig } = options;

  return {
    async ensureProvisioned({ userId, ssoTeamId }) {
      // Fast path: an existing ready row means we never call models again — its
      // provision endpoint is non-idempotent and would mint a second key.
      const ready = await repository.findReady(userId);
      if (ready) return;

      // Retry path (ensureViewer) may arrive without ssoTeamId; recover it from
      // any existing row. If we have neither, we cannot provision — defer to
      // the next login which carries the real team id.
      const resolvedTeamId =
        ssoTeamId ?? (await repository.findAny(userId))?.ssoTeamId;
      if (!resolvedTeamId) {
        console.warn("[credentials] ensure_skipped_no_team", { userId });
        return;
      }

      try {
        const provisioned = await provisionSeedanceCredentials(
          provisionConfig,
          {
            userId,
            ssoTeamId: resolvedTeamId,
            name: options.provisionName ?? DEFAULT_PROVISION_NAME,
          },
        );
        await repository.saveReady({
          userId,
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
        console.info("[credentials] provision_ok", {
          userId,
          ssoTeamId: resolvedTeamId,
          keyPrefix: provisioned.apiKey.keyPrefix,
          cryptoEnabled: crypto.enabled,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[credentials] provision_failed", {
          userId,
          ssoTeamId: resolvedTeamId,
          message,
        });
        // Record the failure so it shows up in ops queries; swallow save errors
        // so a DB hiccup never propagates into the login path.
        await repository
          .saveFailed(userId, resolvedTeamId, message)
          .catch((saveError) => {
            console.error("[credentials] save_failed_error", {
              userId,
              ssoTeamId: resolvedTeamId,
              message:
                saveError instanceof Error
                  ? saveError.message
                  : String(saveError),
            });
          });
      }
    },

    async getByUserId(userId) {
      const row = await repository.findReady(userId);
      if (!row || !row.apikeyCiphertext || !row.secretAccessKeyCiphertext) {
        throw new CredentialsNotProvisionedError(userId);
      }
      return {
        designApiKey: crypto.decrypt(row.apikeyCiphertext),
        seedanceAccessKeyId: row.accessKeyId ?? "",
        seedanceSecretAccessKey: crypto.decrypt(row.secretAccessKeyCiphertext),
        modelsApiKeyId: row.modelsApiKeyId ?? "",
        modelsCredentialId: row.modelsCredentialId ?? "",
      };
    },
  };
}
