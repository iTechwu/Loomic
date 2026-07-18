import { describe, expect, it } from "vitest";

import {
  createDefaultModelSpecifier,
  createStreamingChatModel,
} from "./deep-agent.js";

describe("DoFe model routing", () => {
  it("keeps configured agent models on the DoFe router", () => {
    expect(
      createDefaultModelSpecifier({
        agentModel: "google:gemini-2.5-flash",
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      }),
    ).toBe("dofe:gemini-2.5-flash");
  });

  it("uses Bearer-only authentication for the native Gemini gateway", () => {
    const model = createStreamingChatModel("dofe:gemini-2.5-flash-lite", {
      dofeModelApiKey: "dofe-router-key",
      dofeModelBaseUrl: "https://ixicai.cn/api",
    }) as unknown as {
      apiKey: string;
      client: { _requestOptions: { customHeaders?: Record<string, string> } };
    };

    expect(model.apiKey).toBe(" ");
    expect(model.client._requestOptions.customHeaders).toEqual({
      Authorization: "Bearer dofe-router-key",
    });
  });
});
