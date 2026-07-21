import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ModelsInternalClientError,
  createInternalModelsClient,
} from "./models-internal-client.js";

const BASE_URL = "https://ixicai.cn/api";
const SERVICE_NAME = "lovart.dofe.ai";
const INTERNAL_API_SECRET = "test-secret";
const CORRELATION_ID = "corr-usage-123";

function makeClient(overrides?: {
  internalApiSecret?: string;
  logger?: Parameters<typeof createInternalModelsClient>[1]["logger"];
}) {
  return createInternalModelsClient(
    {
      baseUrl: BASE_URL,
      serviceName: SERVICE_NAME,
      internalApiSecret: overrides?.internalApiSecret ?? INTERNAL_API_SECRET,
    },
    { correlationId: CORRELATION_ID, logger: overrides?.logger },
  );
}

function envelope(data: unknown) {
  return Response.json({ code: 0, msg: "ok", data });
}

function lastRequest(
  fetchMock: ReturnType<typeof vi.fn>,
): { url: string; headers: Record<string, string> } {
  const call = fetchMock.mock.calls.at(-1) as unknown as [
    string,
    { headers: Record<string, string> },
  ];
  return { url: call[0], headers: call[1].headers };
}

describe("InternalModelsClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("gets tenant usage stats with the right path and headers", async () => {
    const fetchMock = vi.fn(async () =>
      envelope({
        totalRequests: 10,
        totalTokens: 100,
        inputTokens: 60,
        outputTokens: 40,
        totalCost: 0.05,
        avgLatencyMs: 120,
        successCount: 9,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    const result = await client.getTenantUsageStats("tenant-1", {
      startDate: "2026-07-01",
      apiKeyId: "apikey-1",
    });

    expect(result.totalRequests).toBe(10);
    const { url, headers } = lastRequest(fetchMock);
    expect(url).toContain("/internal/usage/tenant/tenant-1/stats");
    expect(url).toContain("startDate=2026-07-01");
    expect(url).toContain("apiKeyId=apikey-1");
    expect(headers["x-service-name"]).toBe(SERVICE_NAME);
    expect(headers["x-correlation-id"]).toBe(CORRELATION_ID);
    expect(headers.Authorization).toContain("Bearer");
  });

  it("gets team usage stats via the team-scoped endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      envelope({
        totalRequests: 5,
        totalTokens: 50,
        inputTokens: 30,
        outputTokens: 20,
        totalCost: 0.02,
        avgLatencyMs: 100,
        successCount: 5,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    const result = await client.getUsageStats({
      teamId: "team-1",
      startDate: "2026-07-01",
    });

    expect(result.totalRequests).toBe(5);
    const { url } = lastRequest(fetchMock);
    expect(url).toContain("/internal/usage/stats");
    expect(url).toContain("teamId=team-1");
  });

  it("gets tenant balance from the tenant balance endpoint", async () => {
    const fetchMock = vi.fn(async () =>
      envelope({
        accountId: "tenant-1",
        balance: "100.00",
        reservedBalance: "10.00",
        availableBalance: "90.00",
        currency: "USD",
        status: "active",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    const result = await client.getTenantBalance("tenant-1");

    expect(result.accountId).toBe("tenant-1");
    const { url } = lastRequest(fetchMock);
    expect(url).toContain("/internal/billing/accounts/by-tenant/tenant-1/balance");
  });

  it("calculates price with the provided model alias", async () => {
    const fetchMock = vi.fn(async () =>
      envelope({
        modelAlias: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCost: 0.03,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    const result = await client.calculatePrice({
      modelAlias: "gpt-4o",
      inputTokens: 1000,
      outputTokens: 500,
    });

    expect(result.estimatedCost).toBe(0.03);
    const { url } = lastRequest(fetchMock);
    expect(url).toContain("/internal/pricing/calculate");
    expect(url).toContain("modelAlias=gpt-4o");
    expect(url).toContain("inputTokens=1000");
  });

  it("maps SDK status 0 to a timeout error", async () => {
    const fetchMock = vi.fn(async () => {
      const error = new Error("The operation timed out.") as Error & {
        name: string;
      };
      error.name = "TimeoutError";
      throw error;
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    try {
      await client.getTenantBalance("tenant-1");
      throw new Error("expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelsInternalClientError);
      expect((error as ModelsInternalClientError).status).toBe(0);
      expect((error as ModelsInternalClientError).code).toBe("timeout");
    }
  });

  it("maps SDK HTTP errors to ModelsInternalClientError with the upstream status", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({ code: 404, msg: "not found", data: null }, { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = makeClient();
    try {
      await client.getTenantBalance("tenant-1");
      throw new Error("expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelsInternalClientError);
      expect((error as ModelsInternalClientError).status).toBe(404);
      expect((error as ModelsInternalClientError).code).toBe("http");
    }
  });

  it("does not log the internal api secret", async () => {
    const fetchMock = vi.fn(async () =>
      envelope({
        totalRequests: 1,
        totalTokens: 1,
        inputTokens: 1,
        outputTokens: 0,
        totalCost: 0,
        avgLatencyMs: 1,
        successCount: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const logs: Array<Record<string, unknown>> = [];
    const client = makeClient({
      logger: {
        info: (_msg, data) => logs.push(data ?? {}),
        warn: (_msg, data) => logs.push(data ?? {}),
        error: (_msg, data) => logs.push(data ?? {}),
      },
    });

    await client.getTenantUsageStats("tenant-1", {});

    const allLogs = JSON.stringify(logs);
    expect(allLogs).not.toContain(INTERNAL_API_SECRET);
    expect(allLogs).not.toContain("Authorization");
  });
});
