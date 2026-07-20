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

  it("bounds otherwise safe context values before they reach log outputs", () => {
    const sanitized = sanitizePipelineLogContext({
      entries: [
        "x".repeat(600),
        ...Array.from({ length: 24 }, (_, index) => index),
      ],
      text: "x".repeat(600),
    });

    expect(sanitized?.entries).toHaveLength(20);
    expect((sanitized?.entries as string[])[0]).toHaveLength(512);
    expect(sanitized?.text).toHaveLength(512);
  });

  it("bounds cyclic arrays and bigint values without breaking the logger", () => {
    const entries: unknown[] = [];
    entries.push(entries);

    expect(
      sanitizePipelineLogContext({ entries, numericId: BigInt(42) }),
    ).toEqual({
      entries: [{ circular: "[redacted]" }],
      numericId: "42",
    });
  });
});
