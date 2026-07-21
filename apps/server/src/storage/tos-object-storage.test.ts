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
      copyObject: vi.fn().mockResolvedValue({ data: { ETag: "etag-copy" } }),
      deleteObject: vi.fn().mockResolvedValue({}),
      getPreSignedUrl: vi
        .fn()
        .mockReturnValue("https://signed.example.test/asset"),
      putObject: vi.fn().mockResolvedValue({ headers: { etag: "etag-1" } }),
    };
    const storage = createTosObjectStorage(config, client);

    const object = await storage.put({
      body: Buffer.from("asset"),
      contentType: "image/png",
      key: "workspaces/workspace-1/assets/asset.png",
    });
    const url = storage.createReadUrl(object.key, 900);
    const copy = await storage.copy(
      object.key,
      "workspaces/workspace-1/assets/copy.png",
    );

    expect(client.putObject).toHaveBeenCalledWith({
      body: Buffer.from("asset"),
      bucket: "lovart-assets",
      contentType: "image/png",
      key: "workspaces/workspace-1/assets/asset.png",
    });
    expect(client.getPreSignedUrl).toHaveBeenCalledWith({
      alternativeEndpoint: "assets.example.test",
      bucket: "lovart-assets",
      expires: 900,
      isCustomDomain: true,
      key: "workspaces/workspace-1/assets/asset.png",
      method: "GET",
    });
    expect(object.etag).toBe("etag-1");
    expect(client.copyObject).toHaveBeenCalledWith({
      bucket: "lovart-assets",
      key: "workspaces/workspace-1/assets/copy.png",
      srcBucket: "lovart-assets",
      srcKey: "workspaces/workspace-1/assets/asset.png",
    });
    expect(copy.etag).toBe("etag-copy");
    expect(url).toBe("https://signed.example.test/asset");
  });

  it("forBucket('dofe-system') signs for the DoFe system bucket domain", () => {
    const client = {
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      getPreSignedUrl: vi
        .fn()
        .mockReturnValue("https://signed-dofe.example.test/asset"),
      putObject: vi.fn(),
    };
    const storage = createTosObjectStorage(config, client);
    const systemStorage = storage.forBucket("dofe-system");

    const url = systemStorage.createReadUrl("generation/asset.png", 900);

    expect(client.getPreSignedUrl).toHaveBeenCalledWith({
      alternativeEndpoint: "dofe-system.tos.example.test",
      bucket: "dofe-system",
      expires: 900,
      isCustomDomain: true,
      key: "generation/asset.png",
      method: "GET",
    });
    expect(url).toBe("https://signed-dofe.example.test/asset");
  });

  it("forBucket('dofe-system') uses explicit systemBucketDomain when configured", () => {
    const client = {
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      getPreSignedUrl: vi
        .fn()
        .mockReturnValue("https://signed-dofe.example.test/asset"),
      putObject: vi.fn(),
    };
    const customConfig: TosConfig = {
      ...config,
      systemBucketDomain: "https://cdn.dofe-system.example.test",
    };
    const storage = createTosObjectStorage(customConfig, client);
    const systemStorage = storage.forBucket("dofe-system");

    systemStorage.createReadUrl("generation/asset.png", 900);

    expect(client.getPreSignedUrl).toHaveBeenCalledWith({
      alternativeEndpoint: "cdn.dofe-system.example.test",
      bucket: "dofe-system",
      expires: 900,
      isCustomDomain: true,
      key: "generation/asset.png",
      method: "GET",
    });
  });

  it("forBucket returns the same instance for the configured app bucket", () => {
    const client = {
      copyObject: vi.fn(),
      deleteObject: vi.fn(),
      getPreSignedUrl: vi.fn().mockReturnValue("https://signed.example.test"),
      putObject: vi.fn(),
    };
    const storage = createTosObjectStorage(config, client);
    expect(storage.forBucket("lovart-assets")).toBe(storage);
  });
});
