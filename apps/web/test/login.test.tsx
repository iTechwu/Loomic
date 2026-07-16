// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockBeginSsoLogin } = vi.hoisted(() => ({ mockBeginSsoLogin: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }), useSearchParams: () => new URLSearchParams("redirect=%2Fpricing") }));
vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("../src/lib/sso-auth", () => ({ beginSsoLogin: mockBeginSsoLogin }));

import LoginPage from "../src/app/login/page";

describe("Login page", () => {
  afterEach(cleanup);

  it("starts the centralized SSO flow and preserves the return path", async () => {
    render(<LoginPage />);
    await waitFor(() => expect(mockBeginSsoLogin).toHaveBeenCalledWith("/pricing"));
  });
});
