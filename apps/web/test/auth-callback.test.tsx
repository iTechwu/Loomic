// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockReplace = vi.fn();
let currentSearchParams = new URLSearchParams();
const {
  mockBeginSsoLogin,
  mockClearPendingSsoReturnTo,
  mockCompleteSignIn,
  mockExchangeSsoCode,
  MockSsoExchangeError,
} = vi.hoisted(() => ({
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
const {
  mockClearFlow,
  mockGetOrCreateFlow,
  mockIsTerminalState,
  mockReportTelemetry,
} = vi.hoisted(() => ({
  mockClearFlow: vi.fn(),
  mockGetOrCreateFlow: vi.fn(() => ({
    entryPoint: "workspace",
    flowId: "flow_12345678",
    startedAt: 0,
  })),
  mockIsTerminalState: vi.fn((state: string) => state !== "checking"),
  mockReportTelemetry: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({ replace: mockReplace })),
  useSearchParams: vi.fn(() => ({
    get: (key: string) => currentSearchParams.get(key),
  })),
}));
vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({ completeSignIn: mockCompleteSignIn }),
}));
vi.mock("../src/lib/sso-auth", () => ({
  beginSsoLogin: mockBeginSsoLogin,
  clearPendingSsoReturnTo: mockClearPendingSsoReturnTo,
  exchangeSsoCode: mockExchangeSsoCode,
  getPendingSsoReturnTo: () => "/projects?filter=mine#recent",
  SsoExchangeError: MockSsoExchangeError,
}));
vi.mock("../src/lib/server-api", () => ({ fetchViewer: mockFetchViewer }));
vi.mock("../src/lib/auth-transfer-telemetry", () => ({
  clearAuthTransferFlow: mockClearFlow,
  getOrCreateAuthTransferFlow: mockGetOrCreateFlow,
  isTerminalAuthTransferState: mockIsTerminalState,
  reportAuthTransferEvent: mockReportTelemetry,
}));

import CallbackPage from "../src/app/auth/callback/page";

describe("Auth callback page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentSearchParams = new URLSearchParams();
  });
  afterEach(cleanup);

  it("exchanges an OIDC code and establishes the app session", async () => {
    currentSearchParams = new URLSearchParams(
      "code=authorization-code&state=csrf-state",
    );
    const session = {
      access_token: "data-token",
      expires_at: 123,
      user: { id: "u1", email: "a@b.com", user_metadata: {} },
    };
    mockExchangeSsoCode.mockResolvedValue({ returnTo: "/home", session });
    mockFetchViewer.mockResolvedValue({});
    render(<CallbackPage />);
    await waitFor(() => {
      expect(mockExchangeSsoCode).toHaveBeenCalledWith(
        "authorization-code",
        "csrf-state",
      );
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
    expect(mockBeginSsoLogin).toHaveBeenCalledWith(
      "/projects?filter=mine#recent",
      "callback",
    );
  });

  it("shows the safe server request ID when the token exchange fails", async () => {
    currentSearchParams = new URLSearchParams(
      "code=authorization-code&state=csrf-state",
    );
    const error = new MockSsoExchangeError("authentication_failed", "req_123");
    mockExchangeSsoCode.mockRejectedValue(error);
    render(<CallbackPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "支持编号：req_123",
    );
  });

  it("keeps an invalid PKCE transaction in the specific callback error state", async () => {
    currentSearchParams = new URLSearchParams(
      "code=authorization-code&state=csrf-state",
    );
    mockExchangeSsoCode.mockRejectedValue(
      new MockSsoExchangeError("invalid_callback", "req_456"),
    );
    render(<CallbackPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("登录信息不完整或已失效");
    expect(alert).toHaveTextContent("支持编号：req_456");
  });

  it("maps a temporarily unavailable provider response to a recoverable service error", async () => {
    currentSearchParams = new URLSearchParams("error=temporarily_unavailable");
    render(<CallbackPage />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "统一身份服务暂时不可用",
    );
    expect(mockReportTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        entryPoint: "workspace",
        state: "service_unavailable",
      }),
    );
  });

  it("retries workspace bootstrap without starting a second SSO authorization flow", async () => {
    currentSearchParams = new URLSearchParams(
      "code=authorization-code&state=csrf-state",
    );
    const session = {
      access_token: "data-token",
      expires_at: 123,
      user: { id: "u1", email: "a@b.com", user_metadata: {} },
    };
    mockExchangeSsoCode.mockResolvedValue({ returnTo: "/projects", session });
    mockFetchViewer.mockRejectedValueOnce(new Error("viewer unavailable"));
    mockFetchViewer.mockResolvedValueOnce({});

    render(<CallbackPage />);
    const retry = await screen.findByRole("button", { name: "重试打开工作区" });
    fireEvent.click(retry);

    await waitFor(() => {
      expect(mockFetchViewer).toHaveBeenCalledTimes(2);
      expect(mockExchangeSsoCode).toHaveBeenCalledTimes(1);
      expect(mockBeginSsoLogin).not.toHaveBeenCalled();
      expect(mockCompleteSignIn).toHaveBeenCalledWith(session);
      expect(mockReplace).toHaveBeenCalledWith("/projects");
    });
  });
});
