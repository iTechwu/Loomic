import { describe, expect, it } from "vitest";

import { createUserCredentialsRepository } from "./credentials-repository.js";

/**
 * Lightweight pool that records every query (text + params) and routes a
 * canned row to `SELECT ... FOR UPDATE` reads. The advisory lock and the
 * provisioning upsert are the invariants that matter for concurrency.
 */
type RecordedQuery = { text: string; params: unknown[] };
type Row = Record<string, unknown>;

type FakeClient = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{
    rows: unknown[];
    rowCount: number;
  }>;
};

function makeRecordingPool(selectRow: Row | null, rereadRow?: Row | null) {
  const queries: RecordedQuery[] = [];
  let selectCall = 0;
  const client: FakeClient = {
    async query(text, params = []) {
      queries.push({ text, params });
      if (text.includes("pg_advisory_xact_lock"))
        return { rows: [], rowCount: 0 };
      if (/^insert into user_credentials/i.test(text.trim()))
        return { rows: [], rowCount: 1 };
      if (text.includes("for update")) {
        selectCall += 1;
        const row = selectCall === 1 ? selectRow : (rereadRow ?? selectRow);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  const pool = {
    query: client.query,
    async transaction<T>(operation: (client: FakeClient) => Promise<T>) {
      return operation(client);
    },
    end: async () => {},
  };
  return { pool, queries };
}

const READY_ROW: Row = {
  id: "row-1",
  user_id: "u1",
  sso_user_id: "s1",
  sso_team_id: "t1",
  models_api_key_id: "ak",
  models_key_prefix: "sk-test",
  apikey_ciphertext: "enc",
  models_credential_id: "ac",
  access_key_id: "AK",
  secret_access_key_ciphertext: "enc2",
  provision_state: "ready",
  provisioning_started_at: null,
  provision_attempt_count: 0,
  last_provision_error: null,
};

const PROVISIONING_ROW: Row = {
  ...READY_ROW,
  models_api_key_id: null,
  models_key_prefix: null,
  apikey_ciphertext: null,
  models_credential_id: null,
  access_key_id: null,
  secret_access_key_ciphertext: null,
  provision_state: "provisioning",
  provisioning_started_at: new Date(),
  provision_attempt_count: 1,
};

describe("UserCredentialsRepository.findByApiKeyId", () => {
  it("returns the matching ready row for a models api key id", async () => {
    const queries: RecordedQuery[] = [];
    const pool = {
      query: async (text: string, params: unknown[] = []) => {
        queries.push({ text, params });
        return { rows: [READY_ROW], rowCount: 1 };
      },
      async transaction<T>() {
        throw new Error("unexpected transaction");
      },
      end: async () => {},
    };
    const repository = createUserCredentialsRepository(pool as never);

    const row = await repository.findByApiKeyId("u1", "ak");

    expect(row).not.toBeNull();
    expect(row?.modelsApiKeyId).toBe("ak");
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain("models_api_key_id = $2");
    expect(queries[0]?.text).toContain("provision_state = 'ready'");
    expect(queries[0]?.params).toEqual(["u1", "ak"]);
  });

  it("returns null when no ready row matches the api key id", async () => {
    const pool = {
      query: async () => ({ rows: [], rowCount: 0 }),
      async transaction<T>() {
        throw new Error("unexpected transaction");
      },
      end: async () => {},
    };
    const repository = createUserCredentialsRepository(pool as never);

    const row = await repository.findByApiKeyId("u1", "other-key");

    expect(row).toBeNull();
  });
});

describe("UserCredentialsRepository.takeProvisionLock", () => {
  it("caps ready candidate lookup at two rows so callers can fail closed on team ambiguity", async () => {
    const queries: RecordedQuery[] = [];
    const pool = {
      query: async (text: string, params: unknown[] = []) => {
        queries.push({ text, params });
        return {
          rows: [READY_ROW, { ...READY_ROW, id: "row-2", sso_team_id: "t2" }],
          rowCount: 2,
        };
      },
      async transaction<T>() {
        throw new Error("unexpected transaction");
      },
      end: async () => {},
    };
    const repository = createUserCredentialsRepository(pool as never);

    const rows = await repository.findReadyCandidates("u1");

    expect(rows.map((row) => row.ssoTeamId)).toEqual(["t1", "t2"]);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain("provision_state = 'ready'");
    expect(queries[0]?.text).toContain("limit 2");
    expect(queries[0]?.params).toEqual(["u1"]);
  });

  it("acquires a transaction-scoped advisory lock and returns ready when the row is ready", async () => {
    const { pool, queries } = makeRecordingPool(READY_ROW);
    const repository = createUserCredentialsRepository(pool as never);

    const result = await repository.takeProvisionLock({
      userId: "u1",
      ssoUserId: "s1",
      ssoTeamId: "t1",
      timeoutMs: 15_000,
    });

    expect(result.status).toBe("ready");
    const texts = queries.map((q) => q.text);
    expect(texts.some((t) => t.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(texts.some((t) => t.includes("for update"))).toBe(true);
    // A ready row must not trigger the provisioning upsert.
    expect(texts.some((t) => /insert into user_credentials/.test(t))).toBe(
      false,
    );
  });

  it("retains the provisioning lease only when a remote outcome is unknown", async () => {
    const { pool, queries } = makeRecordingPool(null);
    const repository = createUserCredentialsRepository(pool as never);

    await repository.saveFailed("u1", "t1", "sanitized", {
      retainInFlight: true,
    });

    const query = queries.at(-1);
    expect(query?.text).toContain(
      "case when $4 then 'provisioning' else 'failed' end",
    );
    expect(query?.text).toContain(
      "coalesce(user_credentials.provisioning_started_at, now())",
    );
    expect(query?.params).toEqual(["u1", "t1", "sanitized", true]);
  });

  it("returns in_flight when an unexpired provisioning row exists", async () => {
    const { pool, queries } = makeRecordingPool(PROVISIONING_ROW);
    const repository = createUserCredentialsRepository(pool as never);

    const result = await repository.takeProvisionLock({
      userId: "u1",
      ssoUserId: "s1",
      ssoTeamId: "t1",
      timeoutMs: 15_000,
    });

    expect(result.status).toBe("in_flight");
    const texts = queries.map((q) => q.text);
    expect(texts.some((t) => /insert into user_credentials/.test(t))).toBe(
      false,
    );
  });

  it("atomically re-locks a ready row when its Models SSO subject changed", async () => {
    const relockedRow: Row = {
      ...PROVISIONING_ROW,
      sso_user_id: "s2",
      provisioning_started_at: new Date(),
      provision_attempt_count: 1,
    };
    const { pool, queries } = makeRecordingPool(READY_ROW, relockedRow);
    const repository = createUserCredentialsRepository(pool as never);

    const result = await repository.takeProvisionLock({
      userId: "u1",
      ssoUserId: "s2",
      ssoTeamId: "t1",
      timeoutMs: 15_000,
    });

    expect(result.status).toBe("locked");
    expect(result.row.ssoUserId).toBe("s2");
    const upsert = queries.find((query) =>
      /insert into user_credentials/.test(query.text),
    );
    expect(upsert?.params).toContain("s2");
  });

  it("takes the lock and inserts a provisioning row when none exists", async () => {
    const { pool, queries } = makeRecordingPool(null, PROVISIONING_ROW);
    const repository = createUserCredentialsRepository(pool as never);

    const result = await repository.takeProvisionLock({
      userId: "u1",
      ssoUserId: "s1",
      ssoTeamId: "t1",
      timeoutMs: 15_000,
    });

    expect(result.status).toBe("locked");
    expect(result.row.provisionAttemptCount).toBe(1);
    const upsert = queries.find((q) =>
      /insert into user_credentials/.test(q.text),
    );
    expect(upsert).toBeDefined();
    expect(upsert?.text).toContain("provisioning_started_at = now()");
    expect(upsert?.text).toContain(
      "provision_attempt_count = excluded.provision_attempt_count",
    );
    expect(upsert?.params).toContain(1);
  });

  it("takes over a stale provisioning row (in-flight TTL exceeded) and re-locks", async () => {
    // A provisioning row whose started_at is older than timeoutMs must NOT be
    // treated as in_flight — another caller crashed or stalled. The lock holder
    // re-ups to provisioning and increments the attempt count, recovering the
    // stuck state without manual intervention.
    const staleRow: Row = {
      ...PROVISIONING_ROW,
      provision_state: "provisioning",
      provisioning_started_at: new Date(Date.now() - 60_000), // 60s ago > 15s TTL
      provision_attempt_count: 1,
    };
    const relockedRow: Row = {
      ...PROVISIONING_ROW,
      provision_state: "provisioning",
      provisioning_started_at: new Date(),
      provision_attempt_count: 2,
    };
    const { pool, queries } = makeRecordingPool(staleRow, relockedRow);
    const repository = createUserCredentialsRepository(pool as never);

    const result = await repository.takeProvisionLock({
      userId: "u1",
      ssoUserId: "s1",
      ssoTeamId: "t1",
      timeoutMs: 15_000,
    });

    expect(result.status).toBe("locked");
    expect(result.row.provisionAttemptCount).toBe(2);
    const upsert = queries.find((q) =>
      /insert into user_credentials/.test(q.text),
    );
    expect(upsert).toBeDefined();
    // The new attempt count is previous (1) + 1 = 2.
    expect(upsert?.params).toContain(2);
  });
});
