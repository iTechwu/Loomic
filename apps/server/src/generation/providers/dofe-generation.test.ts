import { afterEach, describe, expect, it, vi } from "vitest";

import type { VideoModelInfo } from "../types.js";
import type { GenerationError } from "../utils.js";
import { DofeImageProvider, DofeVideoProvider } from "./dofe-generation.js";

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

describe("DofeVideoProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeVideoProvider(options?: {
    videoToVideo?: boolean;
    fetchMock?: typeof fetch;
  }) {
    if (options?.fetchMock) {
      vi.stubGlobal("fetch", options.fetchMock);
    }
    const provider = new DofeVideoProvider("https://ixicai.cn/api");
    const modelInfo: VideoModelInfo = {
      id: "happyhorse-1.0-video-edit",
      displayName: "HappyHorse V2V",
      description: "Test video model",
      capabilities: {
        textToVideo: true,
        imageToVideo: true,
        videoToVideo: options?.videoToVideo ?? true,
        audio: false,
      },
    };
    provider.setModels([modelInfo]);
    return { provider, modelInfo };
  }

  function successResponse(taskOverrides?: Record<string, unknown>) {
    return new Response(
      JSON.stringify({
        taskId: "task_456",
        status: "succeeded",
        outputAssets: [
          {
            assetId: "asset_456",
            url: "https://example.com/video.mp4",
            mimeType: "video/mp4",
            durationSeconds: 6,
          },
        ],
        ...taskOverrides,
      }),
      { status: 201 },
    );
  }

  function captureBodyFetchMock() {
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requestInit = init;
      return successResponse();
    });
    return {
      fetchMock,
      getRequestInit: () => requestInit,
    };
  }

  it("submits text-to-video tasks without a video_url block", async () => {
    const { fetchMock, getRequestInit } = captureBodyFetchMock();
    const { provider } = makeVideoProvider({ fetchMock });

    await provider.generate({
      auth: { designApiKey: "test-key" },
      model: "happyhorse-1.0-video-edit",
      prompt: "A test video",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://ixicai.cn/api/generation/tasks",
      expect.objectContaining({ method: "POST" }),
    );
    const requestInit = getRequestInit();
    if (!requestInit) throw new Error("expected a generation request");
    const body = JSON.parse(requestInit.body as string);
    expect(body.content).toEqual([
      {
        part: { type: "text", text: "A test video" },
        order: 0,
        role: "prompt",
      },
    ]);
    expect(body.params.videoOperation).toBeUndefined();
  });

  it("maps inputVideo to video_url with source_video role for video_edit", async () => {
    const { fetchMock, getRequestInit } = captureBodyFetchMock();
    const { provider } = makeVideoProvider({ fetchMock });

    await provider.generate({
      auth: { designApiKey: "test-key" },
      model: "happyhorse-1.0-video-edit",
      prompt: "Extend this video",
      inputVideo: "https://example.com/input.mp4",
    });

    const requestInit = getRequestInit();
    if (!requestInit) throw new Error("expected a generation request");
    const body = JSON.parse(requestInit.body as string);
    expect(body.content).toEqual([
      {
        part: { type: "text", text: "Extend this video" },
        order: 0,
        role: "prompt",
      },
      {
        part: {
          type: "video_url",
          video_url: { url: "https://example.com/input.mp4" },
        },
        order: 1,
        role: "source_video",
      },
    ]);
    expect(body.params.videoOperation).toBe("video_edit");
  });

  it("maps inputVideo to motion_reference role for motion_control", async () => {
    const { fetchMock, getRequestInit } = captureBodyFetchMock();
    const { provider } = makeVideoProvider({ fetchMock });

    await provider.generate({
      auth: { designApiKey: "test-key" },
      model: "happyhorse-1.0-video-edit",
      prompt: "Motion transfer",
      inputVideo: "https://example.com/input.mp4",
      videoOperation: "motion_control",
    });

    const requestInit = getRequestInit();
    if (!requestInit) throw new Error("expected a generation request");
    const body = JSON.parse(requestInit.body as string);
    expect(body.content[1]).toEqual({
      part: {
        type: "video_url",
        video_url: { url: "https://example.com/input.mp4" },
      },
      order: 1,
      role: "motion_reference",
    });
    expect(body.params.videoOperation).toBe("motion_control");
  });

  it("rejects inputVideo when the model does not support video-to-video", async () => {
    const { fetchMock, getRequestInit } = captureBodyFetchMock();
    const { provider } = makeVideoProvider({ fetchMock, videoToVideo: false });

    await expect(
      provider.generate({
        auth: { designApiKey: "test-key" },
        model: "happyhorse-1.0-video-edit",
        prompt: "A test video",
        inputVideo: "https://example.com/input.mp4",
      }),
    ).rejects.toMatchObject({
      code: "invalid_input",
    } satisfies Partial<GenerationError>);
    expect(getRequestInit()).toBeUndefined();
  });

  it("unwraps the Models envelope response", async () => {
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      return new Response(
        JSON.stringify({
          code: 0,
          msg: "ok",
          data: {
            taskId: "task_789",
            status: "succeeded",
            outputAssets: [
              {
                assetId: "asset_789",
                url: "https://example.com/video.mp4",
                mimeType: "video/mp4",
                durationSeconds: 5,
              },
            ],
          },
        }),
        { status: 201 },
      );
    });
    const { provider } = makeVideoProvider({ fetchMock });

    const result = await provider.generate({
      auth: { designApiKey: "test-key" },
      model: "happyhorse-1.0-video-edit",
      prompt: "A test video",
    });

    expect(result.url).toBe("https://example.com/video.mp4");
    expect(result.mimeType).toBe("video/mp4");
    expect(result.durationSeconds).toBe(5);
  });

  it("does not expose a gateway error body to callers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("provider secret=should-not-leak", { status: 502 }),
      ),
    );
    const { provider } = makeVideoProvider();

    await expect(
      provider.generate({
        auth: { designApiKey: "test-key" },
        model: "happyhorse-1.0-video-edit",
        prompt: "A test video",
      }),
    ).rejects.toMatchObject({
      code: "api_error",
      message: "DoFe createTask failed with HTTP 502.",
    } satisfies Partial<GenerationError>);
  });
});
