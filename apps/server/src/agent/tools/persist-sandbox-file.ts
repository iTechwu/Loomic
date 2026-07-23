import { realpathSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import type { NativeDataRepository } from "../../database/native-data-repository.js";
import type { TosObjectStorage } from "../../storage/tos-object-storage.js";

const MIME_MAP: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const persistSandboxFileSchema = z.object({
  filePath: z
    .string()
    .describe(
      "Absolute path to the file in the sandbox directory (e.g., /tmp/lovart-dofe-sandbox/<runId>/output.png)",
    ),
  title: z
    .string()
    .optional()
    .describe("Optional human-readable title for the file"),
});

export type PersistSandboxFileDeps = {
  dataRepository: NativeDataRepository;
  storage: TosObjectStorage;
  sandboxDir?: string;
};

export function createPersistSandboxFileTool(deps: PersistSandboxFileDeps) {
  return tool(
    async (input, config) => {
      const userId = (config as any)?.configurable?.user_id as
        | string
        | undefined;
      const canvasId = (config as any)?.configurable?.canvas_id as
        | string
        | undefined;

      if (!userId) {
        return "Error: No authenticated user context. Cannot upload file.";
      }

      // Path traversal guard: restrict reads to sandbox directory.
      // Use realpathSync to resolve symlinks (macOS /tmp → /private/tmp).
      if (deps.sandboxDir) {
        try {
          const realFilePath = realpathSync(input.filePath);
          if (!realFilePath.startsWith(deps.sandboxDir)) {
            return "Error: filePath must be inside the sandbox directory.";
          }
        } catch {
          return "Error: filePath does not exist or is not accessible.";
        }
      }

      try {
        const fileStats = await stat(input.filePath);
        if (fileStats.size > MAX_FILE_SIZE) {
          return `Error: File too large (${fileStats.size} bytes). Maximum: ${MAX_FILE_SIZE} bytes.`;
        }

        const fileBuffer = await readFile(input.filePath);
        const ext = extname(input.filePath).toLowerCase();
        const mimeType = MIME_MAP[ext] ?? "application/octet-stream";
        const safeTitle = input.title
          ? input.title
              .replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, "_")
              .slice(0, 100)
          : null;
        const fileName = safeTitle
          ? `${safeTitle}${ext}`
          : basename(input.filePath);

        const canvas = canvasId
          ? await deps.dataRepository.findCanvas(userId, canvasId)
          : null;
        const project = canvas
          ? await deps.dataRepository.findProject(userId, canvas.project_id)
          : null;
        const workspace = project
          ? { id: project.workspace_id }
          : await deps.dataRepository.findPersonalWorkspace(userId);
        if (!workspace)
          return "Error: No accessible workspace available for this file.";
        const storagePath = `generated/${workspace.id}/${Date.now()}-${randomUUID()}-${fileName}`;
        const uploaded = await deps.storage.put({
          body: fileBuffer,
          contentType: mimeType,
          key: storagePath,
        });
        const asset = await deps.dataRepository.createAsset({
          // Same single-physical-bucket model as /api/uploads: writes target
          // the "dofe-system" bucket (TOS_BUCKET); "project-assets" has no
          // physical bucket and would fail with NoSuchBucket.
          bucket: "dofe-system",
          byteSize: fileBuffer.length,
          createdBy: userId,
          etag: uploaded.etag,
          mimeType,
          objectPath: storagePath,
          ...(project ? { projectId: project.id } : {}),
          workspaceId: workspace.id,
        });
        if (!asset) {
          await deps.storage.delete(storagePath).catch(() => undefined);
          return "Error: Failed to persist file metadata.";
        }

        return JSON.stringify({
          summary: `File uploaded successfully: ${fileName}`,
          url: deps.storage.createReadUrl(storagePath, 3600),
          path: storagePath,
          mimeType,
          size: fileBuffer.length,
        });
      } catch (err: any) {
        return `Error reading or uploading file: ${err.message}`;
      }
    },
    {
      name: "persist_sandbox_file",
      description:
        "Upload a file generated in the sandbox (e.g., a PDF or PNG created by Python code execution) " +
        "to persistent storage. Returns a signed URL the user can access. " +
        "Use this after execute() produces an output file you want to share with the user.",
      schema: persistSandboxFileSchema,
    },
  );
}
