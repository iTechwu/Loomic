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

import {
  type SsoSession,
  SsoSessionRefreshError,
  refreshSsoSession,
  signOutFromSso,
} from "./sso-auth";

export type AuthUser = SsoSession["user"];
export type AuthServiceError = { requestId?: string };

interface AuthContextValue {
  user: AuthUser | null;
  session: SsoSession | null;
  loading: boolean;
  serviceError: AuthServiceError | null;
  sessionExpired: boolean;
  completeSignIn: (session: SsoSession) => void;
  refreshSession: () => Promise<SsoSession | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SsoSession | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [serviceError, setServiceError] = useState<AuthServiceError | null>(
    null,
  );
  const [sessionExpired, setSessionExpired] = useState(false);
  const refreshTimer = useRef<number | null>(null);
  const hadSession = useRef(false);

  const applySession = useCallback((nextSession: SsoSession | null) => {
    hadSession.current = Boolean(nextSession);
    if (nextSession) setSessionExpired(false);
    setSession(nextSession);
    setUser(nextSession?.user ?? null);
  }, []);

  const refreshSession = useCallback(async (): Promise<SsoSession | null> => {
    try {
      const nextSession = await refreshSsoSession();
      setServiceError(null);
      if (!nextSession && hadSession.current) setSessionExpired(true);
      applySession(nextSession);
      return nextSession;
    } catch (error) {
      // A transport/configuration failure does not invalidate an access token
      // already held in memory. Keep it usable until a confirmed 401 arrives.
      setSessionExpired(false);
      setServiceError({
        ...(error instanceof SsoSessionRefreshError && error.requestId
          ? { requestId: error.requestId }
          : {}),
      });
      return null;
    }
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
      serviceError,
      sessionExpired,
      session,
      signOut,
      user,
    }),
    [
      completeSignIn,
      loading,
      refreshSession,
      serviceError,
      session,
      sessionExpired,
      signOut,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
