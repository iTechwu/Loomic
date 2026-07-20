import { describe, expect, it } from "vitest";

import {
  parseWebSocketAuthRequest,
  selectWebSocketAuthProtocol,
} from "./auth-protocol.js";

function encode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function protocol(
  accessToken = "access-token",
  connectionId = "connection_12345678",
) {
  return `lovart-auth.v1.${encode(accessToken)}.${encode(connectionId)}`;
}

describe("WebSocket auth protocol", () => {
  it("decodes protocol credentials while keeping the request URL query-free", () => {
    const credentials = parseWebSocketAuthRequest("/api/ws", protocol());

    expect(credentials).toEqual({
      accessToken: "access-token",
      connectionId: "connection_12345678",
    });
  });

  it("rejects query credentials and malformed connection identities", () => {
    expect(
      parseWebSocketAuthRequest("/api/ws?token=leaked", protocol()),
    ).toBeNull();
    expect(
      parseWebSocketAuthRequest("/api/ws", "lovart-auth.v1.bad.bad"),
    ).toBeNull();
  });

  it("selects only a valid offered subprotocol for the handshake", () => {
    const valid = protocol();

    expect(selectWebSocketAuthProtocol(new Set(["chat.v1", valid]))).toBe(
      valid,
    );
    expect(selectWebSocketAuthProtocol(new Set(["chat.v1"]))).toBe(false);
  });
});
