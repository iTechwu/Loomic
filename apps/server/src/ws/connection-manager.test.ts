import { describe, expect, it } from "vitest";
import type { WebSocket } from "ws";

import type { StreamEvent } from "@lovart.dofe/shared";

import { ConnectionManager } from "./connection-manager.js";

function createFakeWs(onSend: (data: string) => void): WebSocket {
  return {
    readyState: 1, // WebSocket.OPEN
    send: onSend,
  } as unknown as WebSocket;
}

describe("ConnectionManager.pushToCanvas serialization", () => {
  it("preserves Error instance fields instead of serializing them to {}", () => {
    // 回归测试：线上曾出现 run.failed 事件的 error 字段为空对象 {}，根因是某条
    // 路径把 Error 实例塞进了 event.error，而 JSON.stringify(Error) 会因
    // message/stack 为非可枚举属性而静默返回 "{}"。序列化层（stringifyStreamEvent）
    // 需在边界把 Error 规范化为 plain object，确保 message 不丢失。
    const cm = new ConnectionManager();
    let captured: string | undefined;
    const ws = createFakeWs((data) => {
      captured = data;
    });
    cm.register("conn_1", "user_1", ws);
    cm.bindCanvas("conn_1", "canvas_1");

    const errorInstance = new Error("provider timeout");
    // 模拟 Error 子类挂载的业务字段（如 UploadServiceError.code）
    (errorInstance as { code?: string }).code = "run_failed";
    const brokenEvent = {
      type: "run.failed",
      runId: "run_1",
      error: errorInstance, // 运行时损坏：error 是 Error 实例而非 plain object
      timestamp: "2026-07-23T00:00:00.000Z",
    } as unknown as StreamEvent;

    cm.pushToCanvas("canvas_1", brokenEvent);

    expect(captured).toBeDefined();
    const frame = JSON.parse(captured as string) as {
      type: string;
      event: {
        error: { message?: string; name?: string; code?: string };
      };
    };
    expect(frame.type).toBe("event");
    // 关键断言：Error 的 message 不再丢失成空对象
    expect(frame.event.error).not.toEqual({});
    expect(frame.event.error.message).toBe("provider timeout");
    expect(frame.event.error.name).toBe("Error");
    // Error 子类挂载的可枚举字段也被保留
    expect(frame.event.error.code).toBe("run_failed");
  });

  it("serializes plain-object events unchanged", () => {
    const cm = new ConnectionManager();
    let captured: string | undefined;
    const ws = createFakeWs((data) => {
      captured = data;
    });
    cm.register("conn_2", "user_2", ws);
    cm.bindCanvas("conn_2", "canvas_2");

    cm.pushToCanvas("canvas_2", {
      type: "run.failed",
      runId: "run_2",
      error: { code: "run_failed", message: "请求处理失败，请重试。" },
      timestamp: "2026-07-23T00:00:00.000Z",
    });

    const frame = JSON.parse(captured as string) as {
      type: string;
      event: { error: { code: string; message: string } };
    };
    expect(frame.type).toBe("event");
    expect(frame.event.error).toEqual({
      code: "run_failed",
      message: "请求处理失败，请重试。",
    });
  });
});
