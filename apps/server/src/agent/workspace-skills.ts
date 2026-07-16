import type { DatabasePool } from "../database/pool.js";

/**
 * A file bundled with a skill (scripts/, references/, assets/).
 */
export interface SkillFileEntry {
  /** Relative path, e.g. "scripts/analyze.py" */
  path: string;
  /** Raw file content */
  content: string;
}

/**
 * Metadata for a workspace skill loaded from the database.
 * Compatible with the deepagents SkillsMiddleware SkillMetadata shape.
 */
export interface WorkspaceSkillEntry {
  /** Skill slug (used as directory name in virtual path) */
  name: string;
  /** Human-readable description for the system prompt */
  description: string;
  /** Virtual path where the agent can read_file the full SKILL.md content */
  path: string;
  /** Raw SKILL.md content stored in the database */
  content: string;
  /** Associated files (scripts, references, assets) */
  files: SkillFileEntry[];
}

/**
 * Load enabled skills (both system and user-created) for a given canvas.
 *
 * Resolves the canvas → project → workspace chain, then fetches all
 * skills installed and enabled in that workspace. Only skills with
 * non-empty `skill_content` are returned.
 */
export async function loadWorkspaceSkills(
  pool: DatabasePool,
  userId: string,
  canvasId: string,
): Promise<WorkspaceSkillEntry[]> {
  const rows = await pool.query<{ id: string; slug: string; description: string; skill_content: string; file_path: string | null; content: string | null }>(
    `select s.id, s.slug, s.description, s.skill_content, sf.file_path, sf.content
     from canvases c join projects p on p.id = c.project_id
     join workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = $2
     join workspace_skills ws on ws.workspace_id = p.workspace_id and ws.enabled
     join skills s on s.id = ws.skill_id left join skill_files sf on sf.skill_id = s.id
     where c.id = $1 order by s.slug, sf.file_path`, [canvasId, userId]);
  const skills = new Map<string, WorkspaceSkillEntry>();
  for (const row of rows.rows) {
    const skill = skills.get(row.id) ?? { name: row.slug, description: row.description, path: `/workspace-skills/${row.slug}/SKILL.md`, content: row.skill_content, files: [] };
    if (row.file_path && row.content !== null) skill.files.push({ path: row.file_path, content: row.content });
    skills.set(row.id, skill);
  }
  return [...skills.values()].filter((skill) => skill.content.length > 0);
}
