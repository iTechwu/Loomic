import { describe, expect, it, vi } from "vitest";
import type { BackendFactory, BackendProtocol } from "deepagents";
import type { ToolRuntime } from "@langchain/core/tools";

import { createProjectSearchTool } from "./project-search.js";

describe("createProjectSearchTool", () => {
  it("passes the LangGraph store to a backend factory", async () => {
    const resolvedBackend = {
      grepRaw: vi.fn(async () => []),
    } as unknown as BackendProtocol;
    const factory = vi.fn(() => resolvedBackend) as unknown as BackendFactory;
    const tool = createProjectSearchTool(factory);
    const state = { files: {} };
    const store = {};

    await tool.invoke(
      { query: "ixicai.cn" },
      { state, store } as unknown as ToolRuntime,
    );

    expect(factory).toHaveBeenCalledWith({ state, store });
  });
});
