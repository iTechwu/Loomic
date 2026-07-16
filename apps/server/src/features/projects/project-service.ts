import type { ProjectCreateRequest, ProjectSummary, ProjectUpdateRequest } from "@lovart.dofe/shared";

import type { NativeDataRepository, NativeProjectRow } from "../../database/native-data-repository.js";
import type { TosObjectStorage } from "../../storage/tos-object-storage.js";
import { BootstrapError, type ViewerService } from "../bootstrap/ensure-user-foundation.js";
import type { AuthenticatedUser } from "../../supabase/user.js";

const SIGNED_URL_EXPIRY_SECONDS = 3600;

export type ProjectService = {
  archiveProject(user: AuthenticatedUser, projectId: string): Promise<void>;
  createProject(user: AuthenticatedUser, input: ProjectCreateRequest): Promise<ProjectSummary>;
  getProject(user: AuthenticatedUser, projectId: string): Promise<{ id: string; name: string; slug: string; description: string | null; workspace_id: string; brand_kit_id: string | null; created_at: string; updated_at: string }>;
  listProjects(user: AuthenticatedUser): Promise<ProjectSummary[]>;
  saveThumbnail(user: AuthenticatedUser, projectId: string, buffer: Buffer, mimeType: string): Promise<{ thumbnailUrl: string }>;
  updateProject(user: AuthenticatedUser, projectId: string, input: ProjectUpdateRequest): Promise<void>;
};

export class ProjectServiceError extends Error {
  constructor(
    readonly code: "project_create_failed" | "project_delete_failed" | "project_not_found" | "project_query_failed" | "project_slug_taken" | "project_update_failed",
    message: string,
    readonly statusCode: number,
  ) { super(message); }
}

export function createProjectService(options: { repository: NativeDataRepository; storage: TosObjectStorage; viewerService: ViewerService }): ProjectService {
  return {
    async archiveProject(user, projectId) {
      if (!await options.repository.archiveProject(user.id, projectId)) throw notFound();
    },
    async getProject(user, projectId) {
      const project = await options.repository.findProject(user.id, projectId);
      if (!project) throw notFound();
      return {
        brand_kit_id: project.brand_kit_id,
        created_at: project.created_at.toISOString(),
        description: project.description,
        id: project.id,
        name: project.name,
        slug: project.slug,
        updated_at: project.updated_at.toISOString(),
        workspace_id: project.workspace_id,
      };
    },
    async createProject(user, input) {
      const viewer = await foundation(options.viewerService, user, "project_create_failed");
      try {
        const project = await options.repository.createProject({
          createdBy: user.id,
          description: input.description?.trim() || null,
          name: input.name.trim(),
          slug: slugify(input.name),
          workspaceId: viewer.workspace.id,
        });
        return mapSummary(project, viewer.workspace, options.storage);
      } catch (error) {
        if (postgresCode(error) === "23505") throw new ProjectServiceError("project_slug_taken", "Project slug is already taken in this workspace.", 409);
        console.error("[project-service] create failed", { message: error instanceof Error ? error.message : String(error), userId: user.id });
        throw new ProjectServiceError("project_create_failed", "Unable to create project.", 500);
      }
    },
    async listProjects(user) {
      const viewer = await foundation(options.viewerService, user, "project_query_failed");
      try {
        return (await options.repository.listProjects(user.id)).map((project) => mapSummary(project, viewer.workspace, options.storage));
      } catch (error) {
        console.error("[project-service] list failed", { message: error instanceof Error ? error.message : String(error), userId: user.id });
        throw new ProjectServiceError("project_query_failed", "Unable to load projects.", 500);
      }
    },
    async saveThumbnail(user, projectId, buffer, mimeType) {
      const target = await options.repository.findProjectThumbnailTarget(user.id, projectId);
      if (!target) throw notFound();
      const ext = mimeType === "image/webp" ? "webp" : "png";
      const objectPath = `projects/${target.workspaceId}/${projectId}/thumbnail.${ext}`;
      try {
        await options.storage.put({ body: buffer, contentType: mimeType, key: objectPath });
        if (!await options.repository.setProjectThumbnail(user.id, projectId, objectPath)) throw notFound();
        return { thumbnailUrl: options.storage.createReadUrl(objectPath, SIGNED_URL_EXPIRY_SECONDS) };
      } catch (error) {
        if (error instanceof ProjectServiceError) throw error;
        console.error("[project-service] thumbnail save failed", { message: error instanceof Error ? error.message : String(error), projectId });
        throw new ProjectServiceError("project_create_failed", "Unable to save project thumbnail.", 500);
      }
    },
    async updateProject(user, projectId, input) {
      const updated = await options.repository.updateProject({
        ...(input.brand_kit_id !== undefined ? { brandKitId: input.brand_kit_id } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        projectId,
        userId: user.id,
      });
      if (!updated) throw notFound();
    },
  };
}

async function foundation(service: ViewerService, user: AuthenticatedUser, code: "project_create_failed" | "project_query_failed") {
  try { return await service.ensureViewer(user); }
  catch (error) {
    if (error instanceof BootstrapError) throw new ProjectServiceError(code, code === "project_create_failed" ? "Unable to create project." : "Unable to load projects.", 500);
    throw error;
  }
}

function mapSummary(project: NativeProjectRow, workspace: ProjectSummary["workspace"], storage: TosObjectStorage): ProjectSummary {
  if (!project.canvas_id || !project.canvas_name || project.canvas_is_primary === null) {
    throw new ProjectServiceError("project_query_failed", "Unable to load projects.", 500);
  }
  return {
    createdAt: project.created_at.toISOString(), description: project.description, id: project.id,
    name: project.name, slug: project.slug,
    primaryCanvas: { id: project.canvas_id, isPrimary: project.canvas_is_primary, name: project.canvas_name },
    thumbnailUrl: project.thumbnail_path ? storage.createReadUrl(project.thumbnail_path, SIGNED_URL_EXPIRY_SECONDS) : null,
    updatedAt: project.updated_at.toISOString(), workspace,
  };
}

function notFound() { return new ProjectServiceError("project_not_found", "Project not found.", 404); }
function postgresCode(error: unknown): string | null { return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null; }
function slugify(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled"; }
