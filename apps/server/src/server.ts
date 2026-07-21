import { bootstrap } from "global-agent";

// Enable HTTP proxy for all outbound requests if http_proxy / https_proxy is set
bootstrap();

// Native fetch() proxy — needed for @google/generative-ai SDK
if (process.env.GLOBAL_AGENT_HTTP_PROXY) {
  const { ProxyAgent, setGlobalDispatcher } = await import("undici");
  setGlobalDispatcher(new ProxyAgent(process.env.GLOBAL_AGENT_HTTP_PROXY));
}

import { buildApp } from "./app.js";
import { loadServerEnv } from "./config/env.js";
import { migrate } from "./database/migrate.js";
import { checkInternalApiSecretSmoke } from "./features/credentials/models-client.js";
import { withStartupTimeout } from "./startup-timeout.js";

const env = loadServerEnv();

// Fail fast when the INTERNAL_API_SECRET is rejected by models.dofe.ai. A 401
// means the trust root is wrong (rotated on one side only, or a copied example
// value). By default this is a loud warning so a transiently-unreachable models
// never takes Lovart down; set LOVART_STRICT_INTERNAL_SECRET_SMOKE=true in
// production to make a 401 fatal and block boot.
const strictSecretSmoke =
  process.env.LOVART_STRICT_INTERNAL_SECRET_SMOKE === "true";
if (env.internalApiSecret && env.dofeModelBaseUrl) {
  const smoke = await checkInternalApiSecretSmoke({
    baseUrl: env.dofeModelBaseUrl,
    serviceName: env.lovartModelsServiceName ?? "lovart.dofe.ai",
    internalApiSecret: env.internalApiSecret,
  });
  if (!smoke.ok && smoke.status === 401) {
    const message =
      "[server] INTERNAL_API_SECRET rejected by models (HTTP 401). Rotate to a fresh value matching models.dofe.ai.";
    if (strictSecretSmoke) {
      console.error(message);
      process.exit(1);
    }
    console.warn(
      `${message} (non-fatal; set LOVART_STRICT_INTERNAL_SECRET_SMOKE=true to block boot)`,
    );
  } else if (!smoke.ok) {
    console.warn(
      `[server] INTERNAL_API_SECRET smoke check did not return 200 (status=${smoke.status}); continuing because models may be temporarily unreachable.`,
    );
  }
}

// Apply pending migrations before serving traffic. The API server owns this so
// concurrent workers (which do not import server.ts) never race on
// app_schema_migrations. Idempotent + checksum-guarded, so it is safe every
// boot. Set LOVART_RUN_MIGRATIONS_ON_BOOT=0 to opt out (e.g. when an external
// job applies migrations). Requires DATABASE_URL, which buildApp also requires.
const runMigrationsOnBoot = process.env.LOVART_RUN_MIGRATIONS_ON_BOOT !== "0";
if (runMigrationsOnBoot && env.databaseUrl) {
  try {
    await migrate();
    console.info("[server] migrations applied before boot");
  } catch (error) {
    console.error("[server] migration_failed_before_boot", {
      message: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

const app = buildApp({
  env,
});

const host = process.env.HOST ?? "127.0.0.1";

try {
  await withStartupTimeout(app.listen({ host, port: env.port }));

  console.log(`@lovart.dofe/server listening on http://${host}:${env.port}`);
} catch (error) {
  app.log.error({ error }, "server_startup_failed");
  // app.close() itself can wait on the unresolved app.listen() promise. Start
  // cleanup without awaiting it, then terminate this failed entrypoint.
  void app.close().catch(() => undefined);
  process.exit(1);
}
