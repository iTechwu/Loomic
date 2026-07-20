// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { reportAuthTransferEvent } from "../src/lib/auth-transfer-telemetry";

describe("auth transfer telemetry", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sends only the allowlisted callback transition payload", () => {
    const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    vi.spyOn(performance, "now").mockReturnValue(1_500);

    reportAuthTransferEvent({
      entryPoint: "callback",
      flowId: "flow_12345678",
      startedAt: 0,
      state: "authorized",
    });

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon.mock.calls[0]?.[0]).toBe("/api/telemetry/auth-transfer");
  });
});
