import { describe, expect, it } from "vitest";

import { sanitizePipelineLogContext } from "./logger.js";

describe("pipeline log sanitization", () => {
  it("redacts direct and nested credentials, identity, content, and error fields", () => {
    expect(
      sanitizePipelineLogContext({
        failureCategory: "agent_stream",
        nested: { prompt: "private", token: "secret" },
        entries: [{ connectionId: "conn_123", value: "safe" }],
        runId: "run_123",
        userId: "user_123",
      }),
    ).toEqual({
      failureCategory: "agent_stream",
      nested: { prompt: "[redacted]", token: "[redacted]" },
      entries: [{ connectionId: "[redacted]", value: "safe" }],
      runId: "[redacted]",
      userId: "[redacted]",
    });
  });

  it("redacts cyclic contexts without throwing", () => {
    const context: Record<string, unknown> = {};
    context.self = context;
    expect(sanitizePipelineLogContext(context)).toEqual({
      self: { circular: "[redacted]" },
    });
  });
});
