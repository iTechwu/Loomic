import { describe, expect, it, vi } from "vitest";

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
    expect(shouldUseDofeFallback({ status: 400 }, true)).toBe(true);
    expect(
      shouldUseDofeFallback(
        Object.assign(new Error("Model do not support image input."), {
          status: 400,
        }),
      ),
    ).toBe(true);
  });

  it("wraps glm-5.2 with a kimi-k3 vision fallback", () => {
    const model = createStreamingChatModel("dofe:glm-5.2", {
      dofeModelApiKey: "dofe-router-key",
      dofeModelBaseUrl: "http://dofe-models-api:3101",
    }) as unknown as { model: string; fallback: { model: string } };

    // glm-5.2 (text-only) is proactively routed to kimi-k3 for image turns.
    expect(model.model).toBe("glm-5.2");
    expect(model.fallback.model).toBe("kimi-k3");
  });

  it("routes image-bearing requests straight to the vision fallback (proactive)", async () => {
    const model = createStreamingChatModel("dofe:glm-5.2", {
      dofeModelApiKey: "dofe-router-key",
      dofeModelBaseUrl: "http://dofe-models-api:3101",
    }) as unknown as {
      _generate: (messages: unknown) => Promise<unknown>;
      fallback: { _generate: (messages: unknown) => Promise<unknown> };
    };

    const fallbackSpy = vi
      .spyOn(model.fallback, "_generate")
      .mockResolvedValue({ generations: [[]], llmOutput: {} });

    const imageMessages = [
      {
        content: [
          { type: "text", text: "describe this" },
          { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
        ],
      },
    ];
    await model._generate(imageMessages);

    // Proactive: image input hits the vision fallback without first calling
    // the (text-only) primary and waiting for it to 400.
    expect(fallbackSpy).toHaveBeenCalledTimes(1);
  });
});
