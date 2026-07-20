export type AuthTransferTelemetryState =
  | "authorized"
  | "callback_invalid"
  | "cancelled"
  | "checking"
  | "exchange_failed"
  | "intent_started"
  | "service_unavailable"
  | "timeout"
  | "viewer_bootstrap_failed";

export type AuthTransferEntryPoint = "callback" | "public" | "workspace";

export type AuthTransferFlow = {
  entryPoint: AuthTransferEntryPoint;
  flowId: string;
  startedAt: number;
};

export type AuthTransferTelemetryEvent = {
  durationMsBucket: "lt_1s" | "1_to_5s" | "5_to_10s" | "over_10s";
  entryPoint: AuthTransferEntryPoint;
  flowId: string;
  state: AuthTransferTelemetryState;
};

const AUTH_TRANSFER_TELEMETRY_PATH = "/api/telemetry/auth-transfer";
const AUTH_TRANSFER_FLOW_KEY = "lovart.dofe:auth-transfer-flow";
const TERMINAL_STATES = new Set<AuthTransferTelemetryState>([
  "authorized",
  "callback_invalid",
  "cancelled",
  "exchange_failed",
  "service_unavailable",
  "timeout",
  "viewer_bootstrap_failed",
]);

export function createAuthTransferFlowId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `flow_${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Starts a same-tab, anonymous auth funnel. sessionStorage deliberately keeps
 * it across the external SSO redirect but never across browser sessions.
 */
export function beginAuthTransferFlow(
  entryPoint: AuthTransferEntryPoint,
): AuthTransferFlow {
  const flow = {
    entryPoint,
    flowId: createAuthTransferFlowId(),
    // performance.now() resets on the external SSO document navigation. This
    // value is persisted in sessionStorage, so it must use a cross-document
    // clock or callback durations collapse into the smallest bucket.
    startedAt: Date.now(),
  };
  writeAuthTransferFlow(flow);
  reportAuthTransferEvent({ ...flow, state: "intent_started" });
  return flow;
}

/** Returns the active same-tab funnel, or a callback-only fallback. */
export function getOrCreateAuthTransferFlow(): AuthTransferFlow {
  return (
    readAuthTransferFlow() ?? {
      entryPoint: "callback",
      flowId: createAuthTransferFlowId(),
      startedAt: Date.now(),
    }
  );
}

export function clearAuthTransferFlow(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(AUTH_TRANSFER_FLOW_KEY);
  } catch {
    // Storage access is optional; the event remains safe without correlation.
  }
}

export function isTerminalAuthTransferState(
  state: AuthTransferTelemetryState,
): boolean {
  return TERMINAL_STATES.has(state);
}

export function reportAuthTransferEvent(
  event: Omit<AuthTransferTelemetryEvent, "durationMsBucket"> & {
    startedAt: number;
  },
): void {
  if (typeof navigator === "undefined") return;

  const payload = createAuthTransferTelemetryEvent(event);
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

/** Builds the exact allowlisted telemetry payload before transport selection. */
export function createAuthTransferTelemetryEvent(
  event: Omit<AuthTransferTelemetryEvent, "durationMsBucket"> & {
    startedAt: number;
  },
): AuthTransferTelemetryEvent {
  return {
    durationMsBucket: toDurationBucket(
      Math.max(0, Date.now() - event.startedAt),
    ),
    entryPoint: event.entryPoint,
    flowId: event.flowId,
    state: event.state,
  };
}

function readAuthTransferFlow(): AuthTransferFlow | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(AUTH_TRANSFER_FLOW_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<AuthTransferFlow>;
    if (
      typeof value.flowId !== "string" ||
      typeof value.startedAt !== "number" ||
      !isAuthTransferEntryPoint(value.entryPoint)
    ) {
      return null;
    }
    return {
      entryPoint: value.entryPoint,
      flowId: value.flowId,
      startedAt: value.startedAt,
    };
  } catch {
    return null;
  }
}

function writeAuthTransferFlow(flow: AuthTransferFlow): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(AUTH_TRANSFER_FLOW_KEY, JSON.stringify(flow));
  } catch {
    // Telemetry correlation is best-effort and must not block SSO navigation.
  }
}

function isAuthTransferEntryPoint(
  value: unknown,
): value is AuthTransferEntryPoint {
  return value === "callback" || value === "public" || value === "workspace";
}

function toDurationBucket(
  durationMs: number,
): AuthTransferTelemetryEvent["durationMsBucket"] {
  if (durationMs < 1_000) return "lt_1s";
  if (durationMs < 5_000) return "1_to_5s";
  if (durationMs < 10_000) return "5_to_10s";
  return "over_10s";
}
