import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  ModelsProvisionError,
  provisionSeedanceCredentials,
} from "./models-client.js";

const BASE_URL = "https://ixicai.cn/api";
const SERVICE_NAME = "lovart.dofe.ai";
const INTERNAL_API_SECRET = "test-secret";
const CORRELATION_ID = "corr-123";

function makeConfig(overrides?: {
  internalApiSecret?: string;
  serviceName?: string;
  baseUrl?: string;
}) {
  return {
    baseUrl: overrides?.baseUrl ?? BASE_URL,
    serviceName: overrides?.serviceName ?? SERVICE_NAME,
    internalApiSecret: overrides?.internalApiSecret ?? INTERNAL_API_SECRET,
  };
}

describe("provisionSeedanceCredentials", () => {
  it("uses the SDK HMAC format compatible with models InternalAuthGuard", async () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          apiKey: { id: "akid", keyPrefix: "sk-test", apiKey: "sk-secret" },
          assetCredential: {
            id: "acid",
            accessKeyId: "AKtest",
            secretAccessKey: "AKSKsecret",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await provisionSeedanceCredentials(makeConfig(), {
        userId: "user-1",
        ssoTeamId: "team-1",
        correlationId: CORRELATION_ID,
      });

      const call = fetchMock.mock.calls[0] as unknown as [


        string,


        { headers: Record<string, string> },


      ];
      const authorization = call[1].headers.authorization;
      const timestampSec = 1_700_000_000;
      const expectedSignature = createHmac("sha256", INTERNAL_API_SECRET)
        .update(`${timestampSec}:${SERVICE_NAME}`)
        .digest("hex");
      expect(authorization).toBe(
        `Bearer ${timestampSec}:${expectedSignature}:${SERVICE_NAME}`,
      );
    } finally {
      vi.unstubAllGlobals();
      nowSpy.mockRestore();
    }
  });

  it("sends x-service-name and x-correlation-id headers", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          apiKey: { id: "akid", keyPrefix: "sk-test", apiKey: "sk-secret" },
          assetCredential: {
            id: "acid",
            accessKeyId: "AKtest",
            secretAccessKey: "AKSKsecret",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await provisionSeedanceCredentials(makeConfig(), {
        userId: "user-1",
        ssoTeamId: "team-1",
        correlationId: CORRELATION_ID,
      });

      const call = fetchMock.mock.calls[0] as unknown as [


        string,


        { headers: Record<string, string> },


      ];
      expect(call[1].headers["x-service-name"]).toBe(SERVICE_NAME);
      expect(call[1].headers["x-correlation-id"]).toBe(CORRELATION_ID);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed when internalApiSecret is missing", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: {} }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        provisionSeedanceCredentials(
          makeConfig({ internalApiSecret: "" }),
          {
            userId: "user-1",
            ssoTeamId: "team-1",
            correlationId: CORRELATION_ID,
          },
        ),
      ).rejects.toThrow(
        new ModelsProvisionError("internalApiSecret is required", 0, "sdk"),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("fails closed when serviceName is empty", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: {} }, { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    try {
      await expect(
        provisionSeedanceCredentials(makeConfig({ serviceName: "   " }), {
          userId: "user-1",
          ssoTeamId: "team-1",
          correlationId: CORRELATION_ID,
        }),
      ).rejects.toThrow(
        new ModelsProvisionError("serviceName is required", 0, "sdk"),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([401, 403])(
    "fails closed on HTTP %i",
    async (status) => {
      const fetchMock = vi.fn(async () => new Response("Unauthorized", { status }),
      );
      vi.stubGlobal("fetch", fetchMock);

      try {
        await expect(
          provisionSeedanceCredentials(makeConfig(), {
            userId: "user-1",
            ssoTeamId: "team-1",
            correlationId: CORRELATION_ID,
          }),
        ).rejects.toThrow(ModelsProvisionError);

        let thrown: unknown;
        await provisionSeedanceCredentials(makeConfig(), {
          userId: "user-1",
          ssoTeamId: "team-1",
          correlationId: CORRELATION_ID,
        }).catch((e: unknown) => {
          thrown = e;
        });
        const error = thrown as ModelsProvisionError;
        expect(error.status).toBe(status);
        expect(error.code).toBe("http");
        // The error message must not leak the response body.
        expect(error.message).toBe(`provision HTTP ${status}`);
      } finally {
        vi.unstubAllGlobals();
      }
    },
  );

  it("fails closed on timeout without leaking secrets", async () => {
    const fetchMock = vi.fn(async () => {
      const error = new Error("The operation timed out.") as Error & {
        name: string;
      };
      error.name = "TimeoutError";
      throw error;
    });
    vi.stubGlobal("fetch", fetchMock);
    const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
    const logger = {
      info: () => {},
      warn: () => {},
      error: (message: string, data?: Record<string, unknown>) => {
        logs.push({ message, data: data ?? {} });
      },
    };

    try {
      let thrown: unknown;
      await provisionSeedanceCredentials(makeConfig(), {
        userId: "user-1",
        ssoTeamId: "team-1",
        correlationId: CORRELATION_ID,
        logger,
      }).catch((e: unknown) => {
        thrown = e;
      });
      const error = thrown as ModelsProvisionError;
      expect(error).toBeInstanceOf(ModelsProvisionError);
      expect(error.code).toBe("timeout");
      expect(error.status).toBe(0);

      for (const log of logs) {
        expect(JSON.stringify(log)).not.toContain(INTERNAL_API_SECRET);
        expect(JSON.stringify(log)).not.toContain("sk-secret");
        expect(JSON.stringify(log)).not.toContain("AKSKsecret");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not log apiKey, secretAccessKey, Authorization, or response body", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          apiKey: { id: "akid", keyPrefix: "sk-test", apiKey: "sk-secret" },
          assetCredential: {
            id: "acid",
            accessKeyId: "AKtest",
            secretAccessKey: "AKSKsecret",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const logs: Array<{ message: string; data: Record<string, unknown> }> = [];
    const logger = {
      info: (message: string, data?: Record<string, unknown>) => {
        logs.push({ message, data: data ?? {} });
      },
      warn: () => {},
      error: () => {},
    };

    try {
      await provisionSeedanceCredentials(makeConfig(), {
        userId: "user-1",
        ssoTeamId: "team-1",
        correlationId: CORRELATION_ID,
        logger,
      });

      const payload = JSON.stringify(logs);
      expect(payload).not.toContain(INTERNAL_API_SECRET);
      expect(payload).not.toContain("sk-secret");
      expect(payload).not.toContain("AKSKsecret");
      expect(payload).not.toContain("Authorization");
      expect(payload).not.toContain("Bearer");
      // models-side IDs are intentionally logged for ops correlation; they are
      // not secrets and are listed as required telemetry in the integration plan.
      expect(payload).toContain("akid");
      expect(payload).toContain("acid");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
