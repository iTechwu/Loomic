// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();
const { mockBeginSsoLogin, mockClearPendingSsoReturnTo, mockCompleteSignIn, mockExchangeSsoCode, MockSsoExchangeError } = vi.hoisted(() => ({
  mockBeginSsoLogin: vi.fn(),
  mockClearPendingSsoReturnTo: vi.fn(),
  mockCompleteSignIn: vi.fn(),
  mockExchangeSsoCode: vi.fn(),
  MockSsoExchangeError: class extends Error {
    requestId: string | undefined;

    constructor(message: string, requestId?: string) {
      super(message);
      this.requestId = requestId;
    }
  },
}));
const { mockFetchViewer } = vi.hoisted(() => ({ mockFetchViewer: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  useSearchParams: vi.fn(() => ({ get: (key: string) => currentSearchParams.get(key) })),
}));
vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ completeSignIn: mockCompleteSignIn }) }));
vi.mock("../src/lib/sso-auth", () => ({
  beginSsoLogin: mockBeginSsoLogin,
  clearPendingSsoReturnTo: mockClearPendingSsoReturnTo,
  exchangeSsoCode: mockExchangeSsoCode,
  getPendingSsoReturnTo: () => "/projects?filter=mine#recent",
  SsoExchangeError: MockSsoExchangeError,
}));
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

  it("keeps callbacks without a PKCE state in the accessible transfer error state", async () => {
    currentSearchParams = new URLSearchParams("code=authorization-code");
    render(<CallbackPage />);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "登录信息不完整或已失效",
    );
    fireEvent.click(screen.getByRole("button", { name: "重新开始" }));
    expect(mockBeginSsoLogin).toHaveBeenCalledWith("/projects?filter=mine#recent");
  });

  it("shows the safe server request ID when the token exchange fails", async () => {
    currentSearchParams = new URLSearchParams("code=authorization-code&state=csrf-state");
    const error = new MockSsoExchangeError("authentication_failed", "req_123");
    mockExchangeSsoCode.mockRejectedValue(error);
    render(<CallbackPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent("支持编号：req_123");
  });
});
