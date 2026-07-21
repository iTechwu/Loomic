import type { FastifyInstance } from "fastify";
import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  BillingServiceError,
  type BillingService,
} from "../features/billing/billing-service.js";
import {
  ModelsInternalClientError,
} from "../features/models-internal/models-internal-client.js";
import { registerBillingRoutes } from "./billing.js";

const USER_ID = "00000000-0000-4000-8000-000000000010";
const TENANT_ID = "00000000-0000-4000-8000-000000000020";
const TEAM_ID = "00000000-0000-4000-8000-000000000030";

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
      getTenantBalance: vi.fn(async () => makeBalance("tenant")),
      getTeamBalance: vi.fn(async () => makeBalance("team")),
      calculatePrice: vi.fn(async () => ({
        modelAlias: "gpt-4o",
        inputTokens: 1000,
        outputTokens: 500,
        estimatedCost: 0.03,
      })),
      ...overrides,
    })) as unknown as BillingService["forRequest"],
  } as BillingService;
}

function makeBalance(accountType: "tenant" | "team") {
  return {
    accountId: accountType === "tenant" ? TENANT_ID : TEAM_ID,
    accountType,
    balance: "100.00",
    reservedBalance: "10.00",
    availableBalance: "90.00",
    currency: "USD",
    status: "active",
  };
}

function makeAuth(authenticated = true) {
  return {
    authenticate: vi.fn(async () => (authenticated ? USER : null)),
  };
}

describe("registerBillingRoutes", () => {
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
    void registerBillingRoutes(app, {
      auth: options.auth ?? makeAuth(),
      billingService: options.billingService,
    });
    return app;
  }

  it("returns 401 when unauthenticated", async () => {
    const app = createTestApp({ auth: makeAuth(false) });

    const response = await app.inject({
      method: "GET",
      url: "/api/billing/tenant/balance",
    });

    expect(response.statusCode).toBe(401);
  });

  it("returns tenant balance on success", async () => {
    const app = createTestApp({ billingService: makeBillingService() });

    const response = await app.inject({
      method: "GET",
      url: "/api/billing/tenant/balance",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accountId).toBe(TENANT_ID);
    expect(response.json().accountType).toBe("tenant");
  });

  it("returns team balance for an owned team", async () => {
    const app = createTestApp({ billingService: makeBillingService() });

    const response = await app.inject({
      method: "GET",
      url: `/api/billing/teams/${TEAM_ID}/balance`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().accountType).toBe("team");
  });

  it("returns 400 for an invalid team id", async () => {
    const app = createTestApp({ billingService: makeBillingService() });

    const response = await app.inject({
      method: "GET",
      url: "/api/billing/teams/not-a-uuid/balance",
    });

    expect(response.statusCode).toBe(400);
  });

  it("returns 403 when team access is denied", async () => {
    const app = createTestApp({
      billingService: makeBillingService({
        getTeamBalance: vi.fn(async () => {
          throw new BillingServiceError("forbidden", 403, "forbidden");
        }),
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/billing/teams/${TEAM_ID}/balance`,
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns pricing estimate", async () => {
    const app = createTestApp({ billingService: makeBillingService() });

    const response = await app.inject({
      method: "GET",
      url: "/api/pricing/calculate?modelAlias=gpt-4o&inputTokens=1000",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().estimatedCost).toBe(0.03);
  });

  it("returns 502 when models returns a 5xx error", async () => {
    const app = createTestApp({
      billingService: makeBillingService({
        getTenantBalance: vi.fn(async () => {
          throw new ModelsInternalClientError("http 500", 500, "http");
        }),
      }),
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/billing/tenant/balance",
    });

    expect(response.statusCode).toBe(502);
    expect(response.json().error.code).toBe("billing_query_failed");
  });

  it("returns 503 when billing service is not configured", async () => {
    const app = createTestApp();

    const response = await app.inject({
      method: "GET",
      url: "/api/billing/tenant/balance",
    });

    expect(response.statusCode).toBe(503);
  });
});
