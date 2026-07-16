// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { mockBeginSsoLogin } = vi.hoisted(() => ({ mockBeginSsoLogin: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("../src/lib/auth-context", () => ({ useAuth: () => ({ user: null, loading: false }) }));
vi.mock("../src/lib/sso-auth", () => ({ beginSsoLogin: mockBeginSsoLogin }));

import RegisterPage from "../src/app/register/page";

describe("Register page", () => {
  afterEach(cleanup);

  it("delegates account creation to DoFe SSO", () => {
    render(<RegisterPage />);
    fireEvent.click(screen.getByRole("button", { name: /continue with dofe/i }));
    expect(mockBeginSsoLogin).toHaveBeenCalledWith();
  });
});
