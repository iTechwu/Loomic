import { describe, expect, it, vi } from "vitest";

import { createImageGenerateTool, runImageGenerate } from "./image-generate.js";

describe("runImageGenerate", () => {
  it("defaults omitted model calls to the manually selected model only", () => {
    const tool = createImageGenerateTool({
      availableModels: [
        {
          id: "default-image-model",
          displayName: "Default image model",
          description: "Default",
          provider: "test",
        },
        {
          id: "manual-image-model",
          displayName: "Manual image model",
          description: "Manual",
          provider: "test",
        },
      ],
      manualModelIds: ["manual-image-model"],
    });

    const parsed = tool.schema.parse({
      title: "Manual image",
      prompt: "Generate a poster",
    });

    expect(parsed.model).toBe("manual-image-model");
    expect(
      tool.schema.safeParse({
        title: "Wrong model",
        prompt: "Generate a poster",
        model: "default-image-model",
      }).success,
    ).toBe(false);
  });

  it("uses uploaded attachments as references when the tool call omits inputImages", async () => {
    const submitImageJob = vi.fn(async () => ({
      jobId: "job-1",
      imageUrl: "https://example.com/generated.png",
    }));

    await runImageGenerate(
      {
        title: "Reference edit",
        prompt: "Turn the reference into a poster",
        model: "flux-kontext-pro",
      },
      undefined,
      submitImageJob,
      { "reference-1": "data:image/png;base64,aGVsbG8=" },
    );

    expect(submitImageJob).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImages: ["data:image/png;base64,aGVsbG8="],
      }),
    );
  });

  it("keeps explicitly selected references instead of expanding them", async () => {
    const submitImageJob = vi.fn(async () => ({
      jobId: "job-2",
      imageUrl: "https://example.com/generated.png",
    }));

    await runImageGenerate(
      {
        title: "Single reference edit",
        prompt: "Use only the first reference",
        model: "flux-kontext-pro",
        inputImages: ["reference-2"],
      },
      undefined,
      submitImageJob,
      {
        "reference-1": "data:image/png;base64,Zmlyc3Q=",
        "reference-2": "data:image/png;base64,c2Vjb25k",
      },
    );

    expect(submitImageJob).toHaveBeenCalledWith(
      expect.objectContaining({
        inputImages: ["data:image/png;base64,c2Vjb25k"],
      }),
    );
  });
});
