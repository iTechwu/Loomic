// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefreshSession, mockSignOut } = vi.hoisted(() => ({
  mockRefreshSession: vi.fn(),
  mockSignOut: vi.fn(),
}));

vi.mock("../src/lib/sso-auth", () => ({
  refreshSsoSession: mockRefreshSession,
  signOutFromSso: mockSignOut,
}));

import { AuthProvider, useAuth } from "../src/lib/auth-context";

function TestConsumer() {
  const { user, loading } = useAuth();
  return <><span data-testid="loading">{String(loading)}</span><span data-testid="user">{user?.email ?? "none"}</span></>;
}

describe("AuthProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRefreshSession.mockResolvedValue(null);
  });

  afterEach(cleanup);

  it("resolves an absent SSO session", async () => {
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("loading").textContent).toBe("false"));
    expect(screen.getByTestId("user").textContent).toBe("none");
  });

  it("restores the data session from the HttpOnly SSO refresh cookie", async () => {
    mockRefreshSession.mockResolvedValue({
      access_token: "data-token",
      expires_at: Math.floor(Date.now() / 1000) + 300,
      user: { id: "u1", email: "test@example.com", user_metadata: {} },
    });
    render(<AuthProvider><TestConsumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId("user").textContent).toBe("test@example.com"));
  });
});
