"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import {
  AuthTransferScreen,
  type AuthTransferError,
} from "../../../components/auth/auth-transfer-screen";
import { useAuth } from "../../../lib/auth-context";
import { fetchViewer } from "../../../lib/server-api";
import {
  beginSsoLogin,
  clearPendingSsoReturnTo,
  exchangeSsoCode,
  getPendingSsoReturnTo,
  type SsoSession,
  SsoExchangeError,
} from "../../../lib/sso-auth";

const CALLBACK_TIMEOUT_MS = 10_000;

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
      router.replace(workspaceRetry.returnTo);
    } catch {
      setError("viewer_bootstrap_failed");
    }
  }

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const providerError = searchParams.get("error");
    if (providerError) {
      setError(providerError === "access_denied" ? "cancelled" : providerError === "server_error" ? "service_unavailable" : "exchange_failed");
      return;
    }
    if (!code || !state) {
      setError("callback_invalid");
      return;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      cancelled = true;
      setError("timeout");
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
          setError("exchange_failed");
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
        }
        return;
      }

      if (!cancelled) {
        completeSignIn(result.session);
        clearPendingSsoReturnTo();
        router.replace(result.returnTo);
      }
    })().finally(() => clearTimeout(timeoutId));

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [completeSignIn, router, searchParams]);

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
