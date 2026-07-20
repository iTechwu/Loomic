// Migration safety gate.
//
// Enforces invariants over apps/server/migrations/*.sql that the runner
// (apps/server/src/database/migrate.ts) applies blindly:
//   1. Every file matches ^\d+_.+\.sql$ (otherwise migrate.ts silently skips it).
//   2. Numeric prefixes are unique (two files sharing a 4-digit prefix is the
//      duplicate-numbering failure we narrowly avoided with 0013/0014).
//   3. Files are non-empty (an accidental empty .sql would no-op silently).
//   4. Prefixes are monotonically increasing with no duplicates across the set.
//
// Gaps in numbering are allowed (0005 is intentionally absent), so this gate
// fails only on the dangerous cases above. Run in CI before build/deploy.
import { readFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const migrationsDir = resolve(root, "apps/server/migrations");

const entries = await readdir(migrationsDir);
const sqlFiles = entries.filter((name) => name.endsWith(".sql"));

if (sqlFiles.length === 0) {
  throw new Error(`No .sql migrations found under ${migrationsDir}.`);
}

const violations = [];
const seenPrefixes = new Map(); // prefix -> filename

for (const name of sqlFiles) {
  const match = /^(\d+)_.+\.sql$/.exec(name);
  if (!match) {
    violations.push(
      `Migration "${name}" does not match ^\\d+_.+\\.sql$ and would be skipped by the runner.`,
    );
    continue;
  }
  const prefix = match[1];
  const previous = seenPrefixes.get(prefix);
  if (previous) {
    violations.push(
      `Duplicate migration prefix "${prefix}": "${previous}" and "${name}". The runner applies by sorted filename and would apply both.`,
    );
  } else {
    seenPrefixes.set(prefix, name);
  }

  const filePath = resolve(migrationsDir, name);
  const fileStat = await stat(filePath);
  if (!fileStat.size) {
    violations.push(`Migration "${name}" is empty.`);
  }
}

// Sentinel: the provisioning-tracking migration must exist because the server's
// takeProvisionLock references its columns. Catches a partial cherry-pick that
// ships the code without the migration.
const required = ["0014_user_credentials_provisioning_tracking.sql"];
for (const file of required) {
  try {
    await readFile(resolve(migrationsDir, file), "utf8");
  } catch {
    violations.push(
      `Required migration "${file}" is missing — takeProvisionLock depends on its columns.`,
    );
  }
}

if (violations.length) {
  console.error("[verify-migrations] FAILED");
  for (const violation of violations) console.error(`  - ${violation}`);
  process.exit(1);
}

const sorted = [...seenPrefixes.keys()].sort((a, b) => Number(a) - Number(b));
console.log(
  `[verify-migrations] OK — ${sqlFiles.length} migration(s), prefixes ${sorted[0]}..${sorted[sorted.length - 1]}.`,
);
