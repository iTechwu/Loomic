import { describe, expect, it } from "vitest";

import { adaptDeepAgentStream } from "./stream-adapter.js";

async function collect(stream: AsyncIterable<unknown>, signal?: AbortSignal) {
  const events = [];
  for await (const event of adaptDeepAgentStream({
    conversationId: "conversation_123",
    runId: "run_123",
    sessionId: "session_123",
    now: () => "2026-07-19T00:00:00.000Z",
    ...(signal ? { signal } : {}),
    stream,
  })) {
    events.push(event);
  }
  return events;
}

describe("adaptDeepAgentStream", () => {
  it("preserves OpenAI-compatible reasoning chunks and the final text", async () => {
    const events = await collect(
      (async function* () {
        yield {
          event: "on_chat_model_stream",
          data: {
            chunk: {
              id: "message_123",
              content: "",
              additional_kwargs: { reasoning_content: "thinking" },
            },
          },
        };
        yield {
          event: "on_chat_model_stream",
          data: { chunk: { id: "message_123", content: "answer" } },
        };
      })(),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "thinking.delta",
      "message.delta",
      "run.completed",
    ]);
  });

  it("returns a visible failure when a model finishes without content", async () => {
    const events = await collect(
      (async function* () {
        yield {
          event: "on_chat_model_stream",
          data: { chunk: { id: "message_123", content: "" } },
        };
      })(),
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.failed",
    ]);
  });

  it("yields run.canceled and stops when the abort signal is already tripped", async () => {
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      (async function* () {
        yield {
          event: "on_chat_model_stream",
          data: { chunk: { id: "message_123", content: "ignored" } },
        };
      })(),
      controller.signal,
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.canceled",
    ]);
  });

  it("yields run.canceled when the abort signal trips mid-stream", async () => {
    const controller = new AbortController();

    const events = await collect(
      (async function* () {
        yield {
          event: "on_chat_model_stream",
          data: { chunk: { id: "message_123", content: "first" } },
        };
        controller.abort();
        yield {
          event: "on_chat_model_stream",
          data: { chunk: { id: "message_123", content: "second" } },
        };
      })(),
      controller.signal,
    );

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "message.delta",
      "run.canceled",
    ]);
  });
});
