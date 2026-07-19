import { afterEach, describe, expect, it, vi } from "vitest";

import { DofeImageProvider } from "./dofe-generation.js";

describe("DofeImageProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits image tasks through the ixicai generation contract", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      taskId: "task_123",
      status: "succeeded",
      outputAssets: [{ assetId: "asset_123", url: "https://example.com/image.png" }],
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new DofeImageProvider("https://ixicai.cn/api");
    await provider.generate({
      auth: { designApiKey: "test-key" },
      model: "seedream-5.0",
      prompt: "A test image",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ixicai.cn/api/generation/tasks",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
