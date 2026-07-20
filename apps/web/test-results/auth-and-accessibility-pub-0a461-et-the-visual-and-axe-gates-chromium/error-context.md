# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: auth-and-accessibility.spec.ts >> public landing and recoverable callback meet the visual and axe gates
- Location: e2e/auth-and-accessibility.spec.ts:4:1

# Error details

```
Error: A snapshot doesn't exist at /Users/techwu/Documents/codes/dofe.ai/lovart.dofe.ai/apps/web/e2e/auth-and-accessibility.spec.ts-snapshots/landing-chromium-chromium-darwin.png, writing actual.
```

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 58

- Array []
+ Array [
+   Object {
+     "description": "Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds",
+     "help": "Elements must meet minimum color contrast ratio thresholds",
+     "helpUrl": "https://dequeuniversity.com/rules/axe/4.12/color-contrast?application=playwright",
+     "id": "color-contrast",
+     "impact": "serious",
+     "nodes": Array [
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#008a57",
+               "contrastRatio": 4.17,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#f3fbf6",
+               "fontSize": "10.5pt (14px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 4.17 (foreground color: #f3fbf6, background color: #008a57, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<a class=\"hidden md:inline-flex items-center justify-center h-8 px-4 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/80 transition-colors\" href=\"/api/auth/oidc/start?returnTo=%2Fhome\">开始创作</a>",
+                 "target": Array [
+                   ".md\\:inline-flex",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 4.17 (foreground color: #f3fbf6, background color: #008a57, font size: 10.5pt (14px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<a class=\"hidden md:inline-flex items-center justify-center h-8 px-4 rounded-full bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/80 transition-colors\" href=\"/api/auth/oidc/start?returnTo=%2Fhome\">开始创作</a>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           ".md\\:inline-flex",
+         ],
+       },
+     ],
+     "tags": Array [
+       "cat.color",
+       "wcag2aa",
+       "wcag143",
+       "TTv5",
+       "TT13.c",
+       "EN-301-549",
+       "EN-9.1.4.3",
+       "ACT",
+       "RGAAv4",
+       "RGAA-3.2.1",
+     ],
+   },
+ ]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - generic [ref=e2]:
    - link "跳到主内容" [ref=e3] [cursor=pointer]:
      - /url: "#landing-main"
    - banner [ref=e4]:
      - generic [ref=e6]:
        - link "lovart.dofe" [ref=e7] [cursor=pointer]:
          - /url: /
          - img [ref=e8]
          - generic [ref=e13]: lovart.dofe
        - navigation "Main navigation" [ref=e14]:
          - link "功能" [ref=e15] [cursor=pointer]:
            - /url: "#features"
          - link "案例" [ref=e16] [cursor=pointer]:
            - /url: "#showcase"
        - generic [ref=e17]:
          - button "Toggle theme" [ref=e18]:
            - img
          - link "开始创作" [ref=e19] [cursor=pointer]:
            - /url: /api/auth/oidc/start?returnTo=%2Fhome
    - main [ref=e20]:
      - generic [ref=e21]:
        - generic [ref=e22]:
          - generic [ref=e23]:
            - img [ref=e24]
            - generic [ref=e27]: AI-Powered Creative Design
          - heading "让创意，自由生长" [level=1] [ref=e28]:
            - generic [ref=e29]: 让创意，自由生长
          - paragraph [ref=e31]: Where Ideas Become Reality
          - paragraph [ref=e32]: 从灵感到作品，lovart.dofe 是你的 AI 设计伙伴。智能理解你的创意意图，生成专业级设计，让每一个想法都能成为现实。
          - generic [ref=e33]:
            - link "开始创作" [ref=e34] [cursor=pointer]:
              - /url: /api/auth/oidc/start?returnTo=%2Fhome
            - link "查看案例" [ref=e35] [cursor=pointer]:
              - /url: "#showcase"
              - text: 查看案例
              - img [ref=e36]
          - generic [ref=e40]:
            - generic [ref=e46]: lovart.dofe Canvas
            - generic [ref=e47]:
              - generic:
                - img
                - generic: AI
              - img "lovart.dofe Canvas AI creative workspace" [ref=e48]
        - img [ref=e51]
      - generic [ref=e54]:
        - generic [ref=e55]:
          - generic [ref=e57]: 0+
          - generic [ref=e59]: 创作者
        - generic [ref=e61]:
          - generic [ref=e63]: 0+
          - generic [ref=e65]: 设计作品
        - generic [ref=e67]:
          - generic [ref=e69]: 0+
          - generic [ref=e71]: AI 模型
        - generic [ref=e73]:
          - generic [ref=e75]: 0%
          - generic [ref=e77]: 服务可用性
      - generic [ref=e79]:
        - generic [ref=e81]:
          - heading "设计，超越生成" [level=2] [ref=e82]
          - paragraph [ref=e83]: lovart.dofe 不只是生成工具，更是你的智能设计伙伴
        - generic [ref=e84]:
          - generic [ref=e85]:
            - generic [ref=e86]:
              - img [ref=e88]
              - heading "AI Canvas -- 画布级创作" [level=3] [ref=e90]
              - paragraph [ref=e91]: 在无限画布上与 AI 协作。从一个简单的想法开始，AI 帮你构建完整的设计系统——布局、配色、排版，一切所见即所得。
            - img "AI canvas multi-person scene composition" [ref=e99]
          - generic [ref=e102]:
            - img "AI understanding creative intent for fashion styling" [ref=e110]
            - generic [ref=e111]:
              - img [ref=e113]
              - heading "智能对话 -- 理解创意意图" [level=3] [ref=e115]
              - paragraph [ref=e116]: 不是冰冷的指令执行。lovart.dofe 理解你的设计需求，主动提出建议，在对话中迭代出最佳方案。
          - generic [ref=e119]:
            - generic [ref=e120]:
              - img [ref=e122]
              - heading "风格一致 -- 品牌设计系统" [level=3] [ref=e128]
              - paragraph [ref=e129]: 上传你的品牌素材，AI 自动理解品牌调性。无论生成多少作品，始终保持风格统一。
            - img "Consistent brand visual aesthetic" [ref=e137]
          - generic [ref=e140]:
            - img "Pixel-level precision control for design elements" [ref=e148]
            - generic [ref=e149]:
              - img [ref=e151]
              - heading "精准编辑 -- 像素级控制" [level=3] [ref=e154]
              - paragraph [ref=e155]: AI 生成只是起点。在画布上直接修改每一个元素，精确调整到你满意为止。
      - generic [ref=e157]:
        - generic [ref=e159]:
          - heading "创意无界" [level=2] [ref=e160]
          - paragraph [ref=e161]: 探索 AI 驱动的无限设计可能
        - generic [ref=e162]:
          - generic [ref=e163] [cursor=pointer]:
            - img "梦幻水母 -- AI 数字雕塑" [ref=e164]
            - generic [ref=e165]:
              - generic [ref=e166]: 数字艺术
              - paragraph [ref=e167]: 梦幻水母 -- AI 数字雕塑
          - generic [ref=e168] [cursor=pointer]:
            - img "朋克牛仔 -- AI 时尚造型" [ref=e169]
            - generic [ref=e170]:
              - generic [ref=e171]: 潮流时尚
              - paragraph [ref=e172]: 朋克牛仔 -- AI 时尚造型
          - generic [ref=e173] [cursor=pointer]:
            - img "暗调飘逸 -- AI 风格化写真" [ref=e174]
            - generic [ref=e175]:
              - generic [ref=e176]: 艺术摄影
              - paragraph [ref=e177]: 暗调飘逸 -- AI 风格化写真
          - generic [ref=e178] [cursor=pointer]:
            - img "东方美学 -- AI 混合媒体创作" [ref=e179]
            - generic [ref=e180]:
              - generic [ref=e181]: 创意拼贴
              - paragraph [ref=e182]: 东方美学 -- AI 混合媒体创作
          - generic [ref=e183] [cursor=pointer]:
            - img "复古珠宝盒 -- AI 精致静物" [ref=e184]
            - generic [ref=e185]:
              - generic [ref=e186]: 静物写真
              - paragraph [ref=e187]: 复古珠宝盒 -- AI 精致静物
          - generic [ref=e188] [cursor=pointer]:
            - img "复古运动风 -- AI 编辑摄影" [ref=e189]
            - generic [ref=e190]:
              - generic [ref=e191]: 时尚大片
              - paragraph [ref=e192]: 复古运动风 -- AI 编辑摄影
          - generic [ref=e193] [cursor=pointer]:
            - img "清新双人 -- AI 自然光写真" [ref=e194]
            - generic [ref=e195]:
              - generic [ref=e196]: 人像摄影
              - paragraph [ref=e197]: 清新双人 -- AI 自然光写真
          - generic [ref=e198] [cursor=pointer]:
            - img "闪光灯下 -- AI 戏剧性光影" [ref=e199]
            - generic [ref=e200]:
              - generic [ref=e201]: 光影摄影
              - paragraph [ref=e202]: 闪光灯下 -- AI 戏剧性光影
      - generic [ref=e204]:
        - generic [ref=e206]:
          - heading "三步开始创作" [level=2] [ref=e207]
          - paragraph [ref=e208]: 从想法到作品，简单到超乎想象
        - generic [ref=e209]:
          - generic [ref=e210]:
            - generic: "01"
            - img [ref=e213]
            - heading "描述你的想法" [level=3] [ref=e215]
            - paragraph [ref=e216]: 用自然语言描述你想要的设计，或上传参考图片。AI 会理解你的真实意图。
            - img [ref=e219]
          - generic [ref=e221]:
            - generic: "02"
            - img [ref=e224]
            - heading "AI 智能创作" [level=3] [ref=e227]
            - paragraph [ref=e228]: lovart.dofe 分析你的需求，生成多个专业设计方案。从配色到排版，每个细节都经过精心考量。
            - img [ref=e231]
          - generic [ref=e233]:
            - generic: "03"
            - img [ref=e236]
            - heading "精细调整" [level=3] [ref=e240]
            - paragraph [ref=e241]: 在画布上自由编辑任何元素。满意后一键导出，支持多种格式。
      - generic [ref=e244]:
        - heading "准备好让 AI 改变你的设计流程了吗？" [level=2] [ref=e246]
        - paragraph [ref=e248]: 加入 10,000+ 创作者，开启你的 AI 设计之旅
        - link "免费开始创作" [ref=e251] [cursor=pointer]:
          - /url: /api/auth/oidc/start?returnTo=%2Fhome
        - paragraph [ref=e252]: 无需信用卡 · 永久免费版可用
    - contentinfo [ref=e253]:
      - generic [ref=e254]:
        - generic [ref=e255]:
          - generic [ref=e256]:
            - link "lovart.dofe" [ref=e257] [cursor=pointer]:
              - /url: /
              - img [ref=e258]
              - generic [ref=e261]: lovart.dofe
            - paragraph [ref=e262]: AI 驱动的创意设计平台
            - generic [ref=e263]:
              - link "GitHub" [ref=e264] [cursor=pointer]:
                - /url: https://github.com
                - img [ref=e265]
              - link "X (Twitter)" [ref=e267] [cursor=pointer]:
                - /url: https://x.com
                - img [ref=e268]
              - link "Discord" [ref=e270] [cursor=pointer]:
                - /url: https://discord.com
                - img [ref=e271]
          - generic [ref=e273]:
            - paragraph [ref=e274]: 产品
            - list [ref=e275]:
              - listitem [ref=e276]:
                - link "功能介绍" [ref=e277] [cursor=pointer]:
                  - /url: "#features"
              - listitem [ref=e278]:
                - link "定价方案" [ref=e279] [cursor=pointer]:
                  - /url: "#pricing"
              - listitem [ref=e280]:
                - link "更新日志" [ref=e281] [cursor=pointer]:
                  - /url: /changelog
              - listitem [ref=e282]:
                - link "产品路线图" [ref=e283] [cursor=pointer]:
                  - /url: /roadmap
          - generic [ref=e284]:
            - paragraph [ref=e285]: 资源
            - list [ref=e286]:
              - listitem [ref=e287]:
                - link "帮助文档" [ref=e288] [cursor=pointer]:
                  - /url: /docs
              - listitem [ref=e289]:
                - link "设计博客" [ref=e290] [cursor=pointer]:
                  - /url: /blog
              - listitem [ref=e291]:
                - link "社区论坛" [ref=e292] [cursor=pointer]:
                  - /url: /community
              - listitem [ref=e293]:
                - link "模板市场" [ref=e294] [cursor=pointer]:
                  - /url: /templates
          - generic [ref=e295]:
            - paragraph [ref=e296]: 关于
            - list [ref=e297]:
              - listitem [ref=e298]:
                - link "关于我们" [ref=e299] [cursor=pointer]:
                  - /url: /about
              - listitem [ref=e300]:
                - link "加入团队" [ref=e301] [cursor=pointer]:
                  - /url: /careers
              - listitem [ref=e302]:
                - link "联系我们" [ref=e303] [cursor=pointer]:
                  - /url: /contact
              - listitem [ref=e304]:
                - link "服务条款" [ref=e305] [cursor=pointer]:
                  - /url: /terms
              - listitem [ref=e306]:
                - link "隐私政策" [ref=e307] [cursor=pointer]:
                  - /url: /privacy
        - generic [ref=e308]:
          - paragraph [ref=e309]: © 2026 lovart.dofe. All rights reserved.
          - generic [ref=e310]: 简体中文
  - region "通知"
  - button "Open Next.js Dev Tools" [ref=e316] [cursor=pointer]:
    - img [ref=e317]
  - alert [ref=e320]: lovart.dofe
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
  10 |   await expect(page.getByRole("heading", { name: "让创意，自由生长" })).toBeVisible();
  11 |   await expect(page.getByText("Where Ideas Become Reality")).toBeVisible();
  12 |   await expect(page).toHaveScreenshot(`landing-${testInfo.project.name}.png`, {
  13 |     fullPage: false,
  14 |   });
  15 | 
  16 |   const landingAxe = await new AxeBuilder({ page }).analyze();
> 17 |   expect(landingAxe.violations).toEqual([]);
     |                                 ^ Error: expect(received).toEqual(expected) // deep equality
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