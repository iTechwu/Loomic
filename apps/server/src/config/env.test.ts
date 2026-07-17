import { describe, expect, it } from "vitest";

import {
  DEFAULT_DOFE_MODEL_ROUTER_AGENT_MODEL,
  loadServerEnv,
  normalizeDofeModelBaseUrl,
} from "./env.js";

describe("DoFe model router environment", () => {
  it("normalizes the ixicai domain to the API data plane", () => {
    expect(normalizeDofeModelBaseUrl("https://ixicai.cn")).toBe("https://ixicai.cn/api");
    expect(normalizeDofeModelBaseUrl("https://ixicai.cn/api/")).toBe("https://ixicai.cn/api");
  });

  it("requires a complete router credential pair", () => {
    expect(() => loadServerEnv({}, { DOFE_MODEL_BASE_URL: "https://ixicai.cn" })).toThrow(
      "DOFE_MODEL_BASE_URL and DOFE_MODEL_API_KEY must be configured together.",
    );
  });

  it("uses a router-safe default model when configured", () => {
    const env = loadServerEnv({}, {
      DOFE_MODEL_API_KEY: "router-key",
      DOFE_MODEL_BASE_URL: "https://ixicai.cn",
    });

    expect(env.agentModel).toBe(DEFAULT_DOFE_MODEL_ROUTER_AGENT_MODEL);
    expect(env.dofeModelBaseUrl).toBe("https://ixicai.cn/api");
  });
});
