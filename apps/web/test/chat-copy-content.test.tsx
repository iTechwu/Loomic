// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ContentBlock } from "@lovart.dofe/shared";
import { ChatMessage } from "../src/components/chat-message";
import { ToastProvider } from "../src/components/toast";

function renderChatMessage(
  role: "user" | "assistant",
  contentBlocks: ContentBlock[],
  isStreaming = false,
) {
  return render(
    <ToastProvider>
      <ChatMessage
        role={role}
        contentBlocks={contentBlocks}
        isStreaming={isStreaming}
      />
    </ToastProvider>,
  );
}

describe("chat content copying", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("copies user message text and confirms the action", async () => {
    const user = userEvent.setup();
    renderChatMessage("user", [{ type: "text", text: "请制作一张海报" }]);

    await user.click(screen.getByRole("button", { name: "复制用户消息" }));

    expect(screen.getByText("用户消息已复制")).toBeInTheDocument();
    expect(console.info).toHaveBeenCalledWith("[chat-copy] content copied", {
      label: "用户消息",
      length: "请制作一张海报".length,
    });
  });

  it("copies completed assistant, thinking, and tool content", async () => {
    const user = userEvent.setup();
    renderChatMessage("assistant", [
      { type: "text", text: "## 已完成\n海报已生成。" },
      { type: "thinking", thinking: "先确认尺寸和视觉风格。" },
      {
        type: "tool",
        toolCallId: "tool-1",
        toolName: "inspect_canvas",
        status: "completed",
        input: { canvasId: "canvas-1" },
        output: { elementCount: 3 },
      },
    ]);

    await user.click(screen.getByRole("button", { name: "复制助手回复" }));
    await user.click(screen.getByRole("button", { name: "复制思考内容" }));
    await user.click(screen.getByRole("button", { name: "复制工具结果" }));

    expect(screen.getByText("助手回复已复制")).toBeInTheDocument();
    expect(screen.getByText("思考内容已复制")).toBeInTheDocument();
    expect(screen.getByText("工具结果已复制")).toBeInTheDocument();
    expect(console.info).toHaveBeenNthCalledWith(
      1,
      "[chat-copy] content copied",
      { label: "助手回复", length: "## 已完成\n海报已生成。".length },
    );
    expect(console.info).toHaveBeenNthCalledWith(
      2,
      "[chat-copy] content copied",
      { label: "思考内容", length: "先确认尺寸和视觉风格。".length },
    );
    expect(console.info).toHaveBeenNthCalledWith(
      3,
      "[chat-copy] content copied",
      {
        label: "工具结果",
        length:
          '工具：读取画布\n\n状态：completed\n\n输入：\n{\n  "canvasId": "canvas-1"\n}\n\n输出：\n{\n  "elementCount": 3\n}'
            .length,
      },
    );
  });

  it("disables copy while assistant text is still streaming", () => {
    renderChatMessage(
      "assistant",
      [{ type: "text", text: "仍在生成的内容" }],
      true,
    );

    expect(screen.getByRole("button", { name: "复制助手回复" })).toBeDisabled();
  });
});
