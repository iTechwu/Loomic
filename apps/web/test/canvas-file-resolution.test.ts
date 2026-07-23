import { describe, expect, it, vi } from "vitest";

import { resolveCanvasFiles } from "../src/lib/canvas-elements";

describe("resolveCanvasFiles", () => {
  it("hydrates signed storage URLs before Excalidraw receives generated image files", async () => {
    const fetchDataURL = vi.fn().mockResolvedValue(
      "data:image/png;base64,aW1hZ2U=",
    );

    const files = await resolveCanvasFiles(
      {
        "generated-file": {
          id: "generated-file",
          storageUrl: "https://dofe-system.example.test/generation/logo.png?signature=1",
          mimeType: "image/png",
          created: 1_700_000_000_000,
        },
      },
      fetchDataURL,
    );

    expect(fetchDataURL).toHaveBeenCalledWith(
      "https://dofe-system.example.test/generation/logo.png?signature=1",
    );
    expect(files).toEqual([
      {
        id: "generated-file",
        dataURL: "data:image/png;base64,aW1hZ2U=",
        mimeType: "image/png",
        created: 1_700_000_000_000,
      },
    ]);
  });
});
