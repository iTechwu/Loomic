import { describe, expect, it } from "vitest";

import { createStreamingChatModel } from "./deep-agent.js";

describe("createStreamingChatModel", () => {
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
