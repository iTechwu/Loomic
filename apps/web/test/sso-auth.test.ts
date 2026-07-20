// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import {
  buildSsoStartHref,
  clearPendingSsoReturnTo,
  getPendingSsoReturnTo,
  getCurrentReturnTo,
  isSafeReturnTo,
} from "../src/lib/sso-auth";

describe("SSO navigation helpers", () => {
  it("builds a same-origin authorization start URL", () => {
    expect(buildSsoStartHref("/projects?view=grid#recent")).toBe(
      "/api/auth/oidc/start?returnTo=%2Fprojects%3Fview%3Dgrid%23recent",
    );
  });

  it("falls back to home for an unsafe return path", () => {
    expect(buildSsoStartHref("//attacker.example")).toBe(
      "/api/auth/oidc/start?returnTo=%2Fhome",
    );
    expect(isSafeReturnTo("/\\attacker.example")).toBe(false);
  });

  it("preserves a protected route pathname, search, and hash", () => {
    expect(getCurrentReturnTo("/projects", "?filter=mine", "#recent")).toBe(
      "/projects?filter=mine#recent",
    );
  });

  it("retains a same-tab destination for a recoverable retry", () => {
    sessionStorage.setItem(
      "lovart.dofe:sso-return-to",
      "/projects?filter=mine#recent",
    );
    expect(getPendingSsoReturnTo()).toBe("/projects?filter=mine#recent");
    clearPendingSsoReturnTo();
    expect(getPendingSsoReturnTo()).toBe("/home");
  });
});
