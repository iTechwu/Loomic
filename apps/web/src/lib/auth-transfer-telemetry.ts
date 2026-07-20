export type AuthTransferTelemetryState =
  | "authorized"
  | "callback_invalid"
  | "cancelled"
  | "checking"
  | "exchange_failed"
  | "service_unavailable"
  | "timeout"
  | "viewer_bootstrap_failed";

type AuthTransferTelemetryEvent = {
  durationMsBucket: "lt_1s" | "1_to_5s" | "5_to_10s" | "over_10s";
  entryPoint: "callback" | "workspace";
  flowId: string;
  state: AuthTransferTelemetryState;
};

const AUTH_TRANSFER_TELEMETRY_PATH = "/api/telemetry/auth-transfer";

export function createAuthTransferFlowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `flow_${Math.random().toString(36).slice(2, 14)}`;
}

export function reportAuthTransferEvent(
  event: Omit<AuthTransferTelemetryEvent, "durationMsBucket"> & {
    startedAt: number;
  },
): void {
  if (typeof navigator === "undefined") return;

  const payload: AuthTransferTelemetryEvent = {
    durationMsBucket: toDurationBucket(performance.now() - event.startedAt),
    entryPoint: event.entryPoint,
    flowId: event.flowId,
    state: event.state,
  };
  const body = JSON.stringify(payload);

  // Beacon survives the callback navigation and sends no credentials beyond
  // same-origin cookies already scoped to this relying party.
  if (
    navigator.sendBeacon?.(
      AUTH_TRANSFER_TELEMETRY_PATH,
      new Blob([body], { type: "application/json" }),
    )
  ) {
    return;
  }
  void fetch(AUTH_TRANSFER_TELEMETRY_PATH, {
    body,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    keepalive: true,
    method: "POST",
  }).catch(() => {
    // Telemetry is best-effort and must never change authentication behavior.
  });
}

function toDurationBucket(
  durationMs: number,
): AuthTransferTelemetryEvent["durationMsBucket"] {
  if (durationMs < 1_000) return "lt_1s";
  if (durationMs < 5_000) return "1_to_5s";
  if (durationMs < 10_000) return "5_to_10s";
  return "over_10s";
}
