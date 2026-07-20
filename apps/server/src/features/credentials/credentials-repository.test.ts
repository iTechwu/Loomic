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
  query: (text: string, params?: unknown[]) => Promise<{
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

describe("UserCredentialsRepository.takeProvisionLock", () => {
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
    expect(
      texts.some((t) => /insert into user_credentials/.test(t)),
    ).toBe(false);
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
    expect(
      texts.some((t) => /insert into user_credentials/.test(t)),
    ).toBe(false);
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
    expect(upsert!.text).toContain("provisioning_started_at = now()");
    expect(upsert!.text).toContain(
      "provision_attempt_count = excluded.provision_attempt_count",
    );
    expect(upsert!.params).toContain(1);
  });
});
