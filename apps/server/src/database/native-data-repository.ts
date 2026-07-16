import type { Json, ViewerResponse } from "@lovart.dofe/shared";
import type { PoolClient } from "pg";

import type { DatabasePool } from "./pool.js";

type Queryable = Pick<DatabasePool, "query"> | Pick<PoolClient, "query">;

type WorkspaceRow = {
  id: string;
  name: string;
  owner_user_id: string;
  type: "personal" | "team";
};

export type NativeProjectRow = {
  brand_kit_id: string | null;
  created_at: Date;
  description: string | null;
  id: string;
  name: string;
  slug: string;
  thumbnail_path: string | null;
  updated_at: Date;
  workspace_id: string;
  canvas_id: string | null;
  canvas_name: string | null;
  canvas_is_primary: boolean | null;
};

export type NativeCanvasRow = {
  content: Json;
  id: string;
  name: string;
  project_id: string;
};

export type NativeAssetRow = {
  bucket: "project-assets" | "user-avatars";
  byte_size: number | null;
  created_at: Date;
  etag: string | null;
  id: string;
  mime_type: string | null;
  object_path: string;
  project_id: string | null;
  workspace_id: string;
};

export type NativeDataRepository = {
  archiveProject(userId: string, projectId: string): Promise<boolean>;
  createAsset(input: {
    bucket: "project-assets" | "user-avatars";
    byteSize: number;
    createdBy: string;
    etag: string | null;
    mimeType: string;
    objectPath: string;
    projectId?: string;
    workspaceId: string;
  }): Promise<NativeAssetRow | null>;
  createProject(input: {
    createdBy: string;
    description: string | null;
    name: string;
    slug: string;
    workspaceId: string;
  }): Promise<NativeProjectRow>;
  ensureViewer(input: {
    avatarUrl: string | null;
    displayName: string;
    email: string;
    userId: string;
  }): Promise<ViewerResponse>;
  findAsset(userId: string, assetId: string): Promise<NativeAssetRow | null>;
  findCanvas(userId: string, canvasId: string): Promise<NativeCanvasRow | null>;
  findProject(userId: string, projectId: string): Promise<NativeProjectRow | null>;
  findProjectThumbnailTarget(userId: string, projectId: string): Promise<{ workspaceId: string } | null>;
  findPersonalWorkspace(userId: string): Promise<{ id: string; name: string; ownerUserId: string; type: "personal" | "team" } | null>;
  listProjects(userId: string): Promise<NativeProjectRow[]>;
  removeAsset(userId: string, assetId: string): Promise<NativeAssetRow | null>;
  saveCanvas(userId: string, canvasId: string, content: Json): Promise<boolean>;
  setProjectThumbnail(userId: string, projectId: string, objectPath: string): Promise<boolean>;
  updateProfile(userId: string, displayName: string): Promise<{ avatarUrl: string | null; displayName: string; email: string; id: string } | null>;
  updateProject(input: { brandKitId?: string | null; name?: string; projectId: string; userId: string }): Promise<boolean>;
};

const PROJECT_SELECT = `
  select p.id, p.name, p.slug, p.description, p.brand_kit_id, p.thumbnail_path,
         p.workspace_id, p.created_at, p.updated_at,
         c.id as canvas_id, c.name as canvas_name, c.is_primary as canvas_is_primary
  from projects p
  left join canvases c on c.project_id = p.id and c.is_primary = true
`;

/**
 * Native repository for the metadata data plane. Authorization predicates live
 * alongside every query because this PostgreSQL deployment does not use RLS.
 */
export function createNativeDataRepository(pool: DatabasePool): NativeDataRepository {
  return {
    async ensureViewer(input) {
      return pool.transaction(async (client) => {
        const profile = await client.query<{
          avatar_url: string | null;
          display_name: string;
          email: string;
          id: string;
        }>(
          `insert into profiles (id, email, display_name, avatar_url)
           values ($1, $2, $3, $4)
           on conflict (id) do update set email = excluded.email,
             avatar_url = coalesce(excluded.avatar_url, profiles.avatar_url)
           returning id, email, display_name, avatar_url`,
          [input.userId, input.email, input.displayName, input.avatarUrl],
        );
        await client.query(
          `insert into workspaces (type, name, owner_user_id)
           values ('personal', $2, $1)
           on conflict do nothing`,
          [input.userId, `${input.displayName} Workspace`],
        );
        const workspace = await personalWorkspace(client, input.userId);
        if (!workspace) throw new Error("Personal workspace bootstrap failed");
        await client.query(
          `insert into workspace_members (workspace_id, user_id, role)
           values ($1, $2, 'owner')
           on conflict (workspace_id, user_id) do update set role = 'owner'`,
          [workspace.id, input.userId],
        );
        return {
          membership: { role: "owner", userId: input.userId, workspaceId: workspace.id },
          profile: {
            avatarUrl: profile.rows[0]!.avatar_url,
            displayName: profile.rows[0]!.display_name,
            email: profile.rows[0]!.email,
            id: profile.rows[0]!.id,
          },
          workspace: mapWorkspace(workspace),
        };
      });
    },

    async updateProfile(userId, displayName) {
      const result = await pool.query<{ id: string; email: string; display_name: string; avatar_url: string | null }>(
        `update profiles set display_name = $2 where id = $1
         returning id, email, display_name, avatar_url`,
        [userId, displayName],
      );
      const row = result.rows[0];
      return row ? { avatarUrl: row.avatar_url, displayName: row.display_name, email: row.email, id: row.id } : null;
    },

    async findPersonalWorkspace(userId) {
      const workspace = await personalWorkspace(pool, userId);
      return workspace ? mapWorkspace(workspace) : null;
    },

    async listProjects(userId) {
      const result = await pool.query<NativeProjectRow>(
        `${PROJECT_SELECT}
         join workspace_members wm on wm.workspace_id = p.workspace_id
         where wm.user_id = $1 and p.archived_at is null
         order by p.updated_at desc`,
        [userId],
      );
      return result.rows;
    },

    async findProject(userId, projectId) {
      const result = await pool.query<NativeProjectRow>(
        `${PROJECT_SELECT}
         join workspace_members wm on wm.workspace_id = p.workspace_id
         where wm.user_id = $1 and p.id = $2 and p.archived_at is null`,
        [userId, projectId],
      );
      return result.rows[0] ?? null;
    },

    async createProject(input) {
      return pool.transaction(async (client) => {
        const authorized = await client.query(
          `select 1 from workspace_members where workspace_id = $1 and user_id = $2`,
          [input.workspaceId, input.createdBy],
        );
        if (!authorized.rowCount) throw new Error("Workspace access denied");
        const project = await client.query<Pick<NativeProjectRow, "id" | "name" | "slug" | "description" | "workspace_id" | "created_at" | "updated_at">>(
          `insert into projects (workspace_id, name, slug, description, created_by)
           values ($1, $2, $3, $4, $5)
           returning id, name, slug, description, workspace_id, created_at, updated_at`,
          [input.workspaceId, input.name, input.slug, input.description, input.createdBy],
        );
        const canvas = await client.query<{ id: string; name: string; is_primary: boolean }>(
          `insert into canvases (project_id, name, is_primary, created_by)
           values ($1, 'Main Canvas', true, $2) returning id, name, is_primary`,
          [project.rows[0]!.id, input.createdBy],
        );
        return {
          ...project.rows[0]!,
          brand_kit_id: null,
          canvas_id: canvas.rows[0]!.id,
          canvas_is_primary: canvas.rows[0]!.is_primary,
          canvas_name: canvas.rows[0]!.name,
          thumbnail_path: null,
        };
      });
    },

    async archiveProject(userId, projectId) {
      const result = await pool.query(
        `update projects p set archived_at = now()
         from workspace_members wm
         where p.id = $2 and p.workspace_id = wm.workspace_id and wm.user_id = $1
           and p.archived_at is null
         returning p.id`,
        [userId, projectId],
      );
      return Boolean(result.rowCount);
    },

    async updateProject(input) {
      const updates: string[] = [];
      const values: unknown[] = [input.userId, input.projectId];
      if (input.name !== undefined) {
        values.push(input.name);
        updates.push(`name = $${values.length}`);
      }
      if (input.brandKitId !== undefined) {
        values.push(input.brandKitId);
        updates.push(`brand_kit_id = $${values.length}`);
      }
      if (!updates.length) return true;
      const result = await pool.query(
        `update projects p set ${updates.join(", ")}
         from workspace_members wm
         where p.id = $2 and p.workspace_id = wm.workspace_id and wm.user_id = $1
           and p.archived_at is null
         returning p.id`,
        values,
      );
      return Boolean(result.rowCount);
    },

    async findProjectThumbnailTarget(userId, projectId) {
      const result = await pool.query<{ workspace_id: string }>(
        `select p.workspace_id from projects p
         join workspace_members wm on wm.workspace_id = p.workspace_id
         where p.id = $2 and wm.user_id = $1 and p.archived_at is null`,
        [userId, projectId],
      );
      const row = result.rows[0];
      return row ? { workspaceId: row.workspace_id } : null;
    },

    async setProjectThumbnail(userId, projectId, objectPath) {
      const result = await pool.query(
        `update projects p set thumbnail_path = $3
         from workspace_members wm
         where p.id = $2 and p.workspace_id = wm.workspace_id and wm.user_id = $1
         returning p.id`,
        [userId, projectId, objectPath],
      );
      return Boolean(result.rowCount);
    },

    async findCanvas(userId, canvasId) {
      const result = await pool.query<NativeCanvasRow>(
        `select c.id, c.name, c.project_id, c.content
         from canvases c join projects p on p.id = c.project_id
         join workspace_members wm on wm.workspace_id = p.workspace_id
         where c.id = $2 and wm.user_id = $1 and p.archived_at is null`,
        [userId, canvasId],
      );
      return result.rows[0] ?? null;
    },

    async saveCanvas(userId, canvasId, content) {
      const result = await pool.query(
        `update canvases c set content = $3::jsonb
         from projects p, workspace_members wm
         where c.id = $2 and p.id = c.project_id and wm.workspace_id = p.workspace_id
           and wm.user_id = $1 and p.archived_at is null
         returning c.id`,
        [userId, canvasId, JSON.stringify(content)],
      );
      return Boolean(result.rowCount);
    },

    async createAsset(input) {
      const result = await pool.query<NativeAssetRow>(
        `insert into asset_objects
           (workspace_id, project_id, bucket, object_path, mime_type, byte_size, etag, created_by)
         select $1, $2, $3, $4, $5, $6, $7, $8
         where exists (select 1 from workspace_members where workspace_id = $1 and user_id = $8)
           and ($2::uuid is null or exists (select 1 from projects where id = $2 and workspace_id = $1))
         returning id, workspace_id, project_id, bucket, object_path, mime_type, byte_size, etag, created_at`,
        [input.workspaceId, input.projectId ?? null, input.bucket, input.objectPath, input.mimeType, input.byteSize, input.etag, input.createdBy],
      );
      return result.rows[0] ?? null;
    },

    async findAsset(userId, assetId) {
      const result = await pool.query<NativeAssetRow>(
        `select a.id, a.workspace_id, a.project_id, a.bucket, a.object_path, a.mime_type,
                a.byte_size, a.etag, a.created_at
         from asset_objects a join workspace_members wm on wm.workspace_id = a.workspace_id
         where a.id = $2 and wm.user_id = $1`,
        [userId, assetId],
      );
      return result.rows[0] ?? null;
    },

    async removeAsset(userId, assetId) {
      const result = await pool.query<NativeAssetRow>(
        `delete from asset_objects a using workspace_members wm
         where a.id = $2 and wm.workspace_id = a.workspace_id and wm.user_id = $1
         returning a.id, a.workspace_id, a.project_id, a.bucket, a.object_path, a.mime_type,
                   a.byte_size, a.etag, a.created_at`,
        [userId, assetId],
      );
      return result.rows[0] ?? null;
    },
  };
}

async function personalWorkspace(client: Queryable, userId: string): Promise<WorkspaceRow | null> {
  const result = await client.query<WorkspaceRow>(
    `select id, name, type, owner_user_id from workspaces
     where owner_user_id = $1 and type = 'personal' order by created_at limit 1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

function mapWorkspace(workspace: WorkspaceRow) {
  return { id: workspace.id, name: workspace.name, ownerUserId: workspace.owner_user_id, type: workspace.type } as const;
}
