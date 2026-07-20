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

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const providerError = searchParams.get("error");
    if (providerError) {
      setError(providerError === "access_denied" ? "cancelled" : "exchange_failed");
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
        if (!cancelled) setError("viewer_bootstrap_failed");
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
      onRetry={() => beginSsoLogin(getPendingSsoReturnTo())}
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
