import { describe, expect, it, vi } from "vitest";

import { createTosObjectStorage } from "./tos-object-storage.js";
import type { TosConfig } from "./tos-config.js";

const config: TosConfig = {
  accessKey: "access-key",
  bucket: "lovart-assets",
  bucketDomain: "https://assets.example.test",
  endpoint: "https://tos.example.test",
  internalBucketDomain: "https://assets.internal.example.test",
  internalEndpoint: "https://tos.internal.example.test",
  region: "cn-beijing",
  secretKey: "secret-key",
};

describe("createTosObjectStorage", () => {
  it("writes through the internal endpoint and issues reads through the public bucket domain", async () => {
    const client = {
      deleteObject: vi.fn().mockResolvedValue({}),
      getPreSignedUrl: vi.fn().mockReturnValue("https://signed.example.test/asset"),
      putObject: vi.fn().mockResolvedValue({ headers: { etag: "etag-1" } }),
    };
    const storage = createTosObjectStorage(config, client);

    const object = await storage.put({
      body: Buffer.from("asset"),
      contentType: "image/png",
      key: "workspaces/workspace-1/assets/asset.png",
    });
    const url = storage.createReadUrl(object.key, 900);

    expect(client.putObject).toHaveBeenCalledWith({
      body: Buffer.from("asset"),
      bucket: "lovart-assets",
      contentType: "image/png",
      key: "workspaces/workspace-1/assets/asset.png",
    });
    expect(client.getPreSignedUrl).toHaveBeenCalledWith({
      alternativeEndpoint: "https://assets.example.test",
      bucket: "lovart-assets",
      expires: 900,
      isCustomDomain: true,
      key: "workspaces/workspace-1/assets/asset.png",
      method: "GET",
    });
    expect(object.etag).toBe("etag-1");
    expect(url).toBe("https://signed.example.test/asset");
  });
});
