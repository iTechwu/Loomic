// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SsoEntryLink } from "../src/components/auth/sso-entry-link";

describe("SsoEntryLink", () => {
  afterEach(cleanup);
  beforeEach(() => sessionStorage.clear());

  it("keeps the same-tab retry destination before following a native SSO link", () => {
    render(
      <SsoEntryLink
        returnTo="/pricing"
        onClick={(event) => event.preventDefault()}
      >
        使用 DoFe 账户继续
      </SsoEntryLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "使用 DoFe 账户继续" }));

    expect(sessionStorage.getItem("lovart.dofe:sso-return-to")).toBe(
      "/pricing",
    );
  });

  it("does not emit an auth transition when an application handler cancels the link", () => {
    const sendBeacon = vi.fn<(url: string, data: Blob) => boolean>(() => true);
    Object.defineProperty(navigator, "sendBeacon", {
      configurable: true,
      value: sendBeacon,
    });
    render(
      <SsoEntryLink
        returnTo="/pricing"
        onClick={(event) => event.preventDefault()}
      >
        使用 DoFe 账户继续
      </SsoEntryLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "使用 DoFe 账户继续" }));

    expect(sessionStorage.getItem("lovart.dofe:sso-return-to")).toBe(
      "/pricing",
    );
    expect(sendBeacon).not.toHaveBeenCalled();
  });

  it("does not overwrite the current tab's retry destination for a new-tab click", () => {
    sessionStorage.setItem("lovart.dofe:sso-return-to", "/home");
    render(
      <SsoEntryLink
        returnTo="/pricing"
        onClick={(event) => event.preventDefault()}
      >
        使用 DoFe 账户继续
      </SsoEntryLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "使用 DoFe 账户继续" }), {
      ctrlKey: true,
    });

    expect(sessionStorage.getItem("lovart.dofe:sso-return-to")).toBe("/home");
  });
});
