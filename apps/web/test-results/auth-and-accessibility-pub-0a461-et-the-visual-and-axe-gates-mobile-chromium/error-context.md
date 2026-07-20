# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-and-accessibility.spec.ts >> public landing and recoverable callback meet the visual and axe gates
- Location: e2e/auth-and-accessibility.spec.ts:4:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('heading', { name: '让创意，自由生长' })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('heading', { name: '让创意，自由生长' })

```

```yaml
- link "跳到主内容":
  - /url: "#landing-main"
- banner:
  - link "lovart.dofe":
    - /url: /
  - button "Toggle menu"
- main:
  - text: AI-Powered Creative Design
  - heading [level=1]
  - paragraph: Where Ideas Become Reality
  - paragraph: 从灵感到作品，lovart.dofe 是你的 AI 设计伙伴。智能理解你的创意意图，生成专业级设计，让每一个想法都能成为现实。
  - link "开始创作":
    - /url: /api/auth/oidc/start?returnTo=%2Fhome
  - link "查看案例":
    - /url: "#showcase"
  - text: lovart.dofe Canvas AI
  - img "lovart.dofe Canvas AI creative workspace"
  - text: 0+ 创作者 0+ 设计作品 0+ AI 模型 0% 服务可用性
- region "通知"
```

# Test source

```ts
  1  | import AxeBuilder from "@axe-core/playwright";
  2  | import { expect, test } from "@playwright/test";
  3  | 
  4  | test("public landing and recoverable callback meet the visual and axe gates", async ({
  5  |   page,
  6  | }, testInfo) => {
  7  |   await page.goto("/", { waitUntil: "networkidle" });
  8  |   await expect(page).toHaveTitle("lovart.dofe");
  9  |   await expect(page.locator("main")).toBeVisible();
> 10 |   await expect(page.getByRole("heading", { name: "让创意，自由生长" })).toBeVisible();
     |                                                                 ^ Error: expect(locator).toBeVisible() failed
  11 |   await expect(page.getByText("Where Ideas Become Reality")).toBeVisible();
  12 |   await expect(page).toHaveScreenshot(`landing-${testInfo.project.name}.png`, {
  13 |     fullPage: false,
  14 |   });
  15 | 
  16 |   const landingAxe = await new AxeBuilder({ page }).analyze();
  17 |   expect(landingAxe.violations).toEqual([]);
  18 | 
  19 |   await page.goto("/auth/callback?error=temporarily_unavailable", {
  20 |     waitUntil: "networkidle",
  21 |   });
  22 |   await expect(page.getByRole("alert")).toContainText(
  23 |     "统一身份服务暂时不可用",
  24 |   );
  25 |   await expect(page).toHaveScreenshot(
  26 |     `auth-service-unavailable-${testInfo.project.name}.png`,
  27 |     { fullPage: false },
  28 |   );
  29 | 
  30 |   const callbackAxe = await new AxeBuilder({ page }).analyze();
  31 |   expect(callbackAxe.violations).toEqual([]);
  32 | });
  33 | 
  34 | test("legacy login uses the same-origin OIDC entry before the provider redirect", async ({ page }) => {
  35 |   test.skip(
  36 |     process.env.E2E_SAME_ORIGIN !== "1",
  37 |     "Run this only against a trusted HTTPS environment with Fastify on the same origin.",
  38 |   );
  39 | 
  40 |   await page.goto("/login", { waitUntil: "networkidle" });
  41 |   await expect(page).toHaveURL(/\/oauth\/authorize/);
  42 | });
  43 | 
  44 | test("credentialed SSO login returns to Lovart", async ({ page }) => {
  45 |   test.skip(
  46 |     process.env.E2E_SAME_ORIGIN !== "1" ||
  47 |       !process.env.E2E_SSO_USERNAME ||
  48 |       !process.env.E2E_SSO_PASSWORD ||
  49 |       !process.env.E2E_SSO_USERNAME_SELECTOR ||
  50 |       !process.env.E2E_SSO_PASSWORD_SELECTOR ||
  51 |       !process.env.E2E_SSO_SUBMIT_SELECTOR,
  52 |     "Set explicit non-production SSO test-account variables to enable the credentialed flow.",
  53 |   );
  54 | 
  55 |   await page.goto("/login", { waitUntil: "networkidle" });
  56 |   await page.locator(process.env.E2E_SSO_USERNAME_SELECTOR!).fill(
  57 |     process.env.E2E_SSO_USERNAME!,
  58 |   );
  59 |   await page.locator(process.env.E2E_SSO_PASSWORD_SELECTOR!).fill(
  60 |     process.env.E2E_SSO_PASSWORD!,
  61 |   );
  62 |   await page.locator(process.env.E2E_SSO_SUBMIT_SELECTOR!).click();
  63 | 
  64 |   await expect(page).toHaveURL(/\/home(?:[?#]|$)/, { timeout: 30_000 });
  65 |   await expect(page.locator("main")).toBeVisible();
  66 | });
  67 | 
```