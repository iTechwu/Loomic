import type { DatabasePool } from "../../database/pool.js";

export type ProvisionState = "ready" | "provisioning" | "failed";

export type UserCredentialRow = {
  id: string;
  userId: string;
  ssoTeamId: string;
  modelsApiKeyId: string | null;
  modelsKeyPrefix: string | null;
  apikeyCiphertext: string | null;
  modelsCredentialId: string | null;
  accessKeyId: string | null;
  secretAccessKeyCiphertext: string | null;
  provisionState: ProvisionState;
  lastProvisionError: string | null;
};

export type SaveReadyInput = {
  userId: string;
  ssoTeamId: string;
  modelsApiKeyId: string;
  modelsKeyPrefix: string;
  apikeyCiphertext: string;
  modelsCredentialId: string;
  accessKeyId: string;
  secretAccessKeyCiphertext: string;
};

export type UserCredentialsRepository = {
  findReady(userId: string): Promise<UserCredentialRow | null>;
  /** Latest row of any state — used to recover ssoTeamId for retry when the
   * caller (e.g. ensureViewer) doesn't carry it. */
  findAny(userId: string): Promise<UserCredentialRow | null>;
  saveReady(input: SaveReadyInput): Promise<void>;
  saveFailed(userId: string, ssoTeamId: string, error: string): Promise<void>;
};

const SELECT_COLS =
  "id, user_id, sso_team_id, models_api_key_id, models_key_prefix, apikey_ciphertext, models_credential_id, access_key_id, secret_access_key_ciphertext, provision_state, last_provision_error";

type DbRow = {
  id: string;
  user_id: string;
  sso_team_id: string;
  models_api_key_id: string | null;
  models_key_prefix: string | null;
  apikey_ciphertext: string | null;
  models_credential_id: string | null;
  access_key_id: string | null;
  secret_access_key_ciphertext: string | null;
  provision_state: ProvisionState;
  last_provision_error: string | null;
};

/**
 * Persistence for `user_credentials`. The unique (user_id, sso_team_id) index
 * is the idempotency boundary: because models' provision endpoint is not
 * idempotent, callers only provision when no ready row exists, and saveReady /
 * saveFailed upsert against that constraint.
 */
export function createUserCredentialsRepository(
  pool: DatabasePool,
): UserCredentialsRepository {
  return {
    async findReady(userId) {
      const result = await pool.query<DbRow>(
        `select ${SELECT_COLS} from user_credentials
         where user_id = $1 and provision_state = 'ready'
         order by provisioned_at desc
         limit 1`,
        [userId],
      );
      const row = result.rows[0];
      return row ? toCamelCase(row) : null;
    },

    async findAny(userId) {
      const result = await pool.query<DbRow>(
        `select ${SELECT_COLS} from user_credentials
         where user_id = $1
         order by provisioned_at desc
         limit 1`,
        [userId],
      );
      const row = result.rows[0];
      return row ? toCamelCase(row) : null;
    },

    async saveReady(input) {
      await pool.query(
        `insert into user_credentials (
           user_id, sso_team_id, models_api_key_id, models_key_prefix,
           apikey_ciphertext, models_credential_id, access_key_id,
           secret_access_key_ciphertext, provision_state, provisioned_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, 'ready', now())
         on conflict (user_id, sso_team_id) do update set
           models_api_key_id = excluded.models_api_key_id,
           models_key_prefix = excluded.models_key_prefix,
           apikey_ciphertext = excluded.apikey_ciphertext,
           models_credential_id = excluded.models_credential_id,
           access_key_id = excluded.access_key_id,
           secret_access_key_ciphertext = excluded.secret_access_key_ciphertext,
           provision_state = 'ready',
           last_provision_error = null,
           provisioned_at = now()`,
        [
          input.userId,
          input.ssoTeamId,
          input.modelsApiKeyId,
          input.modelsKeyPrefix,
          input.apikeyCiphertext,
          input.modelsCredentialId,
          input.accessKeyId,
          input.secretAccessKeyCiphertext,
        ],
      );
    },

    async saveFailed(userId, ssoTeamId, error) {
      await pool.query(
        `insert into user_credentials (user_id, sso_team_id, provision_state, last_provision_error)
         values ($1, $2, 'failed', $3)
         on conflict (user_id, sso_team_id) do update set
           provision_state = 'failed',
           last_provision_error = excluded.last_provision_error`,
        [userId, ssoTeamId, error],
      );
    },
  };
}

function toCamelCase(row: DbRow): UserCredentialRow {
  return {
    id: row.id,
    userId: row.user_id,
    ssoTeamId: row.sso_team_id,
    modelsApiKeyId: row.models_api_key_id,
    modelsKeyPrefix: row.models_key_prefix,
    apikeyCiphertext: row.apikey_ciphertext,
    modelsCredentialId: row.models_credential_id,
    accessKeyId: row.access_key_id,
    secretAccessKeyCiphertext: row.secret_access_key_ciphertext,
    provisionState: row.provision_state,
    lastProvisionError: row.last_provision_error,
  };
}
