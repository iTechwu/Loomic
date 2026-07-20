// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PricingCTA } from "../src/app/pricing/components/pricing-cta";
import { PricingNav } from "../src/app/pricing/components/pricing-nav";

describe("public SSO entry points", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("uses direct authorization links instead of local login or register pages", () => {
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        disconnect() {}
        observe() {}
        unobserve() {}
      },
    );
    const { rerender } = render(<PricingNav />);
    expect(screen.getByRole("link", { name: "登录" })).toHaveAttribute(
      "href",
      "/api/auth/oidc/start?returnTo=%2Fpricing",
    );
    expect(screen.getByRole("link", { name: "免费开始" })).toHaveAttribute(
      "href",
      "/api/auth/oidc/start?returnTo=%2Fpricing",
    );

    rerender(<PricingCTA />);
    expect(screen.getByRole("link", { name: "免费开始" })).toHaveAttribute(
      "href",
      "/api/auth/oidc/start?returnTo=%2Fpricing",
    );
  });
});
