// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("framer-motion", () => ({
  MotionConfig: ({ children, reducedMotion }: { children: React.ReactNode; reducedMotion: string }) => (
    <div data-reduced-motion={reducedMotion}>{children}</div>
  ),
}));
vi.mock("next-themes", () => ({ ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../src/lib/auth-context", () => ({ AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../src/components/toast", () => ({ ToastProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

import { Providers } from "../src/components/providers";

describe("Providers", () => {
  it("passes the user reduced-motion preference to Framer Motion", () => {
    render(<Providers><span>workspace</span></Providers>);
    expect(screen.getByText("workspace").parentElement).toHaveAttribute(
      "data-reduced-motion",
      "user",
    );
  });
});
