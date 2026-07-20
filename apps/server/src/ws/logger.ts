import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Structured logger for WebSocket + Agent pipeline.
 *
 * - stdout: human-readable one-liner with color-coded level
 * - file: JSON lines, one file per day (pipeline-YYYY-MM-DD.log)
 *
 * Log directory: an ephemeral runtime path (defaults to /tmp).
 *
 * Usage:
 *   const log = createPipelineLogger("ws");
 *   log.info("connected", { userId });
 *   log.warn("auth_failed", { reason: "token expired" });
 *   log.lap("thread_resolved");  // auto-tracks elapsed ms
 */

type LogLevel = "info" | "warn" | "error";

const LEVEL_NUM: Record<LogLevel, number> = { info: 30, warn: 40, error: 50 };
const LEVEL_LABEL: Record<LogLevel, string> = {
  info: "INFO",
  warn: "WARN",
  error: "ERROR",
};

// Ensure log directory exists
const LOG_DIR = process.env.LOVART_DOFE_LOG_DIR ?? "/tmp/lovart-dofe-logs";
const SENSITIVE_CONTEXT_KEY =
  /authorization|cookie|email|error|password|prompt|run.?id|secret|session.?id|token|user.?id|connection.?id/i;
const REDACTED = "[redacted]";
const MAX_LOG_ARRAY_ITEMS = 20;
const MAX_LOG_OBJECT_ENTRIES = 50;
const MAX_LOG_STRING_LENGTH = 512;
try {
  mkdirSync(LOG_DIR, { recursive: true });
} catch {
  /* ignore */
}

/** Returns today's log file path: pipeline-YYYY-MM-DD.log */
function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(LOG_DIR, `pipeline-${date}.log`);
}

export type PipelineLogger = {
  info: (event: string, ctx?: Record<string, unknown>) => void;
  warn: (event: string, ctx?: Record<string, unknown>) => void;
  error: (event: string, ctx?: Record<string, unknown>) => void;
  /** Log with auto-calculated elapsed time since logger creation */
  lap: (event: string, ctx?: Record<string, unknown>) => void;
  /** Get elapsed ms since logger creation */
  elapsed: () => number;
};

/** Last-resort protection for callers that accidentally include user content. */
export function sanitizePipelineLogContext(
  context: Record<string, unknown> | undefined,
  seen = new WeakSet<object>(),
): Record<string, unknown> | undefined {
  if (!context) return undefined;
  if (seen.has(context)) return { circular: REDACTED };
  seen.add(context);
  return Object.fromEntries(
    Object.entries(context)
      .slice(0, MAX_LOG_OBJECT_ENTRIES)
      .map(([key, value]) => [
        key,
        SENSITIVE_CONTEXT_KEY.test(key)
          ? REDACTED
          : Array.isArray(value)
            ? value
                .slice(0, MAX_LOG_ARRAY_ITEMS)
                .map((item) =>
                  item && typeof item === "object"
                    ? sanitizePipelineLogContext(
                        item as Record<string, unknown>,
                        seen,
                      )
                    : item,
                )
            : value && typeof value === "object"
              ? sanitizePipelineLogContext(
                  value as Record<string, unknown>,
                  seen,
                )
              : typeof value === "string"
                ? value.slice(0, MAX_LOG_STRING_LENGTH)
                : value,
      ]),
  );
}

export function createPipelineLogger(
  scope: string,
  baseCtx?: Record<string, unknown>,
): PipelineLogger {
  const t0 = Date.now();

  function emit(level: LogLevel, event: string, ctx?: Record<string, unknown>) {
    const now = Date.now();
    const safeBaseContext = sanitizePipelineLogContext(baseCtx);
    const safeContext = sanitizePipelineLogContext(ctx);
    const entry = {
      level: LEVEL_NUM[level],
      time: now,
      scope,
      event,
      ...safeBaseContext,
      ...safeContext,
    };
    const line = `${JSON.stringify(entry)}\n`;

    // stdout: human-friendly one-liner
    const ts = new Date(now).toISOString().slice(11, 23);
    const ctxStr = safeContext
      ? ` ${Object.entries(safeContext)
          .map(([k, v]) => `${k}=${v}`)
          .join(" ")}`
      : "";
    process.stdout.write(
      `${ts} [${LEVEL_LABEL[level]}] ${scope}.${event}${ctxStr}\n`,
    );

    // file: structured JSON lines (daily rotation)
    try {
      appendFileSync(getLogFile(), line);
    } catch {
      /* ignore */
    }
  }

  return {
    info: (event, ctx) => emit("info", event, ctx),
    warn: (event, ctx) => emit("warn", event, ctx),
    error: (event, ctx) => emit("error", event, ctx),
    lap: (event, ctx) =>
      emit("info", event, { ...ctx, elapsed_ms: Date.now() - t0 }),
    elapsed: () => Date.now() - t0,
  };
}
