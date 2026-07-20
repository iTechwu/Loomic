"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";

import {
  type AuthTransferError,
  AuthTransferScreen,
} from "../../../components/auth/auth-transfer-screen";
import { useAuth } from "../../../lib/auth-context";
import {
  type AuthTransferTelemetryState,
  createAuthTransferFlowId,
  reportAuthTransferEvent,
} from "../../../lib/auth-transfer-telemetry";
import { fetchViewer } from "../../../lib/server-api";
import {
  SsoExchangeError,
  type SsoSession,
  beginSsoLogin,
  clearPendingSsoReturnTo,
  exchangeSsoCode,
  getPendingSsoReturnTo,
} from "../../../lib/sso-auth";

const CALLBACK_TIMEOUT_MS = 10_000;

function mapProviderError(error: string): AuthTransferError {
  if (error === "access_denied") return "cancelled";
  if (error === "server_error" || error === "temporarily_unavailable") {
    return "service_unavailable";
  }
  return "exchange_failed";
}

function mapExchangeError(error: unknown): AuthTransferError {
  if (!(error instanceof SsoExchangeError)) return "service_unavailable";
  if (error.message === "invalid_callback") return "callback_invalid";
  if (error.message === "sso_not_configured") return "service_unavailable";
  return "exchange_failed";
}

function AuthCallbackPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { completeSignIn } = useAuth();
  const started = useRef(false);
  const [error, setError] = useState<AuthTransferError>();
  const [supportId, setSupportId] = useState<string>();
  const [workspaceRetry, setWorkspaceRetry] = useState<{
    returnTo: string;
    session: SsoSession;
  }>();
  const flowId = useRef(createAuthTransferFlowId());
  const startedAt = useRef(performance.now());
  const reportedStates = useRef(new Set<AuthTransferTelemetryState>());

  const reportState = useCallback((state: AuthTransferTelemetryState) => {
    if (reportedStates.current.has(state)) return;
    reportedStates.current.add(state);
    reportAuthTransferEvent({
      entryPoint: "callback",
      flowId: flowId.current,
      startedAt: startedAt.current,
      state,
    });
  }, []);

  async function retryWorkspaceBootstrap() {
    if (!workspaceRetry) {
      beginSsoLogin(getPendingSsoReturnTo());
      return;
    }

    setError(undefined);
    try {
      await fetchViewer(workspaceRetry.session.access_token);
      completeSignIn(workspaceRetry.session);
      clearPendingSsoReturnTo();
      reportState("authorized");
      router.replace(workspaceRetry.returnTo);
    } catch {
      setError("viewer_bootstrap_failed");
      reportState("viewer_bootstrap_failed");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    reportState("checking");

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const providerError = searchParams.get("error");
    if (providerError) {
      const mappedError = mapProviderError(providerError);
      setError(mappedError);
      reportState(mappedError);
      return;
    }
    if (!code || !state) {
      setError("callback_invalid");
      reportState("callback_invalid");
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      cancelled = true;
      setError("timeout");
      reportState("timeout");
    }, CALLBACK_TIMEOUT_MS);

    void (async () => {
      let result: Awaited<ReturnType<typeof exchangeSsoCode>>;
      try {
        result = await exchangeSsoCode(code, state);
      } catch (exchangeError) {
        if (!cancelled) {
          if (exchangeError instanceof SsoExchangeError) {
            setSupportId(exchangeError.requestId);
          }
          const mappedError = mapExchangeError(exchangeError);
          setError(mappedError);
          reportState(mappedError);
        }
        return;
      }

      if (cancelled) return;
      try {
        await fetchViewer(result.session.access_token);
      } catch {
        if (!cancelled) {
          setWorkspaceRetry(result);
          setError("viewer_bootstrap_failed");
          reportState("viewer_bootstrap_failed");
        }
        return;
      }

      if (!cancelled) {
        completeSignIn(result.session);
        clearPendingSsoReturnTo();
        reportState("authorized");
        router.replace(result.returnTo);
      }
    })().finally(() => clearTimeout(timeoutId));

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [completeSignIn, reportState, router, searchParams]);

  return (
    <AuthTransferScreen
      {...(error ? { error } : {})}
      onRetry={() => {
        if (error === "viewer_bootstrap_failed") {
          void retryWorkspaceBootstrap();
          return;
        }
        beginSsoLogin(getPendingSsoReturnTo());
      }}
      retryLabel={
        error === "viewer_bootstrap_failed" ? "重试打开工作区" : "重新开始"
      }
      {...(supportId ? { supportId } : {})}
    />
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<AuthTransferScreen />}>
      <AuthCallbackPageContent />
    </Suspense>
  );
}
