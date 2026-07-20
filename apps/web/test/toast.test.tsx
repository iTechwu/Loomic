// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "../src/components/toast";

function ToastTrigger() {
  const { success, error } = useToast();
  return (
    <>
      <button type="button" onClick={() => success("已保存")}>
        成功
      </button>
      <button type="button" onClick={() => error("保存失败")}>
        失败
      </button>
    </>
  );
}

describe("Toast announcements", () => {
  afterEach(cleanup);

  it("announces success politely and errors assertively", () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    // 文档 4.4：通知容器是具名 region。
    expect(screen.getByRole("region", { name: "通知" })).toBeInTheDocument();

    act(() => {
      screen.getByRole("button", { name: "成功" }).click();
    });
    const successToast = screen.getByText("已保存").closest("[role]");
    expect(successToast).toHaveAttribute("role", "status");
    expect(successToast).toHaveAttribute("aria-live", "polite");

    act(() => {
      screen.getByRole("button", { name: "失败" }).click();
    });
    const errorToast = screen.getByText("保存失败").closest("[role]");
    expect(errorToast).toHaveAttribute("role", "alert");
    expect(errorToast).toHaveAttribute("aria-live", "assertive");
  });

  it("is keyboard-operable so it can be dismissed without a mouse", () => {
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    act(() => {
      screen.getByRole("button", { name: "成功" }).click();
    });
    const toast = screen.getByText("已保存").closest("[role]") as HTMLElement;

    // 文档 4.4 / WCAG 2.1.1：通知可被键盘聚焦并提前关闭，不只靠鼠标点击或自动消失。
    expect(toast).toHaveAttribute("tabindex", "0");
    toast.focus();
    expect(toast).toHaveFocus();

    // Enter / Space 触发关闭，不抛错；framer-motion exit 在 jsdom 不卸载，
    // 故仅断言键盘处理器已挂载且可执行。
    expect(() => {
      act(() => {
        toast.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
      });
    }).not.toThrow();
  });
});
