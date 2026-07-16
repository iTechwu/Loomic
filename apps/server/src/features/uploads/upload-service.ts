import { randomUUID } from "node:crypto";

import type { AssetBucket, AssetObject } from "@lovart.dofe/shared";

import type { NativeAssetRow, NativeDataRepository } from "../../database/native-data-repository.js";
import type { TosObjectStorage } from "../../storage/tos-object-storage.js";
import type { AuthenticatedUser } from "../../auth/sso-authenticator.js";

const SIGNED_URL_EXPIRY_SECONDS = 3600;

export class UploadServiceError extends Error {
  constructor(readonly code: "upload_failed" | "asset_not_found", message: string, readonly statusCode: number) { super(message); }
}

export type UploadFileInput = { bucket: AssetBucket; fileName: string; fileBuffer: Buffer; mimeType: string; workspaceId: string; projectId?: string | undefined };
export type UploadService = {
  uploadFile(user: AuthenticatedUser, input: UploadFileInput): Promise<{ asset: AssetObject; url: string }>;
  getAssetUrl(user: AuthenticatedUser, assetId: string): Promise<string>;
  deleteAsset(user: AuthenticatedUser, assetId: string): Promise<void>;
};

export function createUploadService(options: { repository: NativeDataRepository; storage: TosObjectStorage }): UploadService {
  return {
    async uploadFile(user, input) {
      const objectPath = buildObjectPath(input.workspaceId, input.projectId, input.fileName);
      try {
        const uploaded = await options.storage.put({ body: input.fileBuffer, contentType: input.mimeType, key: objectPath });
        const asset = await options.repository.createAsset({
          bucket: input.bucket, byteSize: input.fileBuffer.length, createdBy: user.id, etag: uploaded.etag,
          mimeType: input.mimeType, objectPath, ...(input.projectId ? { projectId: input.projectId } : {}), workspaceId: input.workspaceId,
        });
        if (!asset) {
          await options.storage.delete(objectPath).catch((error: unknown) => console.error("[upload-service] orphan cleanup failed", { objectPath, message: error instanceof Error ? error.message : String(error) }));
          throw new Error("Metadata authorization failed");
        }
        return { asset: mapAsset(asset), url: options.storage.createReadUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS) };
      } catch (error) {
        console.error("[upload-service] upload failed", { message: error instanceof Error ? error.message : String(error), userId: user.id });
        throw new UploadServiceError("upload_failed", "Unable to upload asset.", 500);
      }
    },
    async getAssetUrl(user, assetId) {
      const asset = await options.repository.findAsset(user.id, assetId);
      if (!asset) throw new UploadServiceError("asset_not_found", "Asset not found.", 404);
      return options.storage.createReadUrl(asset.object_path, SIGNED_URL_EXPIRY_SECONDS);
    },
    async deleteAsset(user, assetId) {
      const asset = await options.repository.findAsset(user.id, assetId);
      if (!asset) throw new UploadServiceError("asset_not_found", "Asset not found.", 404);
      try {
        await options.storage.delete(asset.object_path);
        if (!await options.repository.removeAsset(user.id, assetId)) throw new UploadServiceError("asset_not_found", "Asset not found.", 404);
      } catch (error) {
        if (error instanceof UploadServiceError) throw error;
        console.error("[upload-service] delete failed", { assetId, message: error instanceof Error ? error.message : String(error), userId: user.id });
        throw new UploadServiceError("upload_failed", "Unable to delete asset.", 500);
      }
    },
  };
}

function buildObjectPath(workspaceId: string, projectId: string | undefined, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120) || "asset";
  return projectId ? `assets/${workspaceId}/${projectId}/${randomUUID()}-${safeName}` : `assets/${workspaceId}/${randomUUID()}-${safeName}`;
}

function mapAsset(asset: NativeAssetRow): AssetObject {
  return { bucket: asset.bucket, byteSize: asset.byte_size, createdAt: asset.created_at.toISOString(), id: asset.id, mimeType: asset.mime_type, objectPath: asset.object_path, projectId: asset.project_id, workspaceId: asset.workspace_id };
}
