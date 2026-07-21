import { describe, expect, it, vi } from "vitest";

import {
  parseTosUrl,
  persistGeneratedAsset,
} from "./generated-asset-persister.js";
import type { NativeDataRepository } from "../../database/native-data-repository.js";
import type { TosObjectStorage } from "../../storage/tos-object-storage.js";

const TOS_ENDPOINT = "https://tos-cn-beijing.volces.com";

describe("parseTosUrl", () => {
  it("parses virtual-hosted style URLs", () => {
    expect(
      parseTosUrl(
        "https://dofe-system.tos-cn-beijing.volces.com/generation/abc.png?X-Tos-Signature=xxx",
        TOS_ENDPOINT,
      ),
    ).toEqual({ bucket: "dofe-system", key: "generation/abc.png" });
  });

  it("parses path-style URLs", () => {
    expect(
      parseTosUrl(
        "https://tos-cn-beijing.volces.com/dofe-system/generation/abc.png?X-Tos-Signature=xxx",
        TOS_ENDPOINT,
      ),
    ).toEqual({ bucket: "dofe-system", key: "generation/abc.png" });
  });

  it("decodes URL-encoded key segments", () => {
    expect(
      parseTosUrl(
        "https://dofe-system.tos-cn-beijing.volces.com/generation/hello%20world.png",
        TOS_ENDPOINT,
      ),
    ).toEqual({ bucket: "dofe-system", key: "generation/hello world.png" });
  });

  it("returns null for non-TOS hosts", () => {
    expect(
      parseTosUrl(
        "https://replicate.delivery/generation/abc.png",
        TOS_ENDPOINT,
      ),
    ).toBeNull();
  });

  it("returns null for invalid URLs", () => {
    expect(parseTosUrl("not-a-url", TOS_ENDPOINT)).toBeNull();
  });
});

describe("persistGeneratedAsset", () => {
  it("extracts the key and records metadata when the URL is already in dofe-system", async () => {
    const dataRepository: NativeDataRepository = {
      createAsset: vi.fn().mockResolvedValue({
        id: "asset-1",
        bucket: "dofe-system",
        object_path: "generation/abc.png",
        mime_type: "image/png",
        byte_size: 1234,
        etag: null,
        workspace_id: "ws-1",
        project_id: null,
        created_at: new Date(),
      }),
    } as unknown as NativeDataRepository;

    const systemStorage: TosObjectStorage = {
      createReadUrl: vi.fn().mockReturnValue("https://signed.example/test"),
      put: vi.fn(),
      delete: vi.fn(),
      copy: vi.fn(),
      forBucket: vi.fn().mockReturnThis(),
    } as unknown as TosObjectStorage;

    const result = await persistGeneratedAsset({
      sourceUrl:
        "https://dofe-system.tos-cn-beijing.volces.com/generation/abc.png?X-Tos-Signature=xxx",
      mimeType: "image/png",
      userId: "user-1",
      workspaceId: "ws-1",
      dataRepository,
      objectStorage: systemStorage,
      tosEndpoint: TOS_ENDPOINT,
    });

    expect(systemStorage.put).not.toHaveBeenCalled();
    expect(dataRepository.createAsset).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "dofe-system",
        objectPath: "generation/abc.png",
        mimeType: "image/png",
        workspaceId: "ws-1",
      }),
    );
    expect(result).toMatchObject({
      assetId: "asset-1",
      bucket: "dofe-system",
      objectPath: "generation/abc.png",
      signedUrl: "https://signed.example/test",
    });
  });

  it("downloads and uploads non-dofe-system URLs into dofe-system", async () => {
    const dataRepository: NativeDataRepository = {
      createAsset: vi.fn().mockResolvedValue({
        id: "asset-2",
        bucket: "dofe-system",
        object_path: expect.stringContaining("generated/ws-1/"),
        mime_type: "image/png",
        byte_size: 4,
        etag: "etag-1",
        workspace_id: "ws-1",
        project_id: null,
        created_at: new Date(),
      }),
    } as unknown as NativeDataRepository;

    const systemStorage: TosObjectStorage = {
      createReadUrl: vi.fn().mockReturnValue("https://signed.example/test"),
      put: vi.fn().mockResolvedValue({ etag: "etag-1", key: "k" }),
      delete: vi.fn(),
      copy: vi.fn(),
      forBucket: vi.fn().mockReturnThis(),
    } as unknown as TosObjectStorage;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => Buffer.from("data"),
    } as unknown as Response);

    const result = await persistGeneratedAsset({
      sourceUrl: "https://replicate.delivery/abc.png",
      mimeType: "image/png",
      userId: "user-1",
      workspaceId: "ws-1",
      dataRepository,
      objectStorage: systemStorage,
      tosEndpoint: TOS_ENDPOINT,
    });

    expect(systemStorage.put).toHaveBeenCalledWith(
      expect.objectContaining({
        body: Buffer.from("data"),
        contentType: "image/png",
        key: expect.stringContaining("generated/ws-1/"),
      }),
    );
    expect(result.bucket).toBe("dofe-system");
  });
});
