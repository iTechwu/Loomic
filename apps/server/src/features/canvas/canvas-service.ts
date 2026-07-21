import type { CanvasContent, CanvasDetail } from "@lovart.dofe/shared";

import type { NativeDataRepository } from "../../database/native-data-repository.js";
import type { TosObjectStorage } from "../../storage/tos-object-storage.js";
import type { AuthenticatedUser } from "../../auth/sso-authenticator.js";
import {
  logOperationalFailure,
  logOperationalWarning,
} from "../../utils/operational-log.js";

const TOS_MARKER_PREFIX = "tos://";
const SIGNED_URL_EXPIRY_SECONDS = 3600;

export class CanvasServiceError extends Error {
  constructor(readonly code: "canvas_not_found" | "canvas_save_failed", message: string, readonly statusCode: number) { super(message); }
}

export type CanvasService = {
  getCanvas(user: AuthenticatedUser, canvasId: string): Promise<CanvasDetail>;
  saveCanvasContent(user: AuthenticatedUser, canvasId: string, content: CanvasContent): Promise<void>;
};

type CanvasFileRecord = Record<string, Record<string, unknown>>;

export function createCanvasService(options: { repository: NativeDataRepository; storage: TosObjectStorage }): CanvasService {
  return {
    async getCanvas(user, canvasId) {
      const canvas = await options.repository.findCanvas(user.id, canvasId);
      if (!canvas) throw new CanvasServiceError("canvas_not_found", "Canvas not found.", 404);
      return {
        content: resolveFiles(options.storage, canvas.content as CanvasContent),
        id: canvas.id,
        name: canvas.name,
        projectId: canvas.project_id,
      };
    },
    async saveCanvasContent(user, canvasId, content) {
      try {
        const leanContent = await extractFiles(options.storage, canvasId, content);
        if (!await options.repository.saveCanvas(user.id, canvasId, leanContent as unknown as import("@lovart.dofe/shared").Json)) {
          throw new CanvasServiceError("canvas_not_found", "Canvas not found.", 404);
        }
      } catch (error) {
        if (error instanceof CanvasServiceError) throw error;
        logOperationalFailure(
          "[canvas-service] save failed",
          "canvas_save",
        );
        throw new CanvasServiceError("canvas_save_failed", "Unable to save canvas.", 500);
      }
    },
  };
}

async function extractFiles(storage: TosObjectStorage, canvasId: string, content: CanvasContent): Promise<CanvasContent> {
  const files = (content as { files?: CanvasFileRecord }).files;
  if (!files || !Object.keys(files).length) return content;
  const updated: CanvasFileRecord = {};
  await Promise.all(Object.entries(files).map(async ([fileId, file]) => {
    const dataURL = typeof file.dataURL === "string" ? file.dataURL : undefined;
    if (!dataURL?.startsWith("data:")) { updated[fileId] = file; return; }
    try {
      const { buffer, mimeType } = parseDataURL(dataURL);
      const key = `canvas-files/${canvasId}/${fileId}.${mimeToExt(mimeType)}`;
      await storage.put({ body: buffer, contentType: mimeType, key });
      updated[fileId] = { ...file, dataURL: `${TOS_MARKER_PREFIX}${key}` };
    } catch {
      // Retaining an inline file is safer than losing an asset when the object store is unavailable.
      logOperationalWarning(
        "[canvas-service] file extraction deferred",
        "canvas_file_extract",
      );
      updated[fileId] = file;
    }
  }));
  return { ...content, files: updated } as CanvasContent;
}

function resolveFiles(storage: TosObjectStorage, content: CanvasContent): CanvasContent {
  const files = (content as { files?: CanvasFileRecord }).files;
  if (!files || !Object.keys(files).length) return content;
  const updated: CanvasFileRecord = {};
  for (const [fileId, file] of Object.entries(files)) {
    const dataURL = typeof file.dataURL === "string" ? file.dataURL : undefined;
    const key = markerKey(dataURL);
    const bucket = typeof file.bucket === "string" ? (file.bucket as import("@lovart.dofe/shared").AssetBucket) : undefined;
    updated[fileId] = key
      ? { ...file, dataURL: undefined, storageUrl: (bucket ? storage.forBucket(bucket) : storage).createReadUrl(key, SIGNED_URL_EXPIRY_SECONDS) }
      : file;
  }
  return { ...content, files: updated } as CanvasContent;
}

function markerKey(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith(TOS_MARKER_PREFIX)) return value.slice(TOS_MARKER_PREFIX.length) || null;
  // Legacy TOS/CDN markers used the same object key after the bucket name.
  if (value.startsWith("oss://")) {
    const slash = value.indexOf("/", "oss://".length);
    return slash === -1 ? null : value.slice(slash + 1) || null;
  }
  return null;
}

function parseDataURL(value: string): { buffer: Buffer; mimeType: string } {
  const match = value.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Invalid data URL");
  return { buffer: Buffer.from(match[2]!, "base64"), mimeType: match[1]! };
}

function mimeToExt(mimeType: string): string {
  return ({ "image/gif": "gif", "image/jpeg": "jpg", "image/png": "png", "image/svg+xml": "svg", "image/webp": "webp" } as Record<string, string>)[mimeType] ?? "bin";
}
