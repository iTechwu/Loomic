import { describe, expect, it } from "vitest";

import { toCatalogVideoModelInfo } from "./register-all.js";

describe("toCatalogVideoModelInfo", () => {
  it("projects only published video capabilities without inventing limits", () => {
    const model = toCatalogVideoModelInfo({
      id: "seedance-2.0",
      modelType: "video",
      capabilities: ["text_to_video", "image_to_video"],
    });

    expect(model).toMatchObject({
      id: "seedance-2.0",
      capabilities: {
        textToVideo: true,
        imageToVideo: true,
        videoToVideo: false,
        audio: false,
      },
    });
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
