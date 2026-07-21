import { describe, expect, it } from "vitest";

import { toCatalogVideoModelInfo } from "./register-all.js";

describe("toCatalogVideoModelInfo", () => {
  it("projects only published video capabilities and their public boundaries", () => {
    const model = toCatalogVideoModelInfo({
      id: "seedance-2.0",
      modelType: "video",
      capabilities: ["text_to_video", "image_to_video"],
      capabilityMetadata: {
        text_to_video: {
          resolutions: ["720p", "1080p"],
          durationSeconds: { min: 4, max: 8 },
          maxInputAssets: 2,
          supportsGenerateAudio: true,
        },
      },
    });

    expect(model).toMatchObject({
      id: "seedance-2.0",
      capabilities: {
        textToVideo: true,
        imageToVideo: true,
        videoToVideo: false,
        audio: true,
      },
    });
    expect(model.capabilityMetadata).toEqual({
      text_to_video: {
        resolutions: ["720p", "1080p"],
        durationSeconds: { min: 4, max: 8 },
        maxInputAssets: 2,
        supportsGenerateAudio: true,
      },
    });
    expect(model.capabilities.audio).toBe(true);
    expect(model.limits).toBeUndefined();
  });

  it("keeps an unsupported capability disabled instead of inferring it from model type", () => {
    const model = toCatalogVideoModelInfo({
      id: "editor-only",
      modelType: "video",
      capabilities: ["video_to_video", "unrelated_capability"],
    });

    expect(model.capabilities).toEqual({
      textToVideo: false,
      imageToVideo: false,
      videoToVideo: true,
      audio: false,
    });
  });
});
