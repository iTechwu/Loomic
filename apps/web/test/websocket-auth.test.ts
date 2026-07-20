// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { createWebSocketConnectionId } from "../src/hooks/use-websocket";
import { createWebSocketAuthProtocol } from "../src/lib/websocket-auth";

describe("WebSocket auth protocol", () => {
  it("encodes credentials into a token-safe subprotocol instead of a URL query", () => {
    const protocol = createWebSocketAuthProtocol(
      "access.token/with=reserved?characters",
      "connection_12345678",
    );

    expect(protocol).toMatch(
      /^lovart-auth\.v1\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+$/,
    );
    expect(protocol).not.toContain("?");
    expect(protocol).not.toContain("=");
  });

  it("keeps an in-memory reconnect ID when browser storage is unavailable", () => {
    const original = globalThis.sessionStorage;
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("blocked");
        },
      },
    });

    expect(createWebSocketConnectionId()).toMatch(/^[a-zA-Z0-9_-]{8,128}$/);
    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      value: original,
    });
  });
});
