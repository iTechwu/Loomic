// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SsoEntryLink } from "../src/components/auth/sso-entry-link";

describe("SsoEntryLink", () => {
  afterEach(cleanup);

  it("keeps the same-tab retry destination before following a native SSO link", () => {
    render(
      <SsoEntryLink returnTo="/pricing" onClick={(event) => event.preventDefault()}>
        使用 DoFe 账户继续
      </SsoEntryLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "使用 DoFe 账户继续" }));

    expect(sessionStorage.getItem("lovart.dofe:sso-return-to")).toBe("/pricing");
  });

  it("does not overwrite the current tab's retry destination for a new-tab click", () => {
    sessionStorage.setItem("lovart.dofe:sso-return-to", "/home");
    render(
      <SsoEntryLink returnTo="/pricing" onClick={(event) => event.preventDefault()}>
        使用 DoFe 账户继续
      </SsoEntryLink>,
    );

    fireEvent.click(screen.getByRole("link", { name: "使用 DoFe 账户继续" }), {
      ctrlKey: true,
    });

    expect(sessionStorage.getItem("lovart.dofe:sso-return-to")).toBe("/home");
  });
});
