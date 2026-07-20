// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefreshSession, mockSignOut } = vi.hoisted(() => ({
  mockRefreshSession: vi.fn(),
  mockSignOut: vi.fn(),
}));
const { MockSsoSessionRefreshError } = vi.hoisted(() => ({
  MockSsoSessionRefreshError: class extends Error {
    requestId: string | undefined;

    constructor(message: string, requestId?: string) {
      super(message);
      this.name = "SsoSessionRefreshError";
      this.requestId = requestId;
    }
  },
}));

vi.mock("../src/lib/sso-auth", () => ({
  refreshSsoSession: mockRefreshSession,
  signOutFromSso: mockSignOut,
  SsoSessionRefreshError: MockSsoSessionRefreshError,
}));

import { AuthProvider, useAuth } from "../src/lib/auth-context";

function TestConsumer() {
  const { user, loading, refreshSession, serviceError, sessionExpired } = useAuth();
  return (
    <>
      <span data-testid="loading">{String(loading)}</span>
      <span data-testid="user">{user?.email ?? "none"}</span>
      <span data-testid="session-expired">{String(sessionExpired)}</span>
      <span data-testid="service-error">{serviceError?.requestId ?? "none"}</span>
      <button type="button" onClick={() => void refreshSession()}>
        Refresh session
      </button>
    </>
  );
}

const completeSignInReferences: AuthCompleteSignIn[] = [];
type AuthCompleteSignIn = ReturnType<typeof useAuth>["completeSignIn"];

function CompleteSignInReferenceConsumer() {
  const { completeSignIn, loading } = useAuth();

  useEffect(() => {
    completeSignInReferences.push(completeSignIn);
  }, [completeSignIn]);

  return <span data-testid="complete-sign-in-loading">{String(loading)}</span>;
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeSignInReferences.length = 0;
    mockRefreshSession.mockResolvedValue(null);
  });

  afterEach(cleanup);

  it("resolves an absent SSO session", async () => {
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("loading").textContent).toBe("false"),
    );
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("restores the data session from the HttpOnly SSO refresh cookie", async () => {
    mockRefreshSession.mockResolvedValue({
      access_token: "data-token",
      expires_at: Math.floor(Date.now() / 1000) + 300,
      user: { id: "u1", email: "test@example.com", user_metadata: {} },
    });
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("test@example.com"),
    );
  });

  it("keeps completeSignIn stable while the initial refresh resolves", async () => {
    render(
      <AuthProvider>
        <CompleteSignInReferenceConsumer />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("complete-sign-in-loading").textContent).toBe(
        "false",
      ),
    );
    expect(completeSignInReferences).toHaveLength(1);
  });

  it("marks a previously authenticated session as expired when refresh no longer succeeds", async () => {
    mockRefreshSession
      .mockResolvedValueOnce({
        access_token: "data-token",
        expires_at: Math.floor(Date.now() / 1000) + 300,
        user: { id: "u1", email: "test@example.com", user_metadata: {} },
      })
      .mockResolvedValueOnce(null);
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("test@example.com"),
    );

    screen.getByRole("button", { name: "Refresh session" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("none");
      expect(screen.getByTestId("session-expired").textContent).toBe("true");
    });
  });

  it("keeps an existing session when refresh fails because identity service is unavailable", async () => {
    const session = {
      access_token: "data-token",
      expires_at: Math.floor(Date.now() / 1000) + 300,
      user: { id: "u1", email: "test@example.com", user_metadata: {} },
    };
    mockRefreshSession
      .mockResolvedValueOnce(session)
      .mockRejectedValueOnce(
        new MockSsoSessionRefreshError("service_unavailable", "req_123"),
      );
    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("user").textContent).toBe("test@example.com"),
    );

    screen.getByRole("button", { name: "Refresh session" }).click();

    await waitFor(() => {
      expect(screen.getByTestId("user").textContent).toBe("test@example.com");
      expect(screen.getByTestId("session-expired").textContent).toBe("false");
      expect(screen.getByTestId("service-error").textContent).toBe("req_123");
    });
  });
});
