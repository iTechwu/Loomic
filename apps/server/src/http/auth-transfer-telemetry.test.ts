import Fastify from "fastify";
import type { Redis } from "ioredis";
import { afterEach, describe, expect, it } from "vitest";

import {
  registerAuthTransferTelemetryReadiness,
  registerAuthTransferTelemetryRoute,
  waitForRedisReadiness,
} from "./auth-transfer-telemetry.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

type FakeRedisRateLimit = {
  defineCommand(
    name: string,
    definition: { numberOfKeys: number; lua: string },
  ): void;
  rateLimit?: (
    key: string,
    timeWindow: number,
    max: number,
    continueExceeding: boolean,
    exponentialBackoff: boolean,
    callback: (error: Error | null, result?: [number, number]) => void,
  ) => void;
};

function createSharedRedisRateLimit(): Redis {
  const counters = new Map<string, { count: number; expiresAt: number }>();
  const redis: FakeRedisRateLimit = {
    defineCommand(name) {
      if (name !== "rateLimit") throw new Error(`Unexpected Redis command: ${name}`);
      redis.rateLimit = (key, timeWindow, _max, _continueExceeding, _exponentialBackoff, callback) => {
        const now = Date.now();
        const existing = counters.get(key);
        const current = !existing || existing.expiresAt <= now
          ? { count: 0, expiresAt: now + timeWindow }
          : existing;
        current.count += 1;
        counters.set(key, current);
        callback(null, [current.count, Math.max(0, current.expiresAt - now)]);
      };
    },
  };
  return redis as Redis;
}

function createTestApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  return app;
}

describe("auth transfer telemetry", () => {
  it("fails application readiness when a configured shared limiter is unreachable", async () => {
    const app = createTestApp();
    registerAuthTransferTelemetryReadiness(app, {
      ping: async () => {
        throw new Error("redis unavailable");
      },
    });

    await expect(app.ready()).rejects.toThrow("redis unavailable");
  });

  it("does not add a Redis readiness requirement in local memory mode", async () => {
    const app = createTestApp();
    registerAuthTransferTelemetryReadiness(app, undefined);
    app.get("/health", async () => ({ ok: true }));

    await expect(app.inject("/health")).resolves.toMatchObject({ statusCode: 200 });
  });

  it("bounds a Redis readiness probe that never responds", async () => {
    await expect(
      waitForRedisReadiness({ ping: async () => new Promise<"PONG">(() => {}) }, 10),
    ).rejects.toThrow("Redis readiness probe timed out.");
  });

  it("accepts only the documented non-identifying transition fields", async () => {
    const app = createTestApp();
    await registerAuthTransferTelemetryRoute(app);

    const response = await app.inject({
      method: "POST",
      payload: {
        durationMsBucket: "1_to_5s",
        entryPoint: "callback",
        flowId: "flow_12345678",
        state: "authorized",
      },
      url: "/api/telemetry/auth-transfer",
    });

    expect(response.statusCode).toBe(204);
  });

  it("rejects arbitrary payloads so callback telemetry cannot carry PII", async () => {
    const app = createTestApp();
    await registerAuthTransferTelemetryRoute(app);

    const response = await app.inject({
      method: "POST",
      payload: {
        durationMsBucket: "1_to_5s",
        email: "person@example.com",
        entryPoint: "callback",
        flowId: "flow_12345678",
        state: "authorized",
      },
      url: "/api/telemetry/auth-transfer",
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_telemetry_event" });
  });

  it("rate limits otherwise valid anonymous telemetry before it becomes a log flood", async () => {
    const app = createTestApp();
    await registerAuthTransferTelemetryRoute(app);
    const payload = {
      durationMsBucket: "1_to_5s",
      entryPoint: "public",
      flowId: "flow_12345678",
      state: "intent_started",
    };

    for (let requestNumber = 0; requestNumber < 30; requestNumber += 1) {
      const response = await app.inject({
        headers: { "x-real-ip": "198.51.100.10" },
        method: "POST",
        payload: {
          ...payload,
          flowId: `flow_${requestNumber.toString().padStart(8, "0")}`,
        },
        url: "/api/telemetry/auth-transfer",
      });
      expect(response.statusCode).toBe(204);
    }

    const limited = await app.inject({
      headers: { "x-real-ip": "198.51.100.10" },
      method: "POST",
      payload,
      url: "/api/telemetry/auth-transfer",
    });

    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      error: "telemetry_rate_limited",
      statusCode: 429,
    });
  });

  it("shares the telemetry limit across Fastify instances when Redis is configured", async () => {
    const redis = createSharedRedisRateLimit();
    const first = createTestApp();
    const second = createTestApp();
    await registerAuthTransferTelemetryRoute(first, { redis });
    await registerAuthTransferTelemetryRoute(second, { redis });

    const payload = {
      durationMsBucket: "1_to_5s",
      entryPoint: "public",
      flowId: "flow_12345678",
      state: "intent_started",
    } as const;

    for (let requestNumber = 0; requestNumber < 30; requestNumber += 1) {
      const app = requestNumber % 2 === 0 ? first : second;
      const response = await app.inject({
        headers: { "x-real-ip": "198.51.100.20" },
        method: "POST",
        payload: { ...payload, flowId: `flow_${requestNumber.toString().padStart(8, "0")}` },
        url: "/api/telemetry/auth-transfer",
      });
      expect(response.statusCode).toBe(204);
    }

    const limited = await second.inject({
      headers: { "x-real-ip": "198.51.100.20" },
      method: "POST",
      payload,
      url: "/api/telemetry/auth-transfer",
    });
    expect(limited.statusCode).toBe(429);
  });
});
