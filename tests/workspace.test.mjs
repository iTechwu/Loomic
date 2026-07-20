import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, "..");

async function readJson(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  const content = await readFile(filePath, "utf8");
  return JSON.parse(content);
}

async function readText(relativePath) {
  const filePath = path.join(rootDir, relativePath);
  return readFile(filePath, "utf8");
}

test("root manifest exposes dev, build, test, and lint scripts", async () => {
  const manifest = await readJson("package.json");

  assert.equal(typeof manifest.scripts?.dev, "string");
  assert.equal(typeof manifest.scripts?.build, "string");
  assert.equal(typeof manifest.scripts?.test, "string");
  assert.equal(typeof manifest.scripts?.lint, "string");
});

test("workspace includes apps and packages globs", async () => {
  const workspace = await readText("pnpm-workspace.yaml");

  assert.match(workspace, /apps\/\*/);
  assert.match(workspace, /packages\/\*/);
});

test("root test command wires node:test and turbo package tests", async () => {
  const manifest = await readJson("package.json");

  assert.match(manifest.scripts["test:workspace"], /node --test/);
  assert.match(manifest.scripts["test:packages"], /turbo run test/);
  assert.match(manifest.scripts.test, /test:workspace/);
  assert.match(manifest.scripts.test, /test:packages/);
});

test("vitest workspace config exists for later package-level adoption", async () => {
  const workspaceConfig = await readText("vitest.workspace.ts");

  assert.match(workspaceConfig, /defineWorkspace/);
  assert.match(workspaceConfig, /tests\/\*\*\/\*\.test\.mjs/);
});

// The active workspace has two deployable apps. Keep this list aligned with
// pnpm-workspace.yaml rather than asserting a removed desktop package exists.
for (const appName of ["web", "server"]) {
  test(`${appName} app scripts perform real validation instead of placeholder logs`, async () => {
    const manifest = await readJson(`apps/${appName}/package.json`);

    assert.equal(typeof manifest.scripts?.build, "string");
    assert.equal(typeof manifest.scripts?.test, "string");
    assert.equal(typeof manifest.scripts?.typecheck, "string");
    assert.doesNotMatch(manifest.scripts.build, /placeholder/i);
    assert.doesNotMatch(manifest.scripts.build, /console\.log/);
    assert.doesNotMatch(manifest.scripts.test, /placeholder/i);
    assert.doesNotMatch(manifest.scripts.test, /console\.log/);
    assert.doesNotMatch(manifest.scripts.typecheck, /placeholder/i);
    assert.doesNotMatch(manifest.scripts.typecheck, /console\.log/);
  });
}

test("@lovart.dofe/config exports a single low-drift package contract", async () => {
  const source = await readText("packages/config/src/index.ts");

  assert.doesNotMatch(source, /apps\/\*/);
  assert.doesNotMatch(source, /packages\/\*/);
});

test("shared package placeholder exists for the upcoming contract task", async () => {
  const manifest = await readJson("packages/shared/package.json");

  assert.equal(manifest.name, "@lovart.dofe/shared");
  assert.equal(manifest.type, "module");
});

test("root lint baseline is wired through Biome", async () => {
  const manifest = await readJson("package.json");
  const biomeConfig = await readJson("biome.json");

  assert.equal(typeof manifest.devDependencies["@biomejs/biome"], "string");
  assert.match(manifest.scripts.lint, /biome/);
  assert.match(biomeConfig.$schema, /biome/);
  assert.equal(biomeConfig.formatter.enabled, true);
  assert.equal(biomeConfig.linter.enabled, true);
});

test("Vercel builds the deployed Lovart workspace packages", async () => {
  const vercel = await readJson("vercel.json");

  assert.match(vercel.buildCommand, /@lovart\.dofe\/shared/);
  assert.match(vercel.buildCommand, /@lovart\.dofe\/web/);
  assert.doesNotMatch(vercel.buildCommand, /@loomic\//);
});

test("web production builds fail on TypeScript errors", async () => {
  const source = await readText("apps/web/next.config.ts");

  assert.doesNotMatch(source, /ignoreBuildErrors\s*:\s*true/);
});

test("same-origin runtime and browser quality gates are versioned", async () => {
  const web = await readJson("apps/web/package.json");
  const nginx = await readText("nginx/lovart.local.dofe.ai.conf");
  const runtimeCheck = await readText("scripts/verify-same-origin-runtime.mjs");

  assert.equal(typeof web.scripts["test:e2e"], "string");
  assert.equal(typeof web.scripts["test:e2e:static"], "string");
  assert.equal(typeof web.devDependencies["@playwright/test"], "string");
  assert.equal(typeof web.devDependencies["@axe-core/playwright"], "string");
  assert.match(nginx, /location \^~ \/api\//);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:3105/);
  assert.match(nginx, /try_files \$uri \$uri\/ \$uri\.html \/index\.html/);
  assert.match(runtimeCheck, /redirect: "manual"/);
});

test("deployment and CI keep the same-origin edge versioned", async () => {
  const compose = await readText("deploy/docker-compose.yml");
  const composeSmoke = await readText("deploy/docker-compose.smoke.yml");
  const runtimeNginx = await readText("deploy/nginx/lovart-runtime.conf");
  const runtimeCheck = await readText("scripts/verify-compose-runtime.mjs");
  const workflow = await readText(".github/workflows/quality-gates.yml");

  assert.match(compose, /dockerfile: apps\/web\/Dockerfile/);
  assert.match(compose, /SERVICE_MODE: api/);
  assert.match(compose, /SERVICE_MODE: worker/);
  assert.match(runtimeNginx, /proxy_pass http:\/\/server:3105/);
  assert.match(runtimeNginx, /Content-Security-Policy/);
  assert.match(composeSmoke, /DATABASE_URL/);
  assert.match(composeSmoke, /profiles: \[worker\]/);
  assert.match(runtimeCheck, /lovart-dofe-server/);
  assert.match(workflow, /verify:compose-runtime/);
  assert.match(workflow, /test:e2e:static/);
});
