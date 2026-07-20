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
});
