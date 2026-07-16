"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

import { refreshSsoSession, signOutFromSso, type SsoSession } from "./sso-auth";

export type AuthUser = SsoSession["user"];

interface AuthContextValue {
  user: AuthUser | null;
  session: SsoSession | null;
  loading: boolean;
  completeSignIn: (session: SsoSession) => void;
  refreshSession: () => Promise<SsoSession | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SsoSession | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const refreshTimer = useRef<number | null>(null);

  function applySession(nextSession: SsoSession | null) {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
  }

  async function refreshSession(): Promise<SsoSession | null> {
    const nextSession = await refreshSsoSession();
    applySession(nextSession);
    return nextSession;
  }

  useEffect(() => {
    void refreshSession().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    if (!session?.expires_at) return;

    // Renew early when this SSO client is permitted to issue refresh tokens.
    const delay = Math.max(5_000, session.expires_at * 1_000 - Date.now() - 60_000);
    refreshTimer.current = window.setTimeout(() => void refreshSession(), delay);
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [session?.expires_at]);

  function completeSignIn(nextSession: SsoSession) {
    applySession(nextSession);
  }

  async function signOut() {
    const logoutUrl = await signOutFromSso();
    applySession(null);
    if (logoutUrl) window.location.assign(logoutUrl);
  }

  return <AuthContext.Provider value={{ user, session, loading, completeSignIn, refreshSession, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
