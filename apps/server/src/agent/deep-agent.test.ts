import { describe, expect, it, vi } from "vitest";

import {
  createDefaultModelSpecifier,
  createStreamingChatModel,
  selectChatModelSpecifierForRun,
  shouldUseDofeFallback,
} from "./deep-agent.js";

/**
 * A vision-chain entry narrowed to the surface these tests exercise. Typed as a
 * 2-tuple at the cast sites so indexed access (`[0]`/`[1]`) is exact rather
 * than `T | undefined` — the latter collapses `keyof` to `never` under
 * `noUncheckedIndexedAccess` and breaks `vi.spyOn`.
 */
type VisionSpyModel = { _generate: (messages: unknown) => Promise<unknown> };

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

  it("wraps glm-5.2 with a kimi-k3 → qwen3.6-plus vision fallback chain", () => {
    const model = createStreamingChatModel("dofe:glm-5.2", {
      dofeModelApiKey: "dofe-router-key",
      dofeModelBaseUrl: "http://dofe-models-api:3101",
    }) as unknown as { model: string; fallbacks: { model: string }[] };

    // glm-5.2 (text-only) is proactively routed through the vision chain, tried
    // in order, for image turns.
    expect(model.model).toBe("glm-5.2");
    expect(model.fallbacks.map((f) => f.model)).toEqual([
      "kimi-k3",
      "qwen3.6-plus",
    ]);
  });

  it("routes image-bearing requests straight to the vision chain (proactive)", async () => {
    const model = createStreamingChatModel("dofe:glm-5.2", {
      dofeModelApiKey: "dofe-router-key",
      dofeModelBaseUrl: "http://dofe-models-api:3101",
    }) as unknown as {
      _generate: (messages: unknown) => Promise<unknown>;
      fallbacks: [VisionSpyModel, VisionSpyModel];
    };

    const firstVisionSpy = vi
      .spyOn(model.fallbacks[0], "_generate")
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

    // Proactive: image input hits the first vision entry without first calling
    // the (text-only) primary and waiting for it to 400.
    expect(firstVisionSpy).toHaveBeenCalledTimes(1);
  });

  it("falls through the vision chain when an earlier entry fails before output", async () => {
    const model = createStreamingChatModel("dofe:glm-5.2", {
      dofeModelApiKey: "dofe-router-key",
      dofeModelBaseUrl: "http://dofe-models-api:3101",
    }) as unknown as {
      _generate: (messages: unknown) => Promise<unknown>;
      fallbacks: [VisionSpyModel, VisionSpyModel];
    };

    // First vision entry (kimi-k3) fails before emitting anything → the chain
    // must advance to the next vision entry (qwen3.6-plus) rather than surfacing
    // the failure, so an image turn still gets served.
    vi.spyOn(model.fallbacks[0], "_generate").mockRejectedValue({
      status: 503,
    });
    const backupSpy = vi
      .spyOn(model.fallbacks[1], "_generate")
      .mockResolvedValue({ generations: [[]], llmOutput: {} });

    const imageMessages = [
      {
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
        ],
      },
    ];
    await model._generate(imageMessages);

    expect(backupSpy).toHaveBeenCalledTimes(1);
  });

  it("streams the vision chain, advancing when an entry fails before its first chunk", async () => {
    const model = createStreamingChatModel("dofe:glm-5.2", {
      dofeModelApiKey: "dofe-router-key",
      dofeModelBaseUrl: "http://dofe-models-api:3101",
    }) as unknown as {
      _streamResponseChunks: (
        messages: unknown,
      ) => AsyncGenerator<unknown, void, unknown>;
      fallbacks: [
        {
          _streamResponseChunks: (
            messages: unknown,
          ) => AsyncGenerator<unknown, void, unknown>;
        },
        {
          _streamResponseChunks: (
            messages: unknown,
          ) => AsyncGenerator<unknown, void, unknown>;
        },
      ];
    };

    // First entry throws before emitting any chunk → the chain must advance to
    // the next entry and stream its output, rather than surfacing the failure.
    // This is the production path for image turns (the agent streams).
    vi.spyOn(model.fallbacks[0], "_streamResponseChunks").mockImplementation(
      // biome-ignore lint/correctness/useYield: intentionally rejects before yielding to simulate a pre-output failure
      async function* () {
        throw { status: 503 };
      },
    );
    const backupStream = vi
      .spyOn(model.fallbacks[1], "_streamResponseChunks")
      .mockImplementation(async function* () {
        yield { text: "from-backup" };
      });

    const imageMessages = [
      {
        content: [
          { type: "image_url", image_url: { url: "data:image/png;base64,x" } },
        ],
      },
    ];
    const chunks: unknown[] = [];
    for await (const chunk of model._streamResponseChunks(imageMessages)) {
      chunks.push(chunk);
    }

    expect(backupStream).toHaveBeenCalledTimes(1);
    expect(chunks).toEqual([{ text: "from-backup" }]);
  });

  it("selectChatModelSpecifierForRun routes image turns off the text-only default to a vision model", () => {
    // Default (no explicit model) resolves to glm-5.2 → image turn must move to
    // the first vision-capable model. This is the PRODUCTION routing mechanism:
    // it runs per-run in runtime.ts because the langchain agent bypasses
    // ChatOpenAI subclass _generate overrides (bindTools().invoke() reaches the
    // network without calling them — verified), so subclass-based routing
    // silently never fires. Selecting the model when the agent is built is the
    // only thing that works at message granularity.
    expect(selectChatModelSpecifierForRun(undefined, false)).toBeUndefined();
    expect(selectChatModelSpecifierForRun(undefined, true)).toBe("dofe:kimi-k3");
    expect(selectChatModelSpecifierForRun("dofe:glm-5.2", true)).toBe(
      "dofe:kimi-k3",
    );
    // A user-chosen non-glm model is respected even for image turns.
    expect(selectChatModelSpecifierForRun("dofe:claude-sonnet-4.6", true)).toBe(
      "dofe:claude-sonnet-4.6",
    );
    // Text turns never reroute.
    expect(selectChatModelSpecifierForRun("dofe:glm-5.2", false)).toBe(
      "dofe:glm-5.2",
    );
  });
});
