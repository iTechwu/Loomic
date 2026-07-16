"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef } from "react";

import { LoadingScreen } from "../../../components/loading-screen";
import { useAuth } from "../../../lib/auth-context";
import { fetchViewer } from "../../../lib/server-api";
import { exchangeSsoCode } from "../../../lib/sso-auth";

const CALLBACK_TIMEOUT_MS = 10_000;

function loginErrorUrl(error: string): string {
  return `/login?${new URLSearchParams({ error }).toString()}`;
}

function AuthCallbackPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { completeSignIn } = useAuth();
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const providerError = searchParams.get("error");
    if (providerError) return router.replace(loginErrorUrl(providerError));
    if (!code || !state) return router.replace(loginErrorUrl("auth_callback_invalid"));

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      cancelled = true;
      router.replace(loginErrorUrl("auth_callback_timeout"));
    }, CALLBACK_TIMEOUT_MS);

    void (async () => {
      let result: Awaited<ReturnType<typeof exchangeSsoCode>>;
      try {
        result = await exchangeSsoCode(code, state);
      } catch {
        if (!cancelled) router.replace(loginErrorUrl("auth_exchange_failed"));
        return;
      }

      if (cancelled) return;
      try {
        await fetchViewer(result.session.access_token);
      } catch {
        if (!cancelled) router.replace(loginErrorUrl("viewer_bootstrap_failed"));
        return;
      }

      if (!cancelled) {
        completeSignIn(result.session);
        router.replace(result.returnTo);
      }
    })().finally(() => clearTimeout(timeoutId));

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [completeSignIn, router, searchParams]);

  return <LoadingScreen />;
}

export default function AuthCallbackPage() {
  return <Suspense fallback={<LoadingScreen />}><AuthCallbackPageContent /></Suspense>;
}
