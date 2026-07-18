// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/lib/auth-context", () => ({
  useAuth: () => ({
    session: {
      tenant_context: {
        tenant: { id: "tenant-1", name: "优惠帮" },
        teams: [{ id: "team-1", name: "全体", role: "member" }],
      },
    },
  }),
}));

import { TenantTeamNav } from "../src/components/tenant-team-nav";

describe("TenantTeamNav", () => {
  afterEach(cleanup);

  it("opens a semantic team menu without a client render exception", async () => {
    const user = userEvent.setup();
    render(<TenantTeamNav />);

    await user.click(
      screen.getByRole("button", { name: "查看当前租户和团队" }),
    );

    expect(await screen.findByRole("menuitem", { name: /全体/ })).toBeVisible();
  });
});
