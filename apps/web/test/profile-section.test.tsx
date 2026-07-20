// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileSection } from "../src/components/profile-section";

describe("ProfileSection", () => {
  afterEach(cleanup);

  it("delegates account security to the explicitly configured SSO account centre", () => {
    render(
      <ProfileSection
        accountUrl="https://sso.ixicai.cn/settings/security"
        displayName="Maker"
        email="maker@example.test"
        onSave={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", {
      name: "Manage account and security in DoFe SSO",
    });
    expect(link).toHaveAttribute(
      "href",
      "https://sso.ixicai.cn/settings/security",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("does not render an account link without an explicit SSO URL", () => {
    render(
      <ProfileSection
        accountUrl={null}
        displayName="Maker"
        email="maker@example.test"
        onSave={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole("link", {
        name: "Manage account and security in DoFe SSO",
      }),
    ).not.toBeInTheDocument();
  });
});
