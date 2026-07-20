// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type TestSession = {
  tenant_context?: {
    tenant: { id: string; name: string; slug: string };
    teams: Array<{ id: string; name: string; role: string }>;
  };
};

const { authState } = vi.hoisted(() => ({
  authState: {
    session: {
      tenant_context: {
        tenant: { id: "tenant-1", name: "优惠帮", slug: "youhuibang" },
        teams: [{ id: "team-1", name: "全体", role: "member" }],
      },
    } as TestSession | null,
  },
}));
vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => authState,
}));

import { TenantTeamNav } from "../src/components/tenant-team-nav";

describe("TenantTeamNav", () => {
  beforeEach(() => {
    authState.session = {
      tenant_context: {
        tenant: { id: "tenant-1", name: "优惠帮", slug: "youhuibang" },
        teams: [{ id: "team-1", name: "全体", role: "member" }],
      },
    };
  });

  afterEach(cleanup);

  it("opens a semantic team menu without a client render exception", async () => {
    const user = userEvent.setup();
    render(<TenantTeamNav />);

    await user.click(
      screen.getByRole("button", { name: "查看当前租户和团队" }),
    );

    expect(await screen.findByRole("menuitem", { name: /全体/ })).toBeVisible();
  });

  it("identifies a personal workspace when SSO omits tenant context", () => {
    authState.session = null;
    render(<TenantTeamNav />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("个人工作区");
    expect(status).toHaveAttribute(
      "title",
      "SSO 未提供租户与团队信息，当前仅显示个人工作区。",
    );
  });
});
