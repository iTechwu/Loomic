import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("public landing and recoverable callback meet the visual and axe gates", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("lovart.dofe");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.locator("h1")).toHaveText("让创意，自由生长", {
    timeout: 10_000,
  });
  await expect(page.getByText("Where Ideas Become Reality")).toBeVisible();
  await expect(page.getByTestId("landing-hero-copy")).toHaveScreenshot(
    `landing-${testInfo.project.name}.png`,
  );

  const landingAxe = await new AxeBuilder({ page }).analyze();
  expect(landingAxe.violations).toEqual([]);

  await page.goto("/auth/callback?error=temporarily_unavailable", {
    waitUntil: "networkidle",
  });
  const callbackError = page.getByRole("alert", {
    name: "无法完成 DoFe 账户授权",
  });
  await expect(callbackError).toContainText("统一身份服务暂时不可用");
  await expect(callbackError).toHaveScreenshot(
    `auth-service-unavailable-${testInfo.project.name}.png`,
  );

  const callbackAxe = await new AxeBuilder({ page }).analyze();
  expect(callbackAxe.violations).toEqual([]);
});

test("landing supports keyboard skip navigation and reduced-motion dark mode", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-1440",
    "Dark/reduced-motion snapshot is intentionally kept to one stable desktop baseline.",
  );

  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "跳到主内容" });
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#landing-main")).toBeFocused();
  await expect(page.getByTestId("landing-hero-copy")).toHaveScreenshot(
    "landing-dark-reduced-motion.png",
  );

  const axe = await new AxeBuilder({ page }).analyze();
  expect(axe.violations).toEqual([]);
});

test("legacy login uses the same-origin OIDC entry before the provider redirect", async ({
  page,
}) => {
  test.skip(
    process.env.E2E_SAME_ORIGIN !== "1",
    "Run this only against a trusted HTTPS environment with Fastify on the same origin.",
  );

  await page.goto("/login", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/oauth\/authorize/);
});

test("credentialed SSO restores a deep link, refreshes after reload, and re-authenticates after global logout", async ({
  page,
}) => {
  const username = process.env.E2E_SSO_USERNAME;
  const password = process.env.E2E_SSO_PASSWORD;
  const usernameSelector = process.env.E2E_SSO_USERNAME_SELECTOR;
  const passwordSelector = process.env.E2E_SSO_PASSWORD_SELECTOR;
  const submitSelector = process.env.E2E_SSO_SUBMIT_SELECTOR;

  test.skip(
    process.env.E2E_SAME_ORIGIN !== "1" ||
      !username ||
      !password ||
      !usernameSelector ||
      !passwordSelector ||
      !submitSelector,
    "Set explicit non-production SSO test-account variables to enable the credentialed flow.",
  );

  if (
    !username ||
    !password ||
    !usernameSelector ||
    !passwordSelector ||
    !submitSelector
  ) {
    throw new Error(
      "Credentialed SSO E2E requires all explicit test-account variables.",
    );
  }

  await page.goto(
    "/api/auth/oidc/start?returnTo=%2Fprojects%3Ffilter%3Dmine%23recent",
    { waitUntil: "networkidle" },
  );
  const usernameField = page.locator(usernameSelector);
  if (await usernameField.isVisible().catch(() => false)) {
    await usernameField.fill(username);
    await page.locator(passwordSelector).fill(password);
    await page.locator(submitSelector).click();
  }

  await expect(page).toHaveURL(/\/projects\?filter=mine#recent$/, {
    timeout: 30_000,
  });
  await expect(page.locator("main")).toBeVisible();

  // A full reload discards the in-memory token. The workspace must therefore
  // restore solely through the HttpOnly refresh cookie, without re-showing SSO.
  await page.reload({ waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/projects\?filter=mine#recent$/, {
    timeout: 30_000,
  });
  await expect(page.locator("main")).toBeVisible();

  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/?\?signed_out=1$/, { timeout: 30_000 });

  // A global logout must not leave a stale Lovart session that can reopen the
  // original workspace URL. The next protected navigation begins OIDC again.
  await page.goto("/projects?filter=mine#recent", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/oauth\/authorize/, { timeout: 30_000 });
});
