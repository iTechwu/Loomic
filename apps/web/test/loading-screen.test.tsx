// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LoadingScreen } from "../src/components/loading-screen";

describe("LoadingScreen", () => {
  afterEach(cleanup);

  it("announces its loading state to assistive technology", () => {
    render(<LoadingScreen />);

    // 文档 4.4：全屏阻塞加载必须是可播报的 live region。
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveAttribute("aria-atomic", "true");
    expect(status).toHaveTextContent("正在打开 lovart.dofe 工作区");
  });
});
