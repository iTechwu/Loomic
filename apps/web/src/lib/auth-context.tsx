"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { type SsoSession, refreshSsoSession, signOutFromSso } from "./sso-auth";

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

  const applySession = useCallback((nextSession: SsoSession | null) => {
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
  }, []);

  const refreshSession = useCallback(async (): Promise<SsoSession | null> => {
    const nextSession = await refreshSsoSession();
    applySession(nextSession);
    return nextSession;
  }, [applySession]);

  useEffect(() => {
    void refreshSession().finally(() => setLoading(false));
  }, [refreshSession]);

  useEffect(() => {
    if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    if (!session?.expires_at) return;

    // Renew early when this SSO client is permitted to issue refresh tokens.
    const delay = Math.max(
      5_000,
      session.expires_at * 1_000 - Date.now() - 60_000,
    );
    refreshTimer.current = window.setTimeout(
      () => void refreshSession(),
      delay,
    );
    return () => {
      if (refreshTimer.current) window.clearTimeout(refreshTimer.current);
    };
  }, [refreshSession, session?.expires_at]);

  const completeSignIn = useCallback(
    (nextSession: SsoSession) => {
      applySession(nextSession);
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    const logoutUrl = await signOutFromSso();
    applySession(null);
    window.location.assign(logoutUrl ?? "/?signed_out=1");
  }, [applySession]);

  const value = useMemo(
    () => ({
      completeSignIn,
      loading,
      refreshSession,
      session,
      signOut,
      user,
    }),
    [completeSignIn, loading, refreshSession, session, signOut, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
