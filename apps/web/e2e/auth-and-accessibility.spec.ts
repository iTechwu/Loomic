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

test("credentialed SSO login returns to Lovart", async ({ page }) => {
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

  await page.goto("/login", { waitUntil: "networkidle" });
  await page.locator(usernameSelector).fill(username);
  await page.locator(passwordSelector).fill(password);
  await page.locator(submitSelector).click();

  await expect(page).toHaveURL(/\/home(?:[?#]|$)/, { timeout: 30_000 });
  await expect(page.locator("main")).toBeVisible();
});
