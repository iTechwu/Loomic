import { describe, expect, it } from "vitest";

import { loadServerEnv } from "./env.js";

describe("DoFe model router environment", () => {
  it("uses the router default and normalizes the ixicai API data plane", () => {
    const env = loadServerEnv(
      {},
      {
        DOFE_MODEL_API_KEY: "router-key",
        DOFE_MODEL_BASE_URL: "https://ixicai.cn",
      },
    );

    expect(env.agentModel).toBe("glm-5.2");
    expect(env.dofeModelBaseUrl).toBe("https://ixicai.cn/api");
  });

  it("rejects incomplete router credentials", () => {
    expect(() =>
      loadServerEnv(
        {},
        {
          DOFE_MODEL_BASE_URL: "https://ixicai.cn/api",
        },
      ),
    ).toThrow(
      "DOFE_MODEL_BASE_URL and DOFE_MODEL_API_KEY must be configured together.",
    );
  });
});
