import { describe, expect, it, vi } from "vitest";

import {
  createDofeModelCatalog,
  dofeModelProtocolBaseUrl,
  isChatModelAlias,
  resolveDofeModelProtocol,
  toDofeRouterModelId,
} from "./dofe-model-router.js";

describe("DoFe model router", () => {
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
        return new Response(JSON.stringify({ data: [
          { id: "glm-5.2", owned_by: "zhipu" },
          { id: "gpt-5.4", owned_by: "dofe-ai" },
          { id: "seedream-5.0", owned_by: "bytedance" },
        ] }));
      }
      const modelType = url.includes("seedream-5.0") ? "image" : "text";
      return new Response(JSON.stringify({ model_type: modelType }));
    });
    const catalog = createDofeModelCatalog({
      dofeModelApiKey: "router-key",
      dofeModelBaseUrl: "https://ixicai.cn/api",
    }, { fetch });

    await expect(catalog?.listChatModels()).resolves.toEqual([
      { id: "glm-5.2", ownedBy: "zhipu", modelType: "text" },
      { id: "gpt-5.4", ownedBy: "dofe-ai", modelType: "text" },
    ]);
    await catalog?.listChatModels();

    await expect(catalog?.listImageModels()).resolves.toEqual([
      { id: "seedream-5.0", ownedBy: "bytedance", modelType: "image" },
    ]);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch).toHaveBeenCalledWith("https://ixicai.cn/api/v1/models", {
      headers: { Authorization: "Bearer router-key" },
    });
  });
});
