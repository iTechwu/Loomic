// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { StreamEvent } from "@lovart.dofe/shared";
import type { Message } from "../src/hooks/use-chat-sessions";
import { useChatStream } from "../src/hooks/use-chat-stream";

describe("useChatStream", () => {
  it("renders the server-sanitized failure message", () => {
    let messages: Message[] = [
      {
        id: "assistant-1",
        role: "assistant",
        contentBlocks: [],
      },
    ];
    const updateMessages = (_sessionId: string, updater: (previous: Message[]) => Message[]) => {
      messages = updater(messages);
    };
    const { result } = renderHook(() => useChatStream(updateMessages));
    const event: StreamEvent = {
      type: "run.failed",
      runId: "run-1",
      error: {
        code: "run_failed",
        message: "所选模型当前不可用，请切换模型后重试。",
      },
      timestamp: "2026-07-21T00:00:00.000Z",
    };

    act(() => {
      result.current.applyStreamEvent(event, "assistant-1", "session-1");
    });

    expect(messages[0]?.contentBlocks).toEqual([
      {
        type: "text",
        text: "所选模型当前不可用，请切换模型后重试。",
      },
    ]);
  });
});
