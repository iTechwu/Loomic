// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("framer-motion", () => ({
  MotionConfig: ({
    children,
    reducedMotion,
  }: { children: React.ReactNode; reducedMotion: string }) => (
    <div data-reduced-motion={reducedMotion}>{children}</div>
  ),
}));
vi.mock("next-themes", () => ({
  ThemeProvider: ({
    children,
    defaultTheme,
    disableTransitionOnChange,
    enableSystem,
  }: {
    children: React.ReactNode;
    defaultTheme: string;
    disableTransitionOnChange: boolean;
    enableSystem: boolean;
  }) => (
    <div
      data-default-theme={defaultTheme}
      data-disable-transition={disableTransitionOnChange}
      data-enable-system={enableSystem}
    >
      {children}
    </div>
  ),
}));
vi.mock("../src/lib/sso-auth", () => ({
  getBrowserSsoUiLocale: () => "en",
}));
vi.mock("../src/lib/auth-context", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../src/components/toast", () => ({
  ToastProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

import { Providers } from "../src/components/providers";

describe("Providers", () => {
  afterEach(cleanup);

  it("passes the user reduced-motion preference to Framer Motion", () => {
    render(
      <Providers>
        <span>workspace</span>
      </Providers>,
    );
    expect(
      screen.getByText("workspace").parentElement?.parentElement,
    ).toHaveAttribute("data-reduced-motion", "user");
  });

  it("starts from the system theme without transition flashes", () => {
    render(
      <Providers>
        <span>workspace</span>
      </Providers>,
    );
    const themeProvider = screen.getByText("workspace").parentElement;
    expect(themeProvider).toHaveAttribute("data-default-theme", "system");
    expect(themeProvider).toHaveAttribute("data-enable-system", "true");
    expect(themeProvider).toHaveAttribute("data-disable-transition", "true");
  });

  it("synchronizes the document language to the resolved SSO locale", () => {
    document.documentElement.lang = "zh-CN";
    render(
      <Providers>
        <span>workspace</span>
      </Providers>,
    );
    expect(document.documentElement).toHaveAttribute("lang", "en");
  });
});
