import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const baseline = JSON.parse(
  readFileSync(resolve(root, "biome-baseline.json"), "utf8"),
);
const config = readFileSync(resolve(root, "biome.json"));
const configSha256 = createHash("sha256").update(config).digest("hex");

if (configSha256 !== baseline.configSha256) {
  throw new Error(
    "Biome configuration changed. Review diagnostics and intentionally update biome-baseline.json.",
  );
}

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const result = spawnSync(
  pnpm,
  ["exec", "biome", "check", ".", "--reporter=json"],
  {
    cwd: root,
    encoding: "utf8",
    // The current baseline includes source excerpts in Biome's JSON report.
    // Keep this bounded while allowing the complete report to be counted.
    maxBuffer: 32 * 1024 * 1024,
  },
);

if (result.error) throw result.error;

const report = JSON.parse(result.stdout);
const errors = report.summary?.errors;
if (!Number.isInteger(errors)) {
  throw new Error("Biome JSON report did not include an integer error count.");
}

const version = /Version:\s*([^\s]+)/.exec(
  spawnSync(pnpm, ["exec", "biome", "--version"], {
    cwd: root,
    encoding: "utf8",
  }).stdout,
)?.[1];
if (version !== baseline.biomeVersion) {
  throw new Error(
    `Biome version ${version ?? "unknown"} differs from baseline ${baseline.biomeVersion}.`,
  );
}

if (errors > baseline.maximumErrors) {
  throw new Error(
    `Biome diagnostics regressed: ${errors} errors exceeds baseline ${baseline.maximumErrors}.`,
  );
}

console.log(
  `Biome baseline holds: ${errors} <= ${baseline.maximumErrors} errors.`,
);
