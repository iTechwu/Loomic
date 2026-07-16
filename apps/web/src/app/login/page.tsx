"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

import { AuthShell } from "../../components/auth/auth-shell";
import { LoginForm } from "../../components/login-form";
import { LoadingScreen } from "../../components/loading-screen";
import { useAuth } from "../../lib/auth-context";

const CALLBACK_ERROR_MESSAGES: Record<string, string> = {
  auth_callback_invalid: "The sign-in response is incomplete. Please try again.",
  auth_exchange_failed: "DoFe could not verify this sign-in. Please try again.",
  viewer_bootstrap_failed: "Your identity was verified, but we could not prepare the workspace. Please try again.",
  auth_callback_timeout: "Sign-in took too long to complete. Please try again.",
};

function LoginPageContent() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackError = searchParams.get("error");
  const redirect = searchParams.get("redirect");
  const returnTo = redirect && redirect.startsWith("/") && !redirect.startsWith("//") && !redirect.startsWith("/\\")
    ? redirect
    : "/home";
  const initialErrorMessage = callbackError
    ? CALLBACK_ERROR_MESSAGES[callbackError] ??
      "Could not complete sign-in. Please try again."
    : null;

  useEffect(() => {
    if (!loading && user) {
      router.replace("/home");
    }
  }, [user, loading, router]);

  if (loading || user) return <LoadingScreen />;

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to continue where your workspace left off."
      features={[
        "One DoFe account across connected workspaces",
        "Your canvas and workspace stay associated with the same identity",
        "Sign in once when your DoFe session is already active",
      ]}
    >
      <LoginForm initialErrorMessage={initialErrorMessage} returnTo={returnTo} />
    </AuthShell>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoadingScreen />}>
      <LoginPageContent />
    </Suspense>
  );
}
