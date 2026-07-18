import { describe, expect, it, vi } from "vitest";

import { createDofeModelCatalog } from "./dofe-model-router.js";

describe("createDofeModelCatalog", () => {
  it("uses the ixicai OpenAI-compatible data plane and excludes media models", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [
            { id: "glm-5.2", owned_by: "zhipu" },
            { id: "deepseek-v4-pro", owned_by: "deepseek" },
            { id: "seedream-5.0", owned_by: "bytedance" },
          ],
        }),
      ),
    );
    const catalog = createDofeModelCatalog(
      {
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      },
      { fetch },
    );

    await expect(catalog?.listChatModels()).resolves.toEqual([
      { id: "deepseek-v4-pro", ownedBy: "deepseek" },
      { id: "glm-5.2", ownedBy: "zhipu" },
    ]);
    expect(fetch).toHaveBeenCalledWith("https://ixicai.cn/api/v1/models", {
      headers: { Authorization: "Bearer router-key" },
    });
  });
});
