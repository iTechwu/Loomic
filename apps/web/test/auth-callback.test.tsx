// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();
const { mockCompleteSignIn, mockExchangeSsoCode } = vi.hoisted(() => ({
  mockCompleteSignIn: vi.fn(),
  mockExchangeSsoCode: vi.fn(),
}));
const { mockFetchViewer } = vi.hoisted(() => ({ mockFetchViewer: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  useSearchParams: vi.fn(() => ({ get: (key: string) => currentSearchParams.get(key) })),
}));
vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ completeSignIn: mockCompleteSignIn }) }));
vi.mock("../src/lib/sso-auth", () => ({ exchangeSsoCode: mockExchangeSsoCode }));
vi.mock("../src/lib/server-api", () => ({ fetchViewer: mockFetchViewer }));

import CallbackPage from "../src/app/auth/callback/page";

describe("Auth callback page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
  });
  afterEach(cleanup);

  it("exchanges an OIDC code and establishes the app session", async () => {
    currentSearchParams = new URLSearchParams("code=authorization-code&state=csrf-state");
    const session = { access_token: "data-token", expires_at: 123, user: { id: "u1", email: "a@b.com", user_metadata: {} } };
    mockExchangeSsoCode.mockResolvedValue({ returnTo: "/home", session });
    mockFetchViewer.mockResolvedValue({});
    render(<CallbackPage />);
    await waitFor(() => {
      expect(mockExchangeSsoCode).toHaveBeenCalledWith("authorization-code", "csrf-state");
      expect(mockFetchViewer).toHaveBeenCalledWith("data-token");
      expect(mockCompleteSignIn).toHaveBeenCalledWith(session);
      expect(mockReplace).toHaveBeenCalledWith("/home");
    });
  });

  it("rejects callbacks without a PKCE state", async () => {
    currentSearchParams = new URLSearchParams("code=authorization-code");
    render(<CallbackPage />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login?error=auth_callback_invalid"));
  });
});
