import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BillingServiceError,
  type BillingService,
} from "../features/billing/billing-service.js";
import {
  ModelsInternalClientError,
  type Logger,
} from "../features/models-internal/models-internal-client.js";
import { registerUsageRoutes } from "./usage.js";

const USER_ID = "00000000-0000-4000-8000-000000000010";
const TENANT_ID = "00000000-0000-4000-8000-000000000020";
const TEAM_ID = "00000000-0000-4000-8000-000000000030";
const API_KEY_ID = "00000000-0000-4000-8000-000000000040";

const USER = {
  id: USER_ID,
  tenantId: TENANT_ID,
  email: "test@example.com",
  accessToken: "token",
  userMetadata: {},
};

type BillingRequestContext = ReturnType<BillingService["forRequest"]>;

function makeBillingService(
  overrides?: Partial<BillingRequestContext>,
): BillingService {
  return {
    forRequest: vi.fn(() => ({
      getTenantUsageStats: vi.fn(async () => makeUsageStats()),
      getTeamUsageStats: vi.fn(async () => makeUsageStats()),
      getApiKeyUsageStats: vi.fn(async () => makeUsageStats()),
      getUsageLogs: vi.fn(async () => makeUsageLogs()),
      getTenantUsageLogs: vi.fn(async () => makeUsageLogs()),
      ...overrides,
    })) as unknown as BillingService["forRequest"],
  } as BillingService;
}

function makeUsageStats() {
  return {
    totalRequests: 1,
    totalTokens: 10,
    inputTokens: 6,
    outputTokens: 4,
    totalCost: 0.001,
    avgLatencyMs: 100,
    successCount: 1,
  };
}

function makeUsageLogs() {
  return {
    list: [
      {
        id: API_KEY_ID,
        teamId: TEAM_ID,
        model: "gpt-4o",
        vendor: "openai",
        inputTokens: 6,
        outputTokens: 4,
        totalCost: 0.001,
        totalTokens: 10,
        timestamp: "2026-07-21T00:00:00Z",
      },
    ],
    total: 1,
    page: 1,
    limit: 20,
  };
}

function makeAuth(authenticated = true) {
  return {
    authenticate: vi.fn(async () => (authenticated ? USER : null)),
  };
}

describe("registerUsageRoutes", () => {
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  const apps: FastifyInstance[] = [];

  function createTestApp(options: {
    auth?: ReturnType<typeof makeAuth>;
    billingService?: BillingService;
  } = {}) {
    const app = Fastify({ logger: false });
    apps.push(app);
    void registerUsageRoutes(app, {
      auth: options.auth ?? makeAuth(),
      billingService: options.billingService,
    });
    return app;
  }

  it("returns 401 when unauthenticated", async () => {
    const app = createTestApp({ auth: makeAuth(false) });

    const response = await app.inject({
      method: "GET",
      url: "/api/usage/tenant/stats",
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns 400 for invalid query parameters", async () => {
    const app = createTestApp({ billingService: makeBillingService() });

    const response = await app.inject({
      method: "GET",
      url: "/api/usage/tenant/stats?startDate=not-a-date",
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 503 when billing service is not configured", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/usage/tenant/stats",
    });

    expect(response.statusCode).toBe(503);
  });

  it("returns tenant usage stats on success", async () => {
    const app = createTestApp({ billingService: makeBillingService() });

    const response = await app.inject({
      method: "GET",
      url: "/api/usage/tenant/stats?startDate=2026-07-01",
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.totalRequests).toBe(1);
  });

  it("returns 403 when team access is denied", async () => {
    const app = createTestApp({
      billingService: makeBillingService({
        getTeamUsageStats: vi.fn(async () => {
          throw new BillingServiceError("forbidden", 403, "forbidden");
        }),
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/usage/teams/${TEAM_ID}/stats`,
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns 502 when models returns a 5xx error", async () => {
    const app = createTestApp({
      billingService: makeBillingService({
        getTenantUsageStats: vi.fn(async () => {
          throw new ModelsInternalClientError("http 500", 500, "http");
        }),
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/usage/tenant/stats",
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("usage_query_failed");
  });

  it("returns 504 when models times out", async () => {
    const app = createTestApp({
      billingService: makeBillingService({
        getTenantUsageStats: vi.fn(async () => {
          throw new ModelsInternalClientError("timeout", 0, "timeout");
        }),
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/usage/tenant/stats",
    });

    expect(response.statusCode).toBe(504);
  });

  it("returns bot usage stats for a valid api key id", async () => {
    const app = createTestApp({ billingService: makeBillingService() });

    const response = await app.inject({
      method: "GET",
      url: `/api/usage/bots/${API_KEY_ID}/stats`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().totalRequests).toBe(1);
  });

  it("returns tenant usage logs", async () => {
    const app = createTestApp({ billingService: makeBillingService() });

    const response = await app.inject({
      method: "GET",
      url: "/api/usage/tenant/logs?page=1&limit=10",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().list).toHaveLength(1);
  });
});
