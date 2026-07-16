import type { QueryResultRow } from "pg";

import type { DatabasePool } from "./pool.js";

export type BrandSkillRepository = {
  listBrandKits(userId: string): Promise<QueryResultRow[]>;
  findBrandKit(userId: string, kitId: string): Promise<QueryResultRow | null>;
  listBrandKitAssets(userId: string, kitId: string): Promise<QueryResultRow[]>;
  listSkills(): Promise<QueryResultRow[]>;
  findSkill(skillId: string): Promise<QueryResultRow | null>;
  listSkillFiles(skillId: string): Promise<QueryResultRow[]>;
  listWorkspaceSkills(userId: string, workspaceId: string): Promise<QueryResultRow[]>;
  createSkill(input: { userId: string; name: string; slug: string; description: string; category: string; skillContent: string; iconName?: string | null; source?: string; metadata?: Record<string, unknown> }): Promise<QueryResultRow>;
  installSkill(userId: string, workspaceId: string, skillId: string, enabled: boolean): Promise<boolean>;
};

export function createBrandSkillRepository(pool: DatabasePool): BrandSkillRepository {
  const member = "exists (select 1 from workspace_members wm where wm.workspace_id = $1 and wm.user_id = $2)";
  return {
    async listBrandKits(userId) {
      return (await pool.query(`select bk.* from brand_kits bk where ${member.replace("$1", "bk.workspace_id").replace("$2", "$1")} order by bk.is_default desc, bk.updated_at desc`, [userId])).rows;
    },
    async findBrandKit(userId, kitId) {
      return (await pool.query(`select bk.* from brand_kits bk where bk.id = $1 and exists (select 1 from workspace_members wm where wm.workspace_id = bk.workspace_id and wm.user_id = $2)`, [kitId, userId])).rows[0] ?? null;
    },
    async listBrandKitAssets(userId, kitId) {
      return (await pool.query(`select a.* from brand_kit_assets a join brand_kits bk on bk.id = a.kit_id where a.kit_id = $1 and exists (select 1 from workspace_members wm where wm.workspace_id = bk.workspace_id and wm.user_id = $2) order by a.sort_order, a.created_at`, [kitId, userId])).rows;
    },
    async listSkills() { return (await pool.query("select * from skills order by is_featured desc, name asc")).rows; },
    async findSkill(skillId) { return (await pool.query("select * from skills where id = $1", [skillId])).rows[0] ?? null; },
    async listSkillFiles(skillId) { return (await pool.query("select * from skill_files where skill_id = $1 order by file_path", [skillId])).rows; },
    async listWorkspaceSkills(userId, workspaceId) {
      return (await pool.query(`select s.*, ws.enabled, ws.installed_at from workspace_skills ws join skills s on s.id = ws.skill_id where ws.workspace_id = $1 and ${member} order by ws.installed_at desc`, [workspaceId, userId])).rows;
    },
    async createSkill(input) {
      return (await pool.query(`insert into skills(name,slug,description,category,skill_content,icon_name,source,metadata,created_by) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9) returning *`, [input.name,input.slug,input.description,input.category,input.skillContent,input.iconName ?? null,input.source ?? "user",JSON.stringify(input.metadata ?? {}),input.userId])).rows[0]!;
    },
    async installSkill(userId, workspaceId, skillId, enabled) {
      const result = await pool.query(`insert into workspace_skills(workspace_id,skill_id,enabled,installed_by) select $1,$2,$3,$4 where ${member} on conflict(workspace_id,skill_id) do update set enabled = excluded.enabled returning skill_id`, [workspaceId,skillId,enabled,userId]);
      return result.rowCount === 1;
    },
  };
}
