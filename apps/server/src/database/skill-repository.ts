import type { QueryResultRow } from "pg";
import type { DatabasePool } from "./pool.js";

export type SkillFileInput = {
  content: string;
  filePath: string;
  mimeType?: string;
};
export type NativeSkillRepository = {
  create(input: {
    author?: string;
    category: string;
    createdBy: string;
    description: string;
    files?: SkillFileInput[];
    iconName?: string | null;
    license?: string | null;
    metadata?: Record<string, unknown>;
    name: string;
    slug: string;
    source: string;
    skillContent: string;
    version?: string;
  }): Promise<QueryResultRow>;
  delete(userId: string, skillId: string): Promise<boolean>;
  find(skillId: string): Promise<QueryResultRow | null>;
  files(skillId: string): Promise<QueryResultRow[]>;
  install(input: {
    enabled: boolean;
    installedBy: string;
    skillId: string;
    userId: string;
    workspaceId: string;
  }): Promise<boolean>;
  list(): Promise<QueryResultRow[]>;
  listInstalled(userId: string, workspaceId: string): Promise<QueryResultRow[]>;
  uninstall(
    userId: string,
    workspaceId: string,
    skillId: string,
  ): Promise<boolean>;
  update(
    userId: string,
    skillId: string,
    input: {
      category?: string;
      description?: string;
      iconName?: string | null;
      name?: string;
      skillContent?: string;
      slug?: string;
    },
  ): Promise<QueryResultRow | null>;
};

export function createNativeSkillRepository(
  pool: DatabasePool,
): NativeSkillRepository {
  const member =
    "exists (select 1 from workspace_members where workspace_id=$1 and user_id=$2)";
  return {
    async list() {
      return (
        await pool.query(
          "select * from skills order by is_featured desc,name asc",
        )
      ).rows;
    },
    async find(skillId) {
      return (
        (await pool.query("select * from skills where id=$1", [skillId]))
          .rows[0] ?? null
      );
    },
    async files(skillId) {
      return (
        await pool.query(
          "select * from skill_files where skill_id=$1 order by file_path",
          [skillId],
        )
      ).rows;
    },
    async create(input) {
      return pool.transaction(async (client) => {
        const skill = await client.query(
          `insert into skills(name,slug,description,author,version,license,category,icon_name,source,skill_content,metadata,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12) returning *`,
          [
            input.name,
            input.slug,
            input.description,
            input.author ?? "unknown",
            input.version ?? "1.0",
            input.license ?? null,
            input.category,
            input.iconName ?? null,
            input.source,
            input.skillContent,
            JSON.stringify(input.metadata ?? {}),
            input.createdBy,
          ],
        );
        for (const file of input.files ?? [])
          await client.query(
            "insert into skill_files(skill_id,file_path,content,mime_type) values($1,$2,$3,$4)",
            [
              skill.rows[0]!.id,
              file.filePath,
              file.content,
              file.mimeType ?? "text/plain",
            ],
          );
        return skill.rows[0]!;
      });
    },
    async update(userId, skillId, input) {
      const updates: string[] = [];
      const values: unknown[] = [skillId, userId];
      for (const [key, value] of [
        ["name", input.name],
        ["slug", input.slug],
        ["description", input.description],
        ["category", input.category],
        ["skill_content", input.skillContent],
        ["icon_name", input.iconName],
      ] as const)
        if (value !== undefined) {
          values.push(value);
          updates.push(`${key}=$${values.length}`);
        }
      if (!updates.length) return this.find(skillId);
      return (
        (
          await pool.query(
            `update skills set ${updates.join(",")} where id=$1 and created_by=$2 returning *`,
            values,
          )
        ).rows[0] ?? null
      );
    },
    async delete(userId, skillId) {
      return Boolean(
        (
          await pool.query(
            "delete from skills where id=$1 and created_by=$2 returning id",
            [skillId, userId],
          )
        ).rowCount,
      );
    },
    async listInstalled(userId, workspaceId) {
      return (
        await pool.query(
          `select s.*,ws.enabled,ws.installed_at from workspace_skills ws join skills s on s.id=ws.skill_id where ws.workspace_id=$1 and ${member} order by ws.installed_at desc`,
          [workspaceId, userId],
        )
      ).rows;
    },
    async install(input) {
      if (!(await this.find(input.skillId))) return false;
      const result = await pool.query(
        `insert into workspace_skills(workspace_id,skill_id,enabled,installed_by) select $1,$2,$3,$4 where ${member} on conflict(workspace_id,skill_id) do update set enabled=excluded.enabled returning skill_id`,
        [
          input.workspaceId,
          input.skillId,
          input.enabled,
          input.installedBy,
          input.userId,
        ],
      );
      return Boolean(result.rowCount);
    },
    async uninstall(userId, workspaceId, skillId) {
      return Boolean(
        (
          await pool.query(
            `delete from workspace_skills where workspace_id=$1 and skill_id=$2 and ${member} returning skill_id`,
            [workspaceId, skillId, userId],
          )
        ).rowCount,
      );
    },
  };
}
