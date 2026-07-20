// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockRefreshSession, mockReplaceWithSsoLogin } = vi.hoisted(() => ({
  mockRefreshSession: vi.fn(),
  mockReplaceWithSsoLogin: vi.fn(),
}));

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({
    loading: false,
    refreshSession: mockRefreshSession,
    serviceError: { requestId: "req_123" },
    sessionExpired: false,
    user: null,
  }),
}));
vi.mock("../src/lib/sso-auth", () => ({
  getBrowserReturnTo: vi.fn(() => "/projects"),
  replaceWithSsoLogin: mockReplaceWithSsoLogin,
}));
vi.mock("../src/components/app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("../src/components/loading-screen", () => ({ LoadingScreen: () => null }));
vi.mock("../src/components/page-transition", () => ({
  PageTransition: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("../src/components/tenant-team-nav", () => ({ TenantTeamNav: () => null }));

import WorkspaceLayout from "../src/app/(workspace)/layout";

describe("WorkspaceLayout", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows a recoverable SSO outage state instead of redirecting anonymously", () => {
    render(
      <WorkspaceLayout>
        <p>Protected workspace</p>
      </WorkspaceLayout>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("统一身份服务暂时不可用");
    expect(screen.getByRole("alert")).toHaveTextContent("支持编号：req_123");
    expect(screen.queryByText("Protected workspace")).not.toBeInTheDocument();
    expect(mockReplaceWithSsoLogin).not.toHaveBeenCalled();
  });
});
