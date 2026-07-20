import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerAuthTransferTelemetryRoute } from "./auth-transfer-telemetry.js";

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createTestApp() {
  const app = Fastify({ logger: false });
  apps.push(app);
  return app;
}

describe("auth transfer telemetry", () => {
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
});
