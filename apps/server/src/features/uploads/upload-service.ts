import { randomUUID } from "node:crypto";

import type { AssetBucket, AssetObject } from "@lovart.dofe/shared";

import type { NativeAssetRow, NativeDataRepository } from "../../database/native-data-repository.js";
import type { TosObjectStorage } from "../../storage/tos-object-storage.js";
import type { AuthenticatedUser } from "../../auth/sso-authenticator.js";
import { logOperationalFailure } from "../../utils/operational-log.js";

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
      const storage = options.storage.forBucket(input.bucket);
      try {
        const uploaded = await storage.put({ body: input.fileBuffer, contentType: input.mimeType, key: objectPath });
        const asset = await options.repository.createAsset({
          bucket: input.bucket, byteSize: input.fileBuffer.length, createdBy: user.id, etag: uploaded.etag,
          mimeType: input.mimeType, objectPath, ...(input.projectId ? { projectId: input.projectId } : {}), workspaceId: input.workspaceId,
        });
        if (!asset) {
          await storage.delete(objectPath).catch(() =>
            logOperationalFailure(
              "[upload-service] orphan cleanup failed",
              "upload_orphan_cleanup",
            ),
          );
          throw new Error("Metadata authorization failed");
        }
        return { asset: mapAsset(asset), url: storage.createReadUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS) };
      } catch (error) {
        // Surface the underlying cause (TOS NoSuchBucket/timeout/credentials,
        // DB error, or workspace authorization) for ops debugging. The client
        // still receives the sanitized UploadServiceError below — only the
        // server log sees the technical detail.
        const detail = error instanceof Error ? error.message : String(error);
        console.error("[upload-service] upload failed", {
          failureCategory: "upload_create",
          bucket: input.bucket,
          objectPath,
          error: detail,
        });
        throw new UploadServiceError("upload_failed", "Unable to upload asset.", 500);
      }
    },
    async getAssetUrl(user, assetId) {
      const asset = await options.repository.findAsset(user.id, assetId);
      if (!asset) throw new UploadServiceError("asset_not_found", "Asset not found.", 404);
      return options.storage.forBucket(asset.bucket).createReadUrl(asset.object_path, SIGNED_URL_EXPIRY_SECONDS);
    },
    async deleteAsset(user, assetId) {
      const asset = await options.repository.findAsset(user.id, assetId);
      if (!asset) throw new UploadServiceError("asset_not_found", "Asset not found.", 404);
      try {
        await options.storage.forBucket(asset.bucket).delete(asset.object_path);
        if (!await options.repository.removeAsset(user.id, assetId)) throw new UploadServiceError("asset_not_found", "Asset not found.", 404);
      } catch (error) {
        if (error instanceof UploadServiceError) throw error;
        logOperationalFailure("[upload-service] delete failed", "upload_delete");
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
  // pg returns bigint columns (byte_size) as strings, but assetObjectSchema
  // expects a number — coerce here. Sizes are bounded by file limits, well
  // within Number.MAX_SAFE_INTEGER. See job-repository for the same pattern.
  return { bucket: asset.bucket, byteSize: asset.byte_size == null ? null : Number(asset.byte_size), createdAt: asset.created_at.toISOString(), id: asset.id, mimeType: asset.mime_type, objectPath: asset.object_path, projectId: asset.project_id, workspaceId: asset.workspace_id };
}
