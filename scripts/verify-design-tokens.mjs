import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const webRequire = createRequire(resolve(root, "apps/web/package.json"));
const webPackage = JSON.parse(
  readFileSync(resolve(root, "apps/web/package.json"), "utf8"),
);
const expectedVersion = webPackage.dependencies?.["@dofe/design-tokens"];

if (!expectedVersion || !/^\d+\.\d+\.\d+$/.test(expectedVersion)) {
  throw new Error("apps/web must pin @dofe/design-tokens to an exact published version.");
}

const manifestPath = webRequire.resolve("@dofe/design-tokens/tokens.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.version !== expectedVersion) {
  throw new Error(
    `@dofe/design-tokens manifest version ${manifest.version} does not match ${expectedVersion}.`,
  );
}

const globalCss = readFileSync(resolve(root, "apps/web/src/app/globals.css"), "utf8");
if (!globalCss.includes('@import "@dofe/design-tokens/styles.css";')) {
  throw new Error("Lovart globals.css must import @dofe/design-tokens/styles.css.");
}

console.log(`Verified @dofe/design-tokens@${expectedVersion}.`);
