import { afterEach, describe, expect, it, vi } from "vitest";

import { getServerBaseUrl, loadWebEnv } from "../src/lib/env";

describe("@lovart.dofe/web env helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("loads the explicit server base url without browser database credentials", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:4010");
    const env = loadWebEnv();

    expect(env).toEqual({
      serverBaseUrl: "http://localhost:4010",
    });
  });

  it("keeps getServerBaseUrl compatible with the default fallback", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "");

    expect(getServerBaseUrl()).toBe("http://localhost:3105");
  });

  it("reads getServerBaseUrl from process env when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "http://localhost:4020");

    expect(getServerBaseUrl()).toBe("http://localhost:4020");
  });

  it("normalizes legacy API URLs before API paths are appended", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "https://design.ixicai.cn/api/");

    expect(getServerBaseUrl()).toBe("https://design.ixicai.cn");
  });

  it("uses the deployed browser origin when no build-time API URL is set", () => {
    vi.stubEnv("NEXT_PUBLIC_SERVER_BASE_URL", "");
    vi.stubGlobal("window", {
      location: new URL("https://design.ixicai.cn/home"),
    });

    expect(getServerBaseUrl()).toBe("https://design.ixicai.cn");
  });
});
