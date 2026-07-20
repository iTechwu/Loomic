// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildSsoStartHref,
  clearPendingSsoReturnTo,
  getBrowserSsoUiLocale,
  getCurrentReturnTo,
  getPendingSsoReturnTo,
  getSsoAccountUrl,
  getSafeSsoLogoutUrl,
  isSafeReturnTo,
  rememberSsoReturnTo,
  refreshSsoSession,
  selectSsoUiLocale,
  SsoSessionRefreshError,
} from "../src/lib/sso-auth";

afterEach(() => vi.unstubAllGlobals());

describe("SSO navigation helpers", () => {
  it("builds a same-origin authorization start URL", () => {
    expect(buildSsoStartHref("/projects?view=grid#recent")).toBe(
      "/api/auth/oidc/start?returnTo=%2Fprojects%3Fview%3Dgrid%23recent",
    );
  });

  it("only adds the SSO allowlisted UI locale when explicitly provided", () => {
    expect(buildSsoStartHref("/projects", "en")).toBe(
      "/api/auth/oidc/start?returnTo=%2Fprojects&uiLocale=en",
    );
    expect(getBrowserSsoUiLocale()).toMatch(/^(zh-CN|en)$/);
  });

  it("keeps the browser's first supported locale preference", () => {
    expect(selectSsoUiLocale(["zh-CN", "en-US"])).toBe("zh-CN");
    expect(selectSsoUiLocale(["fr", "en-US", "zh-CN"])).toBe("en");
  });

  it("accepts only an explicit, credential-free HTTP(S) SSO account URL", () => {
    expect(getSsoAccountUrl("https://sso.ixicai.cn/settings/security")).toBe(
      "https://sso.ixicai.cn/settings/security",
    );
    expect(getSsoAccountUrl("javascript:alert(1)")).toBeNull();
    expect(
      getSsoAccountUrl("https://user:pass@sso.ixicai.cn/settings"),
    ).toBeNull();
  });

  it("accepts only the RP-bound global SSO logout URL", () => {
    const origin = "https://lovart.example.test";
    expect(
      getSafeSsoLogoutUrl(
        "https://sso.example.test/api/oauth/logout?id_token_hint=hint&post_logout_redirect_uri=https%3A%2F%2Flovart.example.test%2F%3Fsigned_out%3D1",
        origin,
      ),
    ).toContain("https://sso.example.test/api/oauth/logout");
    expect(
      getSafeSsoLogoutUrl(
        "https://attacker.example/oauth/logout?post_logout_redirect_uri=https%3A%2F%2Fattacker.example%2F",
        origin,
      ),
    ).toBeNull();
    expect(
      getSafeSsoLogoutUrl(
        "https://sso.example.test/api/not-logout?post_logout_redirect_uri=https%3A%2F%2Flovart.example.test%2F%3Fsigned_out%3D1",
        origin,
      ),
    ).toBeNull();
  });

  it("falls back to home for an unsafe return path", () => {
    expect(buildSsoStartHref("//attacker.example")).toBe(
      "/api/auth/oidc/start?returnTo=%2Fhome",
    );
    expect(isSafeReturnTo("/\\attacker.example")).toBe(false);
    expect(isSafeReturnTo(`/${"a".repeat(2_048)}`)).toBe(false);
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

  it("records a validated public SSO entry destination for cancellation retry", () => {
    expect(rememberSsoReturnTo("/pricing")).toBe("/pricing");
    expect(getPendingSsoReturnTo()).toBe("/pricing");
    expect(rememberSsoReturnTo("//attacker.example")).toBe("/home");
    expect(getPendingSsoReturnTo()).toBe("/home");
  });

  it("does not treat an unavailable refresh endpoint as an anonymous session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ error: "sso_not_configured", requestId: "req_123" }),
          { status: 503 },
        ),
      ),
    );

    await expect(refreshSsoSession()).rejects.toMatchObject({
      name: SsoSessionRefreshError.name,
      message: "service_unavailable",
      requestId: "req_123",
    });
  });
});
