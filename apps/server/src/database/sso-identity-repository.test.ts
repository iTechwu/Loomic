import { describe, expect, it, vi } from "vitest";

import type { DatabasePool } from "./pool.js";
import { createSsoIdentityRepository } from "./sso-identity-repository.js";

const SSO_USER_ID = "sso-user-123";
const DATA_USER_ID = "legacy-profile-456";

function makePool(query: ReturnType<typeof vi.fn>): DatabasePool {
  return {
    end: vi.fn(),
    query: vi.fn(),
    transaction: async (operation) =>
      operation({ query } as unknown as Parameters<typeof operation>[0]),
  };
}

describe("SsoIdentityRepository", () => {
  it("logs mapping source without local or SSO identity values", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: DATA_USER_ID }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    const info = vi.spyOn(console, "info").mockImplementation(() => {});

    try {
      const result = await createSsoIdentityRepository(makePool(query)).resolve(
        {
          email: "legacy@example.com",
          ssoUserId: SSO_USER_ID,
        },
      );

      expect(result).toBe(DATA_USER_ID);
      expect(info).toHaveBeenCalledWith("[sso-identity] resolved subject", {
        source: "legacy_email_match",
      });
      expect(JSON.stringify(info.mock.calls)).not.toContain(SSO_USER_ID);
      expect(JSON.stringify(info.mock.calls)).not.toContain(DATA_USER_ID);
    } finally {
      info.mockRestore();
    }
  });
});
