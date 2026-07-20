const WEBSOCKET_AUTH_PROTOCOL_PREFIX = "lovart-auth.v1.";

/**
 * Browsers cannot attach Authorization to a WebSocket handshake. Encode the
 * short-lived access token and reconnect identifier as one RFC token-safe
 * subprotocol so neither appears in the URL, access logs, or referrers.
 */
export function createWebSocketAuthProtocol(
  accessToken: string,
  connectionId: string,
): string {
  return `${WEBSOCKET_AUTH_PROTOCOL_PREFIX}${toBase64Url(accessToken)}.${toBase64Url(connectionId)}`;
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
