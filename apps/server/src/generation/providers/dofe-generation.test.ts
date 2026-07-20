import { afterEach, describe, expect, it, vi } from "vitest";

import type { GenerationError } from "../utils.js";
import { DofeImageProvider } from "./dofe-generation.js";

describe("DofeImageProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits image tasks through the ixicai generation contract", async () => {
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requestInit = init;
      return new Response(
        JSON.stringify({
          taskId: "task_123",
          status: "succeeded",
          outputAssets: [
            { assetId: "asset_123", url: "https://example.com/image.png" },
          ],
        }),
        { status: 201 },
      );
    });
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
    if (!requestInit) throw new Error("expected a generation request");
    expect(JSON.parse(requestInit.body as string).content).toEqual([
      {
        part: { type: "text", text: "A test image" },
        order: 0,
        role: "prompt",
      },
    ]);
  });

  it("does not expose a gateway error body to callers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("provider secret=should-not-leak", { status: 502 }),
      ),
    );
    const provider = new DofeImageProvider("https://ixicai.cn/api");

    await expect(
      provider.generate({
        auth: { designApiKey: "test-key" },
        model: "seedream-5.0",
        prompt: "A test image",
      }),
    ).rejects.toMatchObject({
      code: "api_error",
      message: "DoFe createTask failed with HTTP 502.",
    } satisfies Partial<GenerationError>);
  });

  it("rejects a malformed task response before it reaches the poller", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ taskId: "task_123" }, { status: 201 })),
    );
    const provider = new DofeImageProvider("https://ixicai.cn/api");

    await expect(
      provider.generate({
        auth: { designApiKey: "test-key" },
        model: "seedream-5.0",
        prompt: "A test image",
      }),
    ).rejects.toMatchObject({
      code: "api_contract_error",
    } satisfies Partial<GenerationError>);
  });
});
