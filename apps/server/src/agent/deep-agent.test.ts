import { describe, expect, it } from "vitest";

import { createDefaultModelSpecifier } from "./deep-agent.js";

describe("createDefaultModelSpecifier", () => {
  it("keeps all configured agent models on the DoFe router", () => {
    expect(
      createDefaultModelSpecifier({
        agentModel: "google:gemini-2.5-flash",
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      }),
    ).toBe("dofe:gemini-2.5-flash");
  });
});
