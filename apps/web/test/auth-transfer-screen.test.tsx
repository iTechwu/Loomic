// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthTransferScreen } from "../src/components/auth/auth-transfer-screen";

describe("AuthTransferScreen", () => {
  afterEach(cleanup);

  it("moves focus to the loading status title after the SSO callback route opens", () => {
    render(<AuthTransferScreen />);

    const status = screen.getByRole("status");
    const heading = screen.getByRole("heading", { name: "正在验证 DoFe 账户" });
    expect(status).toHaveAttribute("aria-labelledby", "auth-transfer-loading-title");
    expect(heading).toHaveFocus();
  });

  it("moves focus to the recoverable error title", () => {
    render(<AuthTransferScreen error="timeout" onRetry={vi.fn()} />);

    expect(screen.getByRole("heading", { name: "无法完成 DoFe 账户授权" })).toHaveFocus();
  });

  it("stacks error actions vertically with at least 44px touch targets", () => {
    render(<AuthTransferScreen error="cancelled" onRetry={vi.fn()} />);

    // The recoverable-error actions live in an alert region.
    expect(screen.getByRole("alert")).toBeInTheDocument();

    const retry = screen.getByRole("button", { name: "重新开始" });
    const homeLink = screen.getByRole("link", { name: "返回首页" });

    // 文档 4.4：认证异常操作按纵向排列（retry 与 home 在同一个 flex-col 容器内）。
    const actions = retry.parentElement;
    expect(actions?.className).toContain("flex-col");
    expect(actions).toContainElement(homeLink);

    // 文档 4.4：触控目标至少 44px。jsdom 不解析 Tailwind 到像素值，断言高度类作为回归守卫。
    expect(retry.className).toMatch(/(^|\s)h-11(\s|$)/);
    expect(homeLink.className).toMatch(/(^|\s)(min-)?h-11(\s|$)/);
  });
});
