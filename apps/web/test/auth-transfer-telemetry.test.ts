// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  beginAuthTransferFlow,
  clearAuthTransferFlow,
  createAuthTransferTelemetryEvent,
  getOrCreateAuthTransferFlow,
  reportAuthTransferEvent,
} from "../src/lib/auth-transfer-telemetry";

describe("auth transfer telemetry", () => {
  afterEach(() => {
    clearAuthTransferFlow();
    vi.restoreAllMocks();
  });

  it("sends only the allowlisted callback transition payload", () => {
    const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    vi.spyOn(Date, "now").mockReturnValue(1_500);

    reportAuthTransferEvent({
      entryPoint: "callback",
      flowId: "flow_12345678",
      startedAt: 0,
      state: "authorized",
    });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]?.[0]).toBe("/api/telemetry/auth-transfer");
    expect(
      createAuthTransferTelemetryEvent({
        entryPoint: "callback",
        flowId: "flow_12345678",
        startedAt: 0,
        state: "authorized",
      }),
    ).toEqual({
      durationMsBucket: "1_to_5s",
      entryPoint: "callback",
      flowId: "flow_12345678",
      state: "authorized",
    });
  });

  it("keeps a random flow only for the current tab across the SSO callback", () => {
    const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    vi.spyOn(Date, "now").mockReturnValue(400);

    const started = beginAuthTransferFlow("public");
    expect(getOrCreateAuthTransferFlow()).toEqual(started);
    expect(started.entryPoint).toBe("public");
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    clearAuthTransferFlow();
    expect(getOrCreateAuthTransferFlow().flowId).not.toBe(started.flowId);
  });

  it("keeps the duration bucket correct after an external SSO document navigation", () => {
    const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    const now = vi.spyOn(Date, "now");
    now.mockReturnValueOnce(1_000);
    const flow = beginAuthTransferFlow("workspace");
    now.mockReturnValue(7_500);

    expect(createAuthTransferTelemetryEvent({ ...flow, state: "authorized" }))
      .toMatchObject({ durationMsBucket: "5_to_10s" });
  });
});
