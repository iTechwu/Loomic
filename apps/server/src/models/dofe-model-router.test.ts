import { describe, expect, it, vi } from "vitest";

import {
  createDofeModelCatalog,
  dofeModelProtocolBaseUrl,
  isChatModelAlias,
  parseDofeGenerationCapabilityMetadata,
  resetDofeModelProtocolCache,
  resolveDofeModelProtocol,
  toDofeRouterModelId,
} from "./dofe-model-router.js";

describe("DoFe model router", () => {
  it("keeps only public, well-formed generation capability metadata", () => {
    expect(
      parseDofeGenerationCapabilityMetadata({
        resolutions: ["720p", "1080p"],
        durationSeconds: { min: 4, max: 8, step: 2 },
        maxInputAssets: 2,
        supportsGenerateAudio: true,
        providerProfile: { private: true },
      }),
    ).toEqual({
      resolutions: ["720p", "1080p"],
      durationSeconds: { min: 4, max: 8, step: 2 },
      maxInputAssets: 2,
      supportsGenerateAudio: true,
    });
    expect(
      parseDofeGenerationCapabilityMetadata({
        resolutions: ["720p", 1080],
        maxInputAssets: -1,
      }),
    ).toBeUndefined();
  });

  it("routes each model family through its native gateway protocol", () => {
    expect(resolveDofeModelProtocol("gemini-3.1-flash")).toBe("gemini");
    expect(resolveDofeModelProtocol("claude-sonnet-4.6")).toBe("anthropic");
    expect(resolveDofeModelProtocol("gpt-5.4")).toBe("openai");
    expect(dofeModelProtocolBaseUrl("https://ixicai.cn/api", "gemini")).toBe(
      "https://ixicai.cn/api/gemini",
    );
    expect(dofeModelProtocolBaseUrl("https://ixicai.cn/api", "anthropic")).toBe(
      "https://ixicai.cn/api/anthropic",
    );
    expect(dofeModelProtocolBaseUrl("https://ixicai.cn/api", "openai")).toBe(
      "https://ixicai.cn/api/v1",
    );
  });

  it("keeps the legacy alias helper for backward compatibility", () => {
    expect(isChatModelAlias("gpt-5.4")).toBe(true);
    expect(isChatModelAlias("claude-sonnet-4.6")).toBe(true);
    expect(isChatModelAlias("imagen-4.0-generate-001")).toBe(false);
    expect(isChatModelAlias("seedance-2.0")).toBe(false);
  });

  it("migrates existing provider-prefixed settings to router aliases", () => {
    expect(toDofeRouterModelId("openai:gpt-5.4")).toBe("gpt-5.4");
    expect(toDofeRouterModelId("google:gemini-3.1-flash")).toBe(
      "gemini-3.1-flash",
    );
    expect(toDofeRouterModelId("dofe:claude-sonnet-4.6")).toBe(
      "claude-sonnet-4.6",
    );
  });

  it("authenticates, filters, sorts, and caches the gateway catalog", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "glm-5.2", owned_by: "zhipu" },
              { id: "gpt-5.4", owned_by: "dofe-ai" },
              { id: "seedream-5.0", owned_by: "bytedance" },
            ],
          }),
        );
      }
      const isImage = url.includes("seedream-5.0");
      return new Response(
        JSON.stringify({
          model_type: isImage ? "image" : "text",
          capabilities: isImage ? [{ capabilityName: "text_to_image" }] : [],
        }),
      );
    });
    const catalog = createDofeModelCatalog(
      {
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      },
      { fetch },
    );

    await expect(catalog?.listChatModels()).resolves.toEqual([
      { id: "glm-5.2", ownedBy: "zhipu", modelType: "text", capabilities: [] },
      {
        id: "gpt-5.4",
        ownedBy: "dofe-ai",
        modelType: "text",
        capabilities: [],
      },
    ]);
    await catalog?.listChatModels();

    await expect(catalog?.listImageModels()).resolves.toEqual([
      {
        id: "seedream-5.0",
        ownedBy: "bytedance",
        modelType: "image",
        capabilities: ["text_to_image"],
      },
    ]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledWith("https://ixicai.cn/api/v1/models", {
      headers: { Authorization: "Bearer router-key" },
    });
  });

  it("projects only explicit LLM types into the chat catalog", async () => {
    const modelTypes: Record<string, string> = {
      "chat-current": "llm",
      "chat-legacy": "text",
      "embed-visible": "text_embedding",
      "audio-visible": "audio",
      "transcode-visible": "transcode",
    };
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({
            data: Object.keys(modelTypes).map((id) => ({ id })),
          }),
        );
      }
      const alias = Object.keys(modelTypes).find((id) =>
        url.includes(encodeURIComponent(id)),
      );
      return new Response(
        JSON.stringify({
          model_type: alias ? modelTypes[alias] : undefined,
          capabilities: [],
        }),
      );
    });
    const catalog = createDofeModelCatalog(
      {
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      },
      { fetch },
    );

    await expect(catalog?.listChatModels()).resolves.toMatchObject([
      { id: "chat-current", modelType: "llm" },
      { id: "chat-legacy", modelType: "text" },
    ]);
  });

  it("projects capability parameter boundaries with their capability name", async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(JSON.stringify({ data: [{ id: "video-model" }] }));
      }
      return new Response(
        JSON.stringify({
          model_type: "video",
          capabilities: [
            {
              capabilityName: "text_to_video",
              capabilityMetadata: {
                resolutions: ["720p"],
                durationSeconds: { min: 4, max: 8 },
                providerProfile: { endpoint: "private" },
              },
            },
          ],
        }),
      );
    });
    const catalog = createDofeModelCatalog(
      {
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      },
      { fetch },
    );

    await expect(catalog?.listVideoModels()).resolves.toMatchObject([
      {
        id: "video-model",
        capabilityMetadata: {
          text_to_video: {
            resolutions: ["720p"],
            durationSeconds: { min: 4, max: 8 },
          },
        },
      },
    ]);
  });

  it("prefers the models-projected protocol over alias-prefix matching", async () => {
    resetDofeModelProtocolCache();
    // "glm-5.2" does not start with gemini-/claude-, so without a projection it
    // would route to openai. The gateway projects preferred_protocol:"gemini",
    // which must win after a catalog refresh.
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({ data: [{ id: "glm-5.2", owned_by: "zhipu" }] }),
        );
      }
      return new Response(
        JSON.stringify({
          model_type: "text",
          capabilities: [],
          preferred_protocol: "gemini",
          supported_protocols: ["gemini", "openai"],
        }),
      );
    });
    const catalog = createDofeModelCatalog(
      {
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      },
      { fetch },
    );

    const models = await catalog?.listChatModels();
    expect(models?.[0]?.preferredProtocol).toBe("gemini");
    expect(models?.[0]?.supportedProtocols).toEqual(["gemini", "openai"]);
    expect(resolveDofeModelProtocol("glm-5.2")).toBe("gemini");
    resetDofeModelProtocolCache();
  });

  it("ignores invalid protocol projection values", async () => {
    resetDofeModelProtocolCache();
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({ data: [{ id: "glm-5.2", owned_by: "zhipu" }] }),
        );
      }
      return new Response(
        JSON.stringify({
          model_type: "text",
          capabilities: [],
          preferred_protocol: "bogus",
          supported_protocols: ["gemini", 42, null, "openai"],
        }),
      );
    });
    const catalog = createDofeModelCatalog(
      {
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      },
      { fetch },
    );

    const models = await catalog?.listChatModels();
    expect(models?.[0]?.preferredProtocol).toBeUndefined();
    expect(models?.[0]?.supportedProtocols).toEqual(["gemini", "openai"]);
    // No projection cached → falls back to the alias-prefix heuristic.
    expect(resolveDofeModelProtocol("glm-5.2")).toBe("openai");
    resetDofeModelProtocolCache();
  });

  it("keeps the rest of the catalog when one capability fetch fails", async () => {
    // A single flaky capability endpoint must not empty the whole catalog.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/v1/models")) {
        return new Response(
          JSON.stringify({
            data: [
              { id: "glm-5.2", owned_by: "zhipu" },
              { id: "gpt-5.4", owned_by: "dofe-ai" },
              { id: "broken-alias", owned_by: "x" },
            ],
          }),
        );
      }
      if (url.includes("broken-alias")) {
        return new Response("", { status: 500 });
      }
      return new Response(
        JSON.stringify({ model_type: "text", capabilities: [] }),
      );
    });
    const catalog = createDofeModelCatalog(
      {
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      },
      { fetch },
    );

    const models = await catalog?.listChatModels();

    // The two healthy aliases are still classified; the broken one is dropped.
    expect(models?.map((m) => m.id)).toEqual(["glm-5.2", "gpt-5.4"]);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0]?.[0]).toContain("dropped 1/3");
    warnSpy.mockRestore();
  });
});
