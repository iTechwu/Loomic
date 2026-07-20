import { describe, expect, it } from "vitest";

import { adaptDeepAgentStream } from "./stream-adapter.js";

async function collect(stream: AsyncIterable<unknown>) {
  const events = [];
  for await (const event of adaptDeepAgentStream({
    conversationId: "conversation_123",
    runId: "run_123",
    sessionId: "session_123",
    now: () => "2026-07-19T00:00:00.000Z",
    stream,
  })) {
    events.push(event);
  }
  return events;
}

describe("adaptDeepAgentStream", () => {
  it("preserves OpenAI-compatible reasoning chunks and the final text", async () => {
    const events = await collect((async function* () {
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
    })());

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "thinking.delta",
      "message.delta",
      "run.completed",
    ]);
  });

  it("returns a visible failure when a model finishes without content", async () => {
    const events = await collect((async function* () {
      yield {
        event: "on_chat_model_stream",
        data: { chunk: { id: "message_123", content: "" } },
      };
    })());

    expect(events.map((event) => event.type)).toEqual([
      "run.started",
      "run.failed",
    ]);
  });
});
