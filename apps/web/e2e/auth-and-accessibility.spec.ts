import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("public landing and recoverable callback meet the visual and axe gates", async ({
  page,
}, testInfo) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page).toHaveTitle("lovart.dofe");
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: "让创意，自由生长" })).toBeVisible();
  await expect(page.getByText("Where Ideas Become Reality")).toBeVisible();
  await expect(page).toHaveScreenshot(`landing-${testInfo.project.name}.png`, {
    fullPage: false,
  });

  const landingAxe = await new AxeBuilder({ page }).analyze();
  expect(landingAxe.violations).toEqual([]);

  await page.goto("/auth/callback?error=temporarily_unavailable", {
    waitUntil: "networkidle",
  });
  await expect(page.getByRole("alert")).toContainText(
    "统一身份服务暂时不可用",
  );
  await expect(page).toHaveScreenshot(
    `auth-service-unavailable-${testInfo.project.name}.png`,
    { fullPage: false },
  );

  const callbackAxe = await new AxeBuilder({ page }).analyze();
  expect(callbackAxe.violations).toEqual([]);
});

test("legacy login uses the same-origin OIDC entry before the provider redirect", async ({ page }) => {
  test.skip(
    process.env.E2E_SAME_ORIGIN !== "1",
    "Run this only against a trusted HTTPS environment with Fastify on the same origin.",
  );

  await page.goto("/login", { waitUntil: "networkidle" });
  await expect(page).toHaveURL(/\/oauth\/authorize/);
});

test("credentialed SSO login returns to Lovart", async ({ page }) => {
  test.skip(
    process.env.E2E_SAME_ORIGIN !== "1" ||
      !process.env.E2E_SSO_USERNAME ||
      !process.env.E2E_SSO_PASSWORD ||
      !process.env.E2E_SSO_USERNAME_SELECTOR ||
      !process.env.E2E_SSO_PASSWORD_SELECTOR ||
      !process.env.E2E_SSO_SUBMIT_SELECTOR,
    "Set explicit non-production SSO test-account variables to enable the credentialed flow.",
  );

  await page.goto("/login", { waitUntil: "networkidle" });
  await page.locator(process.env.E2E_SSO_USERNAME_SELECTOR!).fill(
    process.env.E2E_SSO_USERNAME!,
  );
  await page.locator(process.env.E2E_SSO_PASSWORD_SELECTOR!).fill(
    process.env.E2E_SSO_PASSWORD!,
  );
  await page.locator(process.env.E2E_SSO_SUBMIT_SELECTOR!).click();

  await expect(page).toHaveURL(/\/home(?:[?#]|$)/, { timeout: 30_000 });
  await expect(page.locator("main")).toBeVisible();
});
