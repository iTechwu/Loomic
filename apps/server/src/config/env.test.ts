import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOFE_MODEL_ROUTER_AGENT_MODEL,
  loadServerEnv,
  normalizeDofeModelBaseUrl,
  validateInternalApiSecret,
} from "./env.js";

describe("DoFe model router environment", () => {
  it("normalizes the ixicai domain to the API data plane", () => {
    expect(normalizeDofeModelBaseUrl("https://ixicai.cn")).toBe(
      "https://ixicai.cn/api",
    );
    expect(normalizeDofeModelBaseUrl("https://ixicai.cn/api/")).toBe(
      "https://ixicai.cn/api",
    );
  });

  it("requires a complete router credential pair", () => {
    expect(() =>
      loadServerEnv({}, { DOFE_MODEL_BASE_URL: "https://ixicai.cn" }),
    ).toThrow(
      "DOFE_MODEL_BASE_URL and DOFE_MODEL_API_KEY must be configured together.",
    );
  });

  it("uses the router-safe default model when configured", () => {
    const env = loadServerEnv(
      {},
      {
        DOFE_MODEL_API_KEY: "router-key",
        DOFE_MODEL_BASE_URL: "https://ixicai.cn",
      },
    );

    expect(env.agentModel).toBe(DEFAULT_DOFE_MODEL_ROUTER_AGENT_MODEL);
    expect(env.dofeModelBaseUrl).toBe("https://ixicai.cn/api");
  });

  it("fails closed when production telemetry requires managed TLS Redis", () => {
    expect(() =>
      loadServerEnv({}, { LOVART_DOFE_REQUIRE_REDIS: "true" }),
    ).toThrow("REDIS_URL is required");
    expect(() =>
      loadServerEnv(
        {},
        {
          LOVART_DOFE_REQUIRE_REDIS: "true",
          REDIS_URL: "redis://redis.internal:6379/5",
        },
      ),
    ).toThrow("must use rediss");

    expect(
      loadServerEnv(
        {},
        {
          LOVART_DOFE_REQUIRE_REDIS: "true",
          REDIS_URL: "rediss://redis.internal:6380/5",
        },
      ).requireRedis,
    ).toBe(true);
  });
});

describe("validateInternalApiSecret", () => {
  const FRESH_SECRET =
    "c0ffee1234567890abcdef0123456789abcdef0123456789abcdef0123456789";

  it("rejects the placeholder value", () => {
    expect(() =>
      validateInternalApiSecret("replace-with-server-only-secret"),
    ).toThrow("known placeholder");
  });

  it("rejects the models repo example hex", () => {
    expect(() =>
      validateInternalApiSecret(
        "2f83a27179523d9a19c58dfae4561e9ae4428b266bdb53fe80456646b032b649",
      ),
    ).toThrow("known placeholder");
  });

  it("rejects a short secret", () => {
    expect(() => validateInternalApiSecret("short-secret")).toThrow(
      "at least 32 characters",
    );
  });

  it("rejects a low-entropy secret", () => {
    expect(() =>
      validateInternalApiSecret("aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ).toThrow("too little entropy");
  });

  it("accepts a fresh high-entropy secret", () => {
    expect(() => validateInternalApiSecret(FRESH_SECRET)).not.toThrow();
  });

  it("is enforced by loadServerEnv when the secret is configured", () => {
    expect(() =>
      loadServerEnv(
        {},
        { INTERNAL_API_SECRET: "replace-with-server-only-secret" },
      ),
    ).toThrow("known placeholder");
  });
});
