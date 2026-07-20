// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import NotFound from "../src/app/not-found";

describe("NotFound", () => {
  afterEach(cleanup);

  it("renders localized zh-CN copy as an alert region and returns to the public home", () => {
    render(<NotFound />);

    // 文档 4.4 / 契约：错误页是可朗读的 alert 区，且文案为 zh-CN。
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("找不到该页面");
    expect(screen.getByRole("heading", { name: "404" })).toHaveFocus();

    // 404 访客可能未登录，返回公开首页而非受保护的 /home。
    const home = screen.getByRole("link", { name: "返回首页" });
    expect(home).toHaveAttribute("href", "/");
  });
});
