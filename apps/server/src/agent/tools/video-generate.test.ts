import { describe, expect, it, vi } from "vitest";

import { runVideoGenerate } from "./video-generate.js";

describe("runVideoGenerate", () => {
  it("does not invent model-controlled parameters for queued generation", async () => {
    const submitVideoJob = vi.fn(async () => ({
      jobId: "job_1",
      durationSeconds: 6,
      width: 1280,
      height: 720,
    }));

    await runVideoGenerate(
      {
        title: "A catalog-controlled video",
        prompt: "A calm sea at sunrise",
        model: "authorized-video-model",
      },
      submitVideoJob,
    );

    expect(submitVideoJob).toHaveBeenCalledWith({
      prompt: "A calm sea at sunrise",
      model: "authorized-video-model",
    });
  });
});
