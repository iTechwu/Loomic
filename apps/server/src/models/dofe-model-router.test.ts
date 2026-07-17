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
    expect(dofeModelProtocolBaseUrl("https://ixicai.cn/api", "gemini"))
      .toBe("https://ixicai.cn/api/gemini");
    expect(dofeModelProtocolBaseUrl("https://ixicai.cn/api", "anthropic"))
      .toBe("https://ixicai.cn/api/anthropic");
    expect(dofeModelProtocolBaseUrl("https://ixicai.cn/api", "openai"))
      .toBe("https://ixicai.cn/api/v1");
  });

  it("keeps chat aliases and excludes asynchronous media aliases", () => {
    expect(isChatModelAlias("gpt-5.4")).toBe(true);
    expect(isChatModelAlias("claude-sonnet-4.6")).toBe(true);
    expect(isChatModelAlias("imagen-4.0-generate-001")).toBe(false);
    expect(isChatModelAlias("seedance-2.0")).toBe(false);
  });

  it("migrates existing provider-prefixed settings to router aliases", () => {
    expect(toDofeRouterModelId("openai:gpt-5.4")).toBe("gpt-5.4");
    expect(toDofeRouterModelId("google:gemini-3.1-flash")).toBe("gemini-3.1-flash");
    expect(toDofeRouterModelId("dofe:claude-sonnet-4.6")).toBe("claude-sonnet-4.6");
  });

  it("authenticates, filters, and caches the gateway catalog", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [
        { id: "gpt-5.4", owned_by: "dofe-ai" },
        { id: "gpt-image-1.5", owned_by: "dofe-ai" },
      ],
    })));
    const catalog = createDofeModelCatalog({
      dofeModelApiKey: "router-key",
      dofeModelBaseUrl: "https://ixicai.cn/api",
    }, { fetch });

    await expect(catalog?.listChatModels()).resolves.toEqual([
      { id: "gpt-5.4", ownedBy: "dofe-ai" },
    ]);
    await catalog?.listChatModels();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("https://ixicai.cn/api/v1/models", {
      headers: { Authorization: "Bearer router-key" },
    });
  });
});
