import { readFileSync } from "node:fs";

import { DEFAULT_CHAT_MODEL } from "@lovart.dofe/shared";

import { type TosConfig, parseTosConfig } from "../storage/tos-config.js";

export const DEFAULT_AGENT_BACKEND_MODE = "state";
export const DEFAULT_AGENT_MODEL = "gpt-4.1";
export const DEFAULT_GOOGLE_AGENT_MODEL = "gemini-2.5-flash";
// Sourced from the shared single source of truth so the gateway default chat
// alias is identical across server, web, and the boot-time default-model smoke.
export const DEFAULT_DOFE_MODEL_ROUTER_AGENT_MODEL = DEFAULT_CHAT_MODEL;
export const DEFAULT_SERVER_PORT = 3105;
export const DEFAULT_WEB_ORIGIN = "http://localhost:3005";

/**
 * Resolve the default agent model based on available provider configuration.
 * When Google/Vertex is configured but OpenAI is not, defaults to Gemini 2.5 Flash.
 */
export function resolveDefaultAgentModel(
  env: Pick<
    ServerEnv,
    "dofeModelApiKey" | "googleApiKey" | "googleVertexProject" | "openAIApiKey"
  >,
): string {
  if (env.dofeModelApiKey) return DEFAULT_DOFE_MODEL_ROUTER_AGENT_MODEL;
  const hasOpenAI = !!env.openAIApiKey;
  const hasGoogle = !!(env.googleApiKey || env.googleVertexProject);

  if (!hasOpenAI && hasGoogle) return DEFAULT_GOOGLE_AGENT_MODEL;
  return DEFAULT_AGENT_MODEL;
}

export type AgentBackendMode = "filesystem" | "state";

export type ServerEnv = {
  agentBackendMode: AgentBackendMode;
  agentFilesRoot?: string;
  agentModel: string;
  databaseUrl?: string;
  /** DoFe Models gateway data-plane base URL, normalized to include /api. */
  dofeModelBaseUrl?: string;
  /** DoFe Models gateway API key. This stays server-side only. */
  dofeModelApiKey?: string;
  googleApiKey?: string;
  googleApplicationCredentials?: string;
  googleFontsApiKey?: string;
  googleVertexLocation?: string;
  googleVertexProject?: string;
  googleVertexVideoLocation?: string;
  openAIApiBase?: string;
  openAIApiKey?: string;
  port: number;
  replicateApiToken?: string;
  rabbitMqUrl?: string;
  /** When true, fail startup unless managed TLS Redis is configured. */
  requireRedis?: boolean;
  redisUrl?: string;
  /**
   * When true, fail startup if any default model alias
   * (DEFAULT_CHAT/IMAGE/VIDEO_MODEL) is absent from the ixicai `/v1/models`
   * catalog. Defaults to a non-fatal warning, mirroring
   * LOVART_STRICT_INTERNAL_SECRET_SMOKE.
   */
  strictDefaultModels?: boolean;
  internalApiSecret?: string;
  ssoApiUrl?: string;
  ssoClientId?: string;
  ssoClientSecret?: string;
  ssoDiscoveryUrl?: string;
  ssoIssuer?: string;
  ssoInternalApiUrl?: string;
  ssoInternalJwksUri?: string;
  ssoJwksUri?: string;
  ssoRedirectUri?: string;
  ssoServiceName?: string;
  tos?: TosConfig;
  version: string;
  volcesApiKey?: string;
  volcesBaseUrl?: string;
  /**
   * Service name used to sign models.dofe.ai internal API requests. Must be on
   * models' MODELS_SEEDANCE_CREDENTIAL_SERVICE_NAMES whitelist (lovart.dofe.ai
   * is on the default list).
   */
  lovartModelsServiceName?: string;
  /**
   * AES-256-GCM key (32 bytes, base64/hex/utf8) for encrypting stored user
   * credentials. When unset, credentials fall back to plaintext storage and a
   * startup warning is logged.
   */
  lovartCredentialEncryptionKey?: string;
  skillsRoot?: string;
  webOrigin: string;
  workerConcurrency?: number;
  workerImageConcurrency?: number;
  workerVideoConcurrency?: number;
  workerId?: string;
  workerPollIntervalMs?: number;
  workerMaxBatchSize?: number;
};

export function loadServerEnv(
  overrides: Partial<ServerEnv> = {},
  source: NodeJS.ProcessEnv = process.env,
): ServerEnv {
  const agentFilesRoot =
    overrides.agentFilesRoot ??
    parseAgentFilesRoot(source.LOVART_DOFE_AGENT_FILES_ROOT);
  const openAIApiBase =
    overrides.openAIApiBase ?? normalizeOptionalString(source.OPENAI_API_BASE);
  const openAIApiKey =
    overrides.openAIApiKey ?? normalizeOptionalString(source.OPENAI_API_KEY);
  const dofeModelBaseUrl =
    overrides.dofeModelBaseUrl ??
    normalizeDofeModelBaseUrl(source.DOFE_MODEL_BASE_URL);
  const dofeModelApiKey =
    overrides.dofeModelApiKey ??
    normalizeOptionalString(source.DOFE_MODEL_API_KEY);

  if (!!dofeModelBaseUrl !== !!dofeModelApiKey) {
    throw new Error(
      "DOFE_MODEL_BASE_URL and DOFE_MODEL_API_KEY must be configured together.",
    );
  }
  const databaseUrl =
    overrides.databaseUrl ?? normalizeOptionalString(source.DATABASE_URL);
  const tos = overrides.tos ?? parseTosConfig(source);
  const ssoApiUrl =
    overrides.ssoApiUrl ?? normalizeOptionalString(source.SSO_API_URL);
  const ssoClientId =
    overrides.ssoClientId ?? normalizeOptionalString(source.SSO_CLIENT_ID);
  const ssoClientSecret =
    overrides.ssoClientSecret ??
    normalizeOptionalString(source.SSO_CLIENT_SECRET);
  const ssoDiscoveryUrl =
    overrides.ssoDiscoveryUrl ??
    normalizeOptionalString(source.SSO_DISCOVERY_URL);
  const ssoIssuer =
    overrides.ssoIssuer ?? normalizeOptionalString(source.SSO_ISSUER);
  const ssoInternalApiUrl =
    overrides.ssoInternalApiUrl ??
    normalizeOptionalString(source.SSO_INTERNAL_API_URL);
  const ssoJwksUri =
    overrides.ssoJwksUri ?? normalizeOptionalString(source.JWKS_URI);
  const ssoInternalJwksUri =
    overrides.ssoInternalJwksUri ??
    normalizeOptionalString(source.INTERNAL_JWKS_URI);
  const ssoRedirectUri =
    overrides.ssoRedirectUri ??
    normalizeOptionalString(source.SSO_REDIRECT_URI);
  const ssoServiceName =
    overrides.ssoServiceName ??
    normalizeOptionalString(source.SSO_SERVICE_NAME);
  const internalApiSecret =
    overrides.internalApiSecret ??
    normalizeOptionalString(source.INTERNAL_API_SECRET);
  if (internalApiSecret) {
    validateInternalApiSecret(internalApiSecret);
  }
  const googleApiKey =
    overrides.googleApiKey ?? normalizeOptionalString(source.GOOGLE_API_KEY);
  const googleApplicationCredentials =
    overrides.googleApplicationCredentials ??
    normalizeOptionalString(source.GOOGLE_APPLICATION_CREDENTIALS);
  const googleFontsApiKey =
    overrides.googleFontsApiKey ??
    normalizeOptionalString(source.GOOGLE_FONTS_API_KEY);
  const googleVertexProject =
    overrides.googleVertexProject ??
    normalizeOptionalString(source.GOOGLE_VERTEX_PROJECT);
  const googleVertexLocation =
    overrides.googleVertexLocation ??
    normalizeOptionalString(source.GOOGLE_VERTEX_LOCATION);
  const googleVertexVideoLocation =
    overrides.googleVertexVideoLocation ??
    normalizeOptionalString(source.GOOGLE_VERTEX_VIDEO_LOCATION);
  const replicateApiToken =
    overrides.replicateApiToken ??
    normalizeOptionalString(source.REPLICATE_API_TOKEN);
  const rabbitMqUrl =
    overrides.rabbitMqUrl ?? normalizeOptionalString(source.RABBITMQ_URL);
  const redisUrl =
    overrides.redisUrl ?? normalizeOptionalString(source.REDIS_URL);
  const requireRedis =
    overrides.requireRedis ??
    parseBoolean(source.LOVART_DOFE_REQUIRE_REDIS, false);
  if (requireRedis) validateRequiredRedisUrl(redisUrl);
  const strictDefaultModels =
    overrides.strictDefaultModels ??
    parseBoolean(
      source.LOVART_STRICT_DEFAULT_MODELS,
      false,
      "LOVART_STRICT_DEFAULT_MODELS",
    );
  const volcesApiKey =
    overrides.volcesApiKey ?? normalizeOptionalString(source.VOLCES_API_KEY);
  const volcesBaseUrl =
    overrides.volcesBaseUrl ?? normalizeOptionalString(source.VOLCES_BASE_URL);
  const lovartModelsServiceName =
    overrides.lovartModelsServiceName ??
    normalizeOptionalString(source.LOVART_MODELS_SERVICE_NAME) ??
    "lovart.dofe.ai";
  const lovartCredentialEncryptionKey =
    overrides.lovartCredentialEncryptionKey ??
    normalizeOptionalString(source.LOVART_CREDENTIAL_ENCRYPTION_KEY);
  const skillsRoot =
    overrides.skillsRoot ??
    normalizeOptionalString(source.LOVART_DOFE_SKILLS_ROOT);
  const workerConcurrency =
    overrides.workerConcurrency ??
    (source.WORKER_CONCURRENCY
      ? Number.parseInt(source.WORKER_CONCURRENCY, 10)
      : undefined);
  const workerImageConcurrency =
    overrides.workerImageConcurrency ??
    (source.WORKER_IMAGE_CONCURRENCY
      ? Number.parseInt(source.WORKER_IMAGE_CONCURRENCY, 10)
      : undefined);
  const workerVideoConcurrency =
    overrides.workerVideoConcurrency ??
    (source.WORKER_VIDEO_CONCURRENCY
      ? Number.parseInt(source.WORKER_VIDEO_CONCURRENCY, 10)
      : undefined);
  const workerId =
    overrides.workerId ?? normalizeOptionalString(source.WORKER_ID);
  const workerPollIntervalMs =
    overrides.workerPollIntervalMs ??
    (source.WORKER_POLL_INTERVAL_MS
      ? Number.parseInt(source.WORKER_POLL_INTERVAL_MS, 10)
      : undefined);
  const workerMaxBatchSize =
    overrides.workerMaxBatchSize ??
    (source.WORKER_MAX_BATCH_SIZE
      ? Number.parseInt(source.WORKER_MAX_BATCH_SIZE, 10)
      : undefined);

  // Resolve default agent model based on available provider keys.
  // Explicit LOVART_DOFE_AGENT_MODEL always takes precedence; otherwise fall back
  // to Gemini 2.5 Flash when only Google/Vertex is configured.
  const explicitModel =
    overrides.agentModel ?? parseAgentModel(source.LOVART_DOFE_AGENT_MODEL);
  const resolvedAgentModel =
    explicitModel ??
    resolveDefaultAgentModel({
      ...(dofeModelApiKey ? { dofeModelApiKey } : {}),
      ...(googleApiKey ? { googleApiKey } : {}),
      ...(googleVertexProject ? { googleVertexProject } : {}),
      ...(openAIApiKey ? { openAIApiKey } : {}),
    });

  return {
    agentBackendMode:
      overrides.agentBackendMode ??
      parseAgentBackendMode(source.LOVART_DOFE_AGENT_BACKEND_MODE),
    agentModel: resolvedAgentModel,
    port:
      overrides.port ??
      parsePort(source.LOVART_DOFE_SERVER_PORT ?? source.PORT),
    version: overrides.version ?? readServerVersion(),
    webOrigin:
      overrides.webOrigin ??
      source.LOVART_DOFE_WEB_ORIGIN ??
      DEFAULT_WEB_ORIGIN,
    ...(agentFilesRoot ? { agentFilesRoot } : {}),
    ...(googleApiKey ? { googleApiKey } : {}),
    ...(googleApplicationCredentials ? { googleApplicationCredentials } : {}),
    ...(openAIApiBase ? { openAIApiBase } : {}),
    ...(openAIApiKey ? { openAIApiKey } : {}),
    ...(dofeModelBaseUrl ? { dofeModelBaseUrl } : {}),
    ...(dofeModelApiKey ? { dofeModelApiKey } : {}),
    ...(databaseUrl ? { databaseUrl } : {}),
    ...(tos ? { tos } : {}),
    ...(ssoApiUrl ? { ssoApiUrl } : {}),
    ...(ssoClientId ? { ssoClientId } : {}),
    ...(ssoClientSecret ? { ssoClientSecret } : {}),
    ...(ssoDiscoveryUrl ? { ssoDiscoveryUrl } : {}),
    ...(ssoIssuer ? { ssoIssuer } : {}),
    ...(ssoInternalApiUrl ? { ssoInternalApiUrl } : {}),
    ...(ssoJwksUri ? { ssoJwksUri } : {}),
    ...(ssoInternalJwksUri ? { ssoInternalJwksUri } : {}),
    ...(ssoRedirectUri ? { ssoRedirectUri } : {}),
    ...(ssoServiceName ? { ssoServiceName } : {}),
    ...(internalApiSecret ? { internalApiSecret } : {}),
    ...(googleFontsApiKey ? { googleFontsApiKey } : {}),
    ...(googleVertexProject ? { googleVertexProject } : {}),
    ...(googleVertexLocation ? { googleVertexLocation } : {}),
    ...(googleVertexVideoLocation ? { googleVertexVideoLocation } : {}),
    ...(replicateApiToken ? { replicateApiToken } : {}),
    ...(rabbitMqUrl ? { rabbitMqUrl } : {}),
    requireRedis,
    strictDefaultModels,
    ...(redisUrl ? { redisUrl } : {}),
    ...(volcesApiKey ? { volcesApiKey } : {}),
    ...(volcesBaseUrl ? { volcesBaseUrl } : {}),
    ...(lovartCredentialEncryptionKey ? { lovartCredentialEncryptionKey } : {}),
    // lovartModelsServiceName always has a default, so always include it.
    lovartModelsServiceName,
    ...(skillsRoot ? { skillsRoot } : {}),
    ...(workerConcurrency ? { workerConcurrency } : {}),
    ...(workerImageConcurrency ? { workerImageConcurrency } : {}),
    ...(workerVideoConcurrency ? { workerVideoConcurrency } : {}),
    ...(workerId ? { workerId } : {}),
    ...(workerPollIntervalMs ? { workerPollIntervalMs } : {}),
    ...(workerMaxBatchSize ? { workerMaxBatchSize } : {}),
  };
}

function parseAgentBackendMode(rawMode: string | undefined): AgentBackendMode {
  if (!rawMode) {
    return DEFAULT_AGENT_BACKEND_MODE;
  }

  if (rawMode === "state" || rawMode === "filesystem") {
    return rawMode;
  }

  throw new Error(`Invalid LOVART_DOFE_AGENT_BACKEND_MODE value: ${rawMode}`);
}

function parseAgentFilesRoot(rawRoot: string | undefined) {
  return normalizeOptionalString(rawRoot);
}

function parseAgentModel(rawModel: string | undefined) {
  return normalizeOptionalString(rawModel);
}

function normalizeOptionalString(value: string | undefined) {
  const normalizedValue = value?.trim();
  return normalizedValue || undefined;
}

function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
  envName = "LOVART_DOFE_REQUIRE_REDIS",
): boolean {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return defaultValue;
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${envName} must be true or false.`);
}

/**
 * Known placeholder / example values that must never be promoted to a runnable
 * environment. The Models repo's `apps/api/.env.example` shipped a concrete hex
 * example; if an operator copies that value into Lovart's INTERNAL_API_SECRET
 * the HMAC trust root is publicly known.
 */
const KNOWN_PLACEHOLDER_INTERNAL_SECRETS = new Set([
  "replace-with-server-only-secret",
  // Models repo example value (apps/api/.env.example) — do not allow.
  "2f83a27179523d9a19c58dfae4561e9ae4428b266bdb53fe80456646b032b649",
]);

/**
 * INTERNAL_API_SECRET is the HMAC trust root Lovart uses to sign
 * `/internal/seedance/credentials` calls to models.dofe.ai. Reject obviously
 * insecure values at startup so a misconfigured deployment fails fast instead
 * of silently authenticating with a known/guessable secret.
 */
export function validateInternalApiSecret(secret: string): void {
  const trimmed = secret.trim();
  if (KNOWN_PLACEHOLDER_INTERNAL_SECRETS.has(trimmed)) {
    throw new Error(
      "INTERNAL_API_SECRET is using a known placeholder/example value. Generate a fresh, server-only secret that matches models.dofe.ai's value.",
    );
  }
  if (trimmed.length < 32) {
    throw new Error(
      "INTERNAL_API_SECRET must be at least 32 characters. Generate a fresh secret, e.g. `openssl rand -hex 32`.",
    );
  }
  if (new Set(trimmed).size < 10) {
    throw new Error(
      "INTERNAL_API_SECRET has too little entropy. Use a high-entropy random value.",
    );
  }
}

function validateRequiredRedisUrl(redisUrl: string | undefined): void {
  if (!redisUrl) {
    throw new Error(
      "REDIS_URL is required when LOVART_DOFE_REQUIRE_REDIS is enabled.",
    );
  }

  let url: URL;
  try {
    url = new URL(redisUrl);
  } catch {
    throw new Error("REDIS_URL must be an absolute rediss URL when required.");
  }
  if (url.protocol !== "rediss:" || !url.hostname) {
    throw new Error(
      "REDIS_URL must use rediss when LOVART_DOFE_REQUIRE_REDIS is enabled.",
    );
  }
}

/**
 * ixicai.cn serves the interactive application at the root and exposes its
 * models data-plane beneath /api. Accepting either form prevents requests from
 * being sent to the login application when an operator configures the root URL.
 */
export function normalizeDofeModelBaseUrl(value: string | undefined) {
  const normalizedValue = normalizeOptionalString(value);
  if (!normalizedValue) return undefined;

  let url: URL;
  try {
    url = new URL(normalizedValue);
  } catch {
    throw new Error("DOFE_MODEL_BASE_URL must be an absolute http(s) URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("DOFE_MODEL_BASE_URL must use http or https.");
  }

  if (url.pathname === "" || url.pathname === "/") {
    url.pathname = "/api";
  }
  return url.toString().replace(/\/$/, "");
}

function parsePort(rawPort: string | undefined) {
  if (!rawPort) {
    return DEFAULT_SERVER_PORT;
  }

  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid LOVART_DOFE_SERVER_PORT value: ${rawPort}`);
  }

  return port;
}

function readServerVersion() {
  const packageJson = readFileSync(
    new URL("../../package.json", import.meta.url),
    "utf8",
  );

  const parsed = JSON.parse(packageJson) as { version?: string };
  return parsed.version ?? "0.0.0";
}
