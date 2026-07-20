const WEBSOCKET_AUTH_PROTOCOL_PREFIX = "lovart-auth.v1.";
const MAX_ENCODED_ACCESS_TOKEN_LENGTH = 8_192;
const MAX_ENCODED_CONNECTION_ID_LENGTH = 256;
const CONNECTION_ID_PATTERN = /^[a-zA-Z0-9_-]{8,128}$/;

export type WebSocketAuthCredentials = {
  accessToken: string;
  connectionId: string;
};

/**
 * WebSocket browser clients cannot set Authorization. The protocol header is
 * intentionally the only credential channel: query credentials leak into
 * common proxy logs even when application logging is careful.
 */
export function parseWebSocketAuthRequest(
  requestUrl: string,
  protocolHeader: string | string[] | undefined,
): WebSocketAuthCredentials | null {
  const url = new URL(requestUrl, "http://lovart.invalid");
  if (url.search) return null;

  const protocols = Array.isArray(protocolHeader)
    ? protocolHeader
    : (protocolHeader?.split(",") ?? []);
  for (const protocol of protocols) {
    const credentials = parseWebSocketAuthProtocol(protocol.trim());
    if (credentials) return credentials;
  }
  return null;
}

/** Echo only an accepted protocol so browsers can complete the handshake. */
export function selectWebSocketAuthProtocol(
  protocols: Set<string>,
): string | false {
  for (const protocol of protocols) {
    if (parseWebSocketAuthProtocol(protocol)) return protocol;
  }
  return false;
}

function parseWebSocketAuthProtocol(
  protocol: string,
): WebSocketAuthCredentials | null {
  if (!protocol.startsWith(WEBSOCKET_AUTH_PROTOCOL_PREFIX)) return null;

  const encoded = protocol.slice(WEBSOCKET_AUTH_PROTOCOL_PREFIX.length);
  const separator = encoded.indexOf(".");
  if (separator <= 0 || separator === encoded.length - 1) return null;

  const encodedAccessToken = encoded.slice(0, separator);
  const encodedConnectionId = encoded.slice(separator + 1);
  if (
    encodedAccessToken.length > MAX_ENCODED_ACCESS_TOKEN_LENGTH ||
    encodedConnectionId.length > MAX_ENCODED_CONNECTION_ID_LENGTH
  ) {
    return null;
  }

  const accessToken = fromBase64Url(encodedAccessToken);
  const connectionId = fromBase64Url(encodedConnectionId);
  if (
    !accessToken ||
    !connectionId ||
    !CONNECTION_ID_PATTERN.test(connectionId)
  ) {
    return null;
  }
  return { accessToken, connectionId };
}

function fromBase64Url(value: string): string | null {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return Buffer.from(decoded, "utf8").toString("base64url") === value
      ? decoded
      : null;
  } catch {
    return null;
  }
}
