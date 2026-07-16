import type { QueryResultRow } from "pg";
import type { DatabasePool } from "./pool.js";

type Session = { id: string; thread_id: string | null; title: string; updated_at: Date };
type Message = { content: string; content_blocks: unknown[] | null; created_at: Date; id: string; role: "user" | "assistant"; tool_activities: unknown[] | null };
export type NativeChatRepository = {
  createMessage(userId: string, sessionId: string, input: { content: string; contentBlocks?: unknown[] | null; role: "user" | "assistant"; toolActivities?: unknown[] | null }): Promise<Message | null>;
  createSession(userId: string, canvasId: string, threadId: string, title?: string): Promise<Session | null>;
  deleteSession(userId: string, sessionId: string): Promise<boolean>;
  listMessages(userId: string, sessionId: string): Promise<Message[] | null>;
  listSessions(userId: string, canvasId: string): Promise<Session[] | null>;
  resolveThread(userId: string, sessionId: string): Promise<{ id: string; thread_id: string | null } | null>;
  updateTitle(userId: string, sessionId: string, title: string): Promise<boolean>;
};
const MEMBER = `join canvases c on c.id = cs.canvas_id join projects p on p.id = c.project_id join workspace_members wm on wm.workspace_id = p.workspace_id and wm.user_id = $1`;
export function createNativeChatRepository(pool: DatabasePool): NativeChatRepository { return {
  async listSessions(userId, canvasId) { const r = await pool.query<Session>(`select cs.id,cs.title,cs.updated_at from chat_sessions cs ${MEMBER} where cs.canvas_id = $2 order by cs.updated_at desc`, [userId, canvasId]); return r.rows; },
  async createSession(userId, canvasId, threadId, title) { return first(pool, `insert into chat_sessions (canvas_id,created_by,thread_id,title) select c.id,$1,$3,coalesce($4,'New Chat') from canvases c join projects p on p.id=c.project_id join workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=$1 where c.id=$2 returning id,title,updated_at,thread_id`, [userId, canvasId, threadId, title ?? null]); },
  async updateTitle(userId, sessionId, title) { const r = await pool.query(`update chat_sessions cs set title=$3 from canvases c join projects p on p.id=c.project_id join workspace_members wm on wm.workspace_id=p.workspace_id and wm.user_id=$1 where cs.id=$2 and c.id=cs.canvas_id returning cs.id`, [userId, sessionId, title]); return Boolean(r.rowCount); },
  async deleteSession(userId, sessionId) { const r = await pool.query(`delete from chat_sessions cs using canvases c,projects p,workspace_members wm where cs.id=$2 and c.id=cs.canvas_id and p.id=c.project_id and wm.workspace_id=p.workspace_id and wm.user_id=$1 returning cs.id`, [userId, sessionId]); return Boolean(r.rowCount); },
  async listMessages(userId, sessionId) { const session = await this.resolveThread(userId, sessionId); if (!session) return null; const r = await pool.query<Message>(`select id,role,content,tool_activities,content_blocks,created_at from chat_messages where session_id=$1 order by created_at`, [sessionId]); return r.rows; },
  async createMessage(userId, sessionId, input) { return pool.transaction(async (client) => { const owned = await client.query(`select cs.id from chat_sessions cs ${MEMBER} where cs.id=$2`, [userId, sessionId]); if (!owned.rowCount) return null; const inserted = await client.query<Message>(`insert into chat_messages(session_id,role,content,tool_activities,content_blocks) values ($1,$2,$3,$4::jsonb,$5::jsonb) returning id,role,content,tool_activities,content_blocks,created_at`, [sessionId, input.role, input.content, JSON.stringify(input.toolActivities ?? null), JSON.stringify(input.contentBlocks ?? null)]); await client.query("update chat_sessions set updated_at=now() where id=$1", [sessionId]); return inserted.rows[0]!; }); },
  async resolveThread(userId, sessionId) { return first(pool, `select cs.id,cs.thread_id from chat_sessions cs ${MEMBER} where cs.id=$2`, [userId, sessionId]); },
}; }
async function first<T extends QueryResultRow>(pool: DatabasePool, text: string, values: unknown[]): Promise<T | null> { const r = await pool.query<T>(text, values); return r.rows[0] ?? null; }
