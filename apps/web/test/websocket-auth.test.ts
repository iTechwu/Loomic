// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

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
});
