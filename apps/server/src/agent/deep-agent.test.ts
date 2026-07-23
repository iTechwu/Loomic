import { describe, expect, it } from "vitest";

import {
  createDefaultModelSpecifier,
  createStreamingChatModel,
  shouldUseDofeFallback,
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

  it("keeps a bindable chat model when glm-5.2 has a gateway fallback", () => {
    const model = createStreamingChatModel("dofe:glm-5.2", {
      dofeModelApiKey: "dofe-router-key",
      dofeModelBaseUrl: "http://dofe-models-api:3101",
    }) as unknown as { model: string; bindTools: unknown };

    expect(model.model).toBe("glm-5.2");
    expect(typeof model.bindTools).toBe("function");
  });

  it("uses the fallback only for a retryable Models availability error", () => {
    expect(shouldUseDofeFallback({ status: 402 })).toBe(true);
    expect(shouldUseDofeFallback({ response: { status: 503 } })).toBe(true);
    expect(shouldUseDofeFallback({ status: 400 })).toBe(false);
    expect(
      shouldUseDofeFallback(
        Object.assign(new Error("Model do not support image input."), {
          status: 400,
        }),
      ),
    ).toBe(true);
  });
});
