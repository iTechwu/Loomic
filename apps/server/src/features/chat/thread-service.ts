import { randomUUID } from "node:crypto";
import type { NativeChatRepository } from "../../database/chat-repository.js";
import type { AuthenticatedUser } from "../../supabase/user.js";
export class ThreadServiceError extends Error { readonly code = "session_not_found"; constructor(message: string, readonly statusCode: number) { super(message); } }
export type SessionThreadBinding = { sessionId: string; threadId: string };
export type ThreadService = { createThreadId(): string; resolveOwnedSessionThread(user: AuthenticatedUser, sessionId: string): Promise<SessionThreadBinding> };
export function createThreadService(options: { repository: NativeChatRepository; threadIdFactory?: () => string }): ThreadService { const factory = options.threadIdFactory ?? (() => `thread_${randomUUID()}`); return { createThreadId: factory, async resolveOwnedSessionThread(user, sessionId) { const session = await options.repository.resolveThread(user.id, sessionId); if (!session) throw new ThreadServiceError("Session not found.", 404); if (!session.thread_id) throw new ThreadServiceError("Session is not resumable because no thread is bound yet.", 409); return { sessionId: session.id, threadId: session.thread_id }; } }; }
