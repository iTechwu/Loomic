import { randomUUID } from "node:crypto";

import type {
  BrandKitAsset,
  BrandKitAssetCreateRequest,
  BrandKitAssetUpdateRequest,
  BrandKitCreateRequest,
  BrandKitDetail,
  BrandKitSummary,
  BrandKitUpdateRequest,
} from "@lovart.dofe/shared";
import type { QueryResultRow } from "pg";

import type { DatabasePool } from "../../database/pool.js";
import type { AuthenticatedUser } from "../../supabase/user.js";
import type { TosObjectStorage } from "../../storage/tos-object-storage.js";

const SIGNED_URL_EXPIRY_SECONDS = 3600;
type BrandKitServiceErrorCode =
  | "brand_kit_not_found"
  | "brand_kit_create_failed"
  | "brand_kit_update_failed"
  | "brand_kit_delete_failed"
  | "brand_kit_query_failed"
  | "brand_kit_asset_not_found"
  | "brand_kit_asset_create_failed";
export class BrandKitServiceError extends Error {
  constructor(
    readonly code: BrandKitServiceErrorCode,
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}
export type BrandKitService = {
  listKits(user: AuthenticatedUser): Promise<BrandKitSummary[]>;
  getKit(user: AuthenticatedUser, kitId: string): Promise<BrandKitDetail>;
  createKit(
    user: AuthenticatedUser,
    input: BrandKitCreateRequest,
  ): Promise<BrandKitDetail>;
  updateKit(
    user: AuthenticatedUser,
    kitId: string,
    input: BrandKitUpdateRequest,
  ): Promise<BrandKitDetail>;
  deleteKit(user: AuthenticatedUser, kitId: string): Promise<void>;
  createAsset(
    user: AuthenticatedUser,
    kitId: string,
    input: BrandKitAssetCreateRequest,
  ): Promise<BrandKitAsset>;
  updateAsset(
    user: AuthenticatedUser,
    kitId: string,
    assetId: string,
    input: BrandKitAssetUpdateRequest,
  ): Promise<BrandKitAsset>;
  deleteAsset(
    user: AuthenticatedUser,
    kitId: string,
    assetId: string,
  ): Promise<void>;
  uploadAsset(
    user: AuthenticatedUser,
    kitId: string,
    assetType: "logo" | "image",
    fileName: string,
    fileBuffer: Buffer,
    mimeType: string,
  ): Promise<BrandKitAsset>;
  duplicateKit(user: AuthenticatedUser, kitId: string): Promise<BrandKitDetail>;
};

export function createBrandKitService(options: {
  pool: DatabasePool;
  storage: TosObjectStorage;
}): BrandKitService {
  const fail = (
    code: BrandKitServiceErrorCode,
    message: string,
    status = 500,
  ): never => {
    throw new BrandKitServiceError(code, message, status);
  };
  const workspace = async (userId: string) =>
    (
      await options.pool.query<{ id: string }>(
        "select id from workspaces where owner_user_id = $1 and type = 'personal' limit 1",
        [userId],
      )
    ).rows[0]?.id ??
    fail("brand_kit_query_failed", "Unable to resolve workspace.");
  const ownsKit = async (userId: string, kitId: string) =>
    (
      await options.pool.query<{ id: string }>(
        `select bk.id from brand_kits bk join workspace_members wm on wm.workspace_id=bk.workspace_id where bk.id=$1 and wm.user_id=$2`,
        [kitId, userId],
      )
    ).rows[0] ?? null;
  const detail = async (
    userId: string,
    kitId: string,
  ): Promise<BrandKitDetail> => {
    const kit = await options.pool.query<QueryResultRow>(
      `select bk.* from brand_kits bk join workspace_members wm on wm.workspace_id=bk.workspace_id where bk.id=$1 and wm.user_id=$2`,
      [kitId, userId],
    );
    if (!kit.rowCount)
      return fail("brand_kit_not_found", "Brand kit not found.", 404);
    const assets = await options.pool.query<QueryResultRow>(
      "select * from brand_kit_assets where kit_id=$1 order by sort_order, created_at",
      [kitId],
    );
    return {
      id: String(kit.rows[0]!.id),
      name: String(kit.rows[0]!.name),
      is_default: Boolean(kit.rows[0]!.is_default),
      guidance_text: nullable(kit.rows[0]!.guidance_text),
      cover_url: signed(nullable(kit.rows[0]!.cover_path), options.storage),
      assets: assets.rows.map((row) => asset(row, options.storage)),
      created_at: iso(kit.rows[0]!.created_at),
      updated_at: iso(kit.rows[0]!.updated_at),
    };
  };
  return {
    async listKits(user) {
      const result = await options.pool.query<QueryResultRow>(
        `select bk.*, count(a.id) filter (where a.asset_type='color') as color_count, count(a.id) filter (where a.asset_type='font') as font_count, count(a.id) filter (where a.asset_type='logo') as logo_count, count(a.id) filter (where a.asset_type='image') as image_count from brand_kits bk join workspace_members wm on wm.workspace_id=bk.workspace_id left join brand_kit_assets a on a.kit_id=bk.id where wm.user_id=$1 group by bk.id order by bk.is_default desc,bk.updated_at desc`,
        [user.id],
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        is_default: Boolean(row.is_default),
        cover_url: signed(nullable(row.cover_path), options.storage),
        asset_counts: {
          color: Number(row.color_count),
          font: Number(row.font_count),
          logo: Number(row.logo_count),
          image: Number(row.image_count),
        },
        created_at: iso(row.created_at),
        updated_at: iso(row.updated_at),
      }));
    },
    getKit: (user, kitId) => detail(user.id, kitId),
    async createKit(user, input) {
      const workspaceId = await workspace(user.id);
      const row = await options.pool.query<{ id: string }>(
        "insert into brand_kits(workspace_id,name,created_by) values($1,$2,$3) returning id",
        [workspaceId, input.name?.trim() || "Untitled", user.id],
      );
      return detail(user.id, row.rows[0]!.id);
    },
    async updateKit(user, kitId, input) {
      if (!(await ownsKit(user.id, kitId)))
        fail("brand_kit_not_found", "Brand kit not found.", 404);
      await options.pool.transaction(async (client) => {
        if (input.is_default)
          await client.query(
            "update brand_kits set is_default=false where workspace_id=(select workspace_id from brand_kits where id=$1)",
            [kitId],
          );
        const updates: string[] = [];
        const values: unknown[] = [kitId];
        for (const [column, value] of [
          ["name", input.name?.trim()],
          ["guidance_text", input.guidance_text],
          ["is_default", input.is_default],
        ] as const)
          if (value !== undefined) {
            values.push(value);
            updates.push(`${column}=$${values.length}`);
          }
        if (updates.length)
          await client.query(
            `update brand_kits set ${updates.join(",")} where id=$1`,
            values,
          );
      });
      return detail(user.id, kitId);
    },
    async deleteKit(user, kitId) {
      const files = await options.pool.query<{ object_path: string | null }>(
        "select a.object_path from brand_kit_assets a join brand_kits bk on bk.id=a.kit_id join workspace_members wm on wm.workspace_id=bk.workspace_id where a.kit_id=$1 and wm.user_id=$2",
        [kitId, user.id],
      );
      const removed = await options.pool.query(
        "delete from brand_kits bk using workspace_members wm where bk.id=$1 and wm.workspace_id=bk.workspace_id and wm.user_id=$2 returning bk.id",
        [kitId, user.id],
      );
      if (!removed.rowCount)
        fail("brand_kit_not_found", "Brand kit not found.", 404);
      await Promise.all(
        files.rows.flatMap((row) =>
          row.object_path
            ? [
                options.storage
                  .delete(row.object_path)
                  .catch((error: unknown) =>
                    console.warn("[brand-kit] object cleanup failed", {
                      kitId,
                      message:
                        error instanceof Error ? error.message : String(error),
                    }),
                  ),
              ]
            : [],
        ),
      );
    },
    async createAsset(user, kitId, input) {
      if (!(await ownsKit(user.id, kitId)))
        fail("brand_kit_not_found", "Brand kit not found.", 404);
      const result = await options.pool.query<QueryResultRow>(
        `insert into brand_kit_assets(kit_id,asset_type,display_name,text_content,role,sort_order,metadata) values($1,$2,$3,$4,$5,coalesce((select max(sort_order)+1 from brand_kit_assets where kit_id=$1 and asset_type=$2),0),$6::jsonb) returning *`,
        [
          kitId,
          input.asset_type,
          input.display_name,
          input.text_content ?? null,
          input.role ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      return asset(result.rows[0]!, options.storage);
    },
    async updateAsset(user, kitId, assetId, input) {
      const updates: string[] = [];
      const values: unknown[] = [assetId, kitId, user.id];
      for (const [column, value] of [
        ["display_name", input.display_name],
        ["text_content", input.text_content],
        ["role", input.role],
        ["sort_order", input.sort_order],
        [
          "metadata",
          input.metadata ? JSON.stringify(input.metadata) : undefined,
        ],
      ] as const)
        if (value !== undefined) {
          values.push(value);
          updates.push(
            `${column}=$${values.length}${column === "metadata" ? "::jsonb" : ""}`,
          );
        }
      if (updates.length) {
        const result = await options.pool.query<QueryResultRow>(
          `update brand_kit_assets a set ${updates.join(",")} from brand_kits bk, workspace_members wm where a.id=$1 and a.kit_id=$2 and bk.id=a.kit_id and wm.workspace_id=bk.workspace_id and wm.user_id=$3 returning a.*`,
          values,
        );
        if (!result.rowCount)
          fail("brand_kit_asset_not_found", "Brand kit asset not found.", 404);
        return asset(result.rows[0]!, options.storage);
      }
      const result = await options.pool.query<QueryResultRow>(
        `select a.* from brand_kit_assets a join brand_kits bk on bk.id=a.kit_id join workspace_members wm on wm.workspace_id=bk.workspace_id where a.id=$1 and a.kit_id=$2 and wm.user_id=$3`,
        values,
      );
      if (!result.rowCount)
        fail("brand_kit_asset_not_found", "Brand kit asset not found.", 404);
      return asset(result.rows[0]!, options.storage);
    },
    async deleteAsset(user, kitId, assetId) {
      const result = await options.pool.query<{ object_path: string | null }>(
        `delete from brand_kit_assets a using brand_kits bk,workspace_members wm where a.id=$1 and a.kit_id=$2 and bk.id=a.kit_id and wm.workspace_id=bk.workspace_id and wm.user_id=$3 returning a.object_path`,
        [assetId, kitId, user.id],
      );
      if (!result.rowCount)
        fail("brand_kit_asset_not_found", "Brand kit asset not found.", 404);
      if (result.rows[0]!.object_path)
        await options.storage
          .delete(result.rows[0]!.object_path!)
          .catch((error: unknown) =>
            console.warn("[brand-kit] asset cleanup failed", {
              assetId,
              message: error instanceof Error ? error.message : String(error),
            }),
          );
    },
    async uploadAsset(user, kitId, assetType, fileName, fileBuffer, mimeType) {
      if (!(await ownsKit(user.id, kitId)))
        fail("brand_kit_not_found", "Brand kit not found.", 404);
      const objectPath = `brand-kits/${user.id}/${kitId}/${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const uploaded = await options.storage.put({
        body: fileBuffer,
        contentType: mimeType,
        key: objectPath,
      });
      try {
        const result = await options.pool.query<QueryResultRow>(
          `insert into brand_kit_assets(kit_id,asset_type,display_name,object_path,sort_order) values($1,$2,$3,$4,coalesce((select max(sort_order)+1 from brand_kit_assets where kit_id=$1 and asset_type=$2),0)) returning *`,
          [kitId, assetType, fileName.replace(/\.[^.]+$/, ""), uploaded.key],
        );
        return asset(result.rows[0]!, options.storage);
      } catch (error) {
        await options.storage.delete(objectPath).catch(() => undefined);
        throw error;
      }
    },
    async duplicateKit(user, kitId) {
      const source = await detail(user.id, kitId);
      const workspaceId = await workspace(user.id);
      const created = await options.pool.query<{ id: string }>(
        "insert into brand_kits(workspace_id,name,guidance_text,created_by) values($1,$2,$3,$4) returning id",
        [workspaceId, `${source.name} (copy)`, source.guidance_text, user.id],
      );
      const sourceAssets = await options.pool.query<QueryResultRow>(
        "select * from brand_kit_assets where kit_id=$1 order by sort_order,created_at",
        [kitId],
      );
      for (const sourceAsset of sourceAssets.rows) {
        let objectPath: string | null = nullable(sourceAsset.object_path);
        if (objectPath) {
          const extension = objectPath.includes(".")
            ? objectPath.slice(objectPath.lastIndexOf("."))
            : "";
          const copied = await options.storage.copy(
            objectPath,
            `brand-kits/${user.id}/${created.rows[0]!.id}/${randomUUID()}${extension}`,
          );
          objectPath = copied.key;
        }
        await options.pool.query(
          "insert into brand_kit_assets(kit_id,asset_type,display_name,role,sort_order,text_content,object_path,metadata) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)",
          [
            created.rows[0]!.id,
            sourceAsset.asset_type,
            sourceAsset.display_name,
            sourceAsset.role,
            sourceAsset.sort_order,
            sourceAsset.text_content,
            objectPath,
            JSON.stringify(sourceAsset.metadata ?? {}),
          ],
        );
      }
      console.info("[brand-kit] duplicated", {
        sourceKitId: kitId,
        targetKitId: created.rows[0]!.id,
      });
      return detail(user.id, created.rows[0]!.id);
    },
  };
}
function nullable(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function iso(value: unknown): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(String(value)).toISOString();
}
function signed(path: string | null, storage: TosObjectStorage): string | null {
  return path ? storage.createReadUrl(path, SIGNED_URL_EXPIRY_SECONDS) : null;
}
function asset(row: QueryResultRow, storage: TosObjectStorage): BrandKitAsset {
  return {
    id: String(row.id),
    asset_type: row.asset_type as BrandKitAsset["asset_type"],
    display_name: String(row.display_name),
    role: nullable(row.role),
    sort_order: Number(row.sort_order),
    text_content: nullable(row.text_content),
    file_url: signed(nullable(row.object_path), storage),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
}
