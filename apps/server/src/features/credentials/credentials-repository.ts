import type { DatabasePool } from "../../database/pool.js";

export type ProvisionState = "ready" | "provisioning" | "failed";

export type UserCredentialRow = {
  id: string;
  userId: string;
  ssoUserId: string | null;
  ssoTeamId: string;
  modelsApiKeyId: string | null;
  modelsKeyPrefix: string | null;
  apikeyCiphertext: string | null;
  modelsCredentialId: string | null;
  accessKeyId: string | null;
  secretAccessKeyCiphertext: string | null;
  provisionState: ProvisionState;
  provisioningStartedAt: Date | null;
  provisionAttemptCount: number;
  lastProvisionError: string | null;
};

export type SaveReadyInput = {
  userId: string;
  ssoUserId: string;
  ssoTeamId: string;
  modelsApiKeyId: string;
  modelsKeyPrefix: string;
  apikeyCiphertext: string;
  modelsCredentialId: string;
  accessKeyId: string;
  secretAccessKeyCiphertext: string;
};

export type ProvisionLockResult =
  | { status: "ready"; row: UserCredentialRow }
  | { status: "in_flight"; row: UserCredentialRow }
  | { status: "locked"; row: UserCredentialRow };

export type UserCredentialsRepository = {
  findReady(userId: string, ssoTeamId?: string): Promise<UserCredentialRow | null>;
  /** Latest row of any state — used to recover ssoTeamId for retry when the
   * caller (e.g. ensureViewer) doesn't carry it. */
  findAny(userId: string): Promise<UserCredentialRow | null>;
  /**
   * Acquire an exclusive per-(user,team) provision lock. Must be called inside a
   * short-lived operation: it starts a transaction, takes a PostgreSQL advisory
   * lock, and reads the row `FOR UPDATE`.
   */
  takeProvisionLock(input: {
    userId: string;
    ssoUserId?: string;
    ssoTeamId: string;
    timeoutMs: number;
  }): Promise<ProvisionLockResult>;
  saveReady(input: SaveReadyInput): Promise<void>;
  saveFailed(userId: string, ssoTeamId: string, error: string): Promise<void>;
};

const SELECT_COLS =
  "id, user_id, sso_user_id, sso_team_id, models_api_key_id, models_key_prefix, " +
  "apikey_ciphertext, models_credential_id, access_key_id, secret_access_key_ciphertext, " +
  "provision_state, provisioning_started_at, provision_attempt_count, last_provision_error";

type DbRow = {
  id: string;
  user_id: string;
  sso_user_id: string | null;
  sso_team_id: string;
  models_api_key_id: string | null;
  models_key_prefix: string | null;
  apikey_ciphertext: string | null;
  models_credential_id: string | null;
  access_key_id: string | null;
  secret_access_key_ciphertext: string | null;
  provision_state: ProvisionState;
  provisioning_started_at: Date | null;
  provision_attempt_count: number;
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
    async findReady(userId, ssoTeamId) {
      const result = await pool.query<DbRow>(
        `select ${SELECT_COLS} from user_credentials
         where user_id = $1 and provision_state = 'ready'
           and ($2::uuid is null or sso_team_id = $2)
         order by provisioned_at desc
         limit 1`,
        [userId, ssoTeamId ?? null],
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

    async takeProvisionLock({ userId, ssoUserId, ssoTeamId, timeoutMs }) {
      return pool.transaction(async (client) => {
        // Serialize concurrent provisioning attempts for the same (user, team).
        // The advisory lock is transaction-scoped and released on commit/rollback.
        const lockKey = hashLockKey(`${userId}:${ssoTeamId}`);
        await client.query("select pg_advisory_xact_lock($1, $2)", [
          lockKey,
          0,
        ]);

        const result = await client.query<DbRow>(
          `select ${SELECT_COLS} from user_credentials
           where user_id = $1 and sso_team_id = $2
           order by provisioned_at desc
           limit 1
           for update`,
          [userId, ssoTeamId],
        );
        const row = result.rows[0];

        if (row?.provision_state === "ready") {
          return { status: "ready", row: toCamelCase(row) };
        }

        if (
          row?.provision_state === "provisioning" &&
          row.provisioning_started_at &&
          Date.now() - row.provisioning_started_at.getTime() < timeoutMs
        ) {
          return { status: "in_flight", row: toCamelCase(row) };
        }

        const attemptCount = (row?.provision_attempt_count ?? 0) + 1;
        await client.query(
          `insert into user_credentials (
             user_id, sso_user_id, sso_team_id, provision_state,
             provisioning_started_at, provision_attempt_count, last_provision_error
           ) values ($1, $2, $3, 'provisioning', now(), $4, null)
           on conflict (user_id, sso_team_id) do update set
             sso_user_id = coalesce(excluded.sso_user_id, user_credentials.sso_user_id),
             provision_state = 'provisioning',
             provisioning_started_at = now(),
             provision_attempt_count = excluded.provision_attempt_count,
             last_provision_error = null,
             updated_at = now()`,
          [userId, ssoUserId ?? null, ssoTeamId, attemptCount],
        );

        const refreshed = await client.query<DbRow>(
          `select ${SELECT_COLS} from user_credentials
           where user_id = $1 and sso_team_id = $2
           limit 1
           for update`,
          [userId, ssoTeamId],
        );
        const lockedRow = refreshed.rows[0];
        if (!lockedRow) {
          throw new Error(
            `takeProvisionLock could not re-read row for user ${userId}`,
          );
        }
        return { status: "locked", row: toCamelCase(lockedRow) };
      });
    },

    async saveReady(input) {
      await pool.query(
        `insert into user_credentials (
           user_id, sso_user_id, sso_team_id, models_api_key_id, models_key_prefix,
           apikey_ciphertext, models_credential_id, access_key_id,
           secret_access_key_ciphertext, provision_state, provisioned_at,
           provisioning_started_at, provision_attempt_count
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'ready', now(), null, 0)
         on conflict (user_id, sso_team_id) do update set
           sso_user_id = excluded.sso_user_id,
           models_api_key_id = excluded.models_api_key_id,
           models_key_prefix = excluded.models_key_prefix,
           apikey_ciphertext = excluded.apikey_ciphertext,
           models_credential_id = excluded.models_credential_id,
           access_key_id = excluded.access_key_id,
           secret_access_key_ciphertext = excluded.secret_access_key_ciphertext,
           provision_state = 'ready',
           last_provision_error = null,
           provisioned_at = now(),
           provisioning_started_at = null,
           provision_attempt_count = 0`,
        [
          input.userId,
          input.ssoUserId,
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
           last_provision_error = excluded.last_provision_error,
           provisioning_started_at = null,
           updated_at = now()`,
        [userId, ssoTeamId, error],
      );
    },
  };
}

function toCamelCase(row: DbRow): UserCredentialRow {
  return {
    id: row.id,
    userId: row.user_id,
    ssoUserId: row.sso_user_id,
    ssoTeamId: row.sso_team_id,
    modelsApiKeyId: row.models_api_key_id,
    modelsKeyPrefix: row.models_key_prefix,
    apikeyCiphertext: row.apikey_ciphertext,
    modelsCredentialId: row.models_credential_id,
    accessKeyId: row.access_key_id,
    secretAccessKeyCiphertext: row.secret_access_key_ciphertext,
    provisionState: row.provision_state,
    provisioningStartedAt: row.provisioning_started_at,
    provisionAttemptCount: row.provision_attempt_count,
    lastProvisionError: row.last_provision_error,
  };
}

/**
 * Map a string lock scope to a 32-bit signed integer for
 * pg_advisory_xact_lock. Collisions are acceptable at the current scale; the
 * unique (user_id, sso_team_id) constraint is the final backstop.
 */
function hashLockKey(scope: string): number {
  let hash = 0;
  for (let i = 0; i < scope.length; i += 1) {
    const char = scope.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return hash;
}
