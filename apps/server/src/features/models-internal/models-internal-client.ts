import { createRequire } from "node:module";

import type {
  ModelsInternalBillingBalance,
  ModelsInternalBillingTenantBalance,
  ModelsInternalCalculatedPrice,
  ModelsInternalCalculatePriceQuery,
  ModelsInternalUsageLogs,
  ModelsInternalUsageStats,
} from "@dofe/models-sdk/internal-types";
import type { ModelsInternalApiError } from "@dofe/models-sdk/response";

const { createSignedModelsInternalDataClient } = createRequire(import.meta.url)(
  "@dofe/models-sdk/internal-node",
) as typeof import("@dofe/models-sdk/internal-node");

/**
 * Thin, request-scoped wrapper around `@dofe/models-sdk/internal-node` for
 * Lovart's usage/billing/pricing reads. The SDK import stays server-side only.
 *
 * This module intentionally does NOT handle seedance credential provisioning;
 * that stays in `../credentials/models-client.js` because it has stricter
 * secret-handling and retry semantics.
 */

export type Logger = {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
};

export type ModelsInternalClientConfig = {
  /** models data-plane base, normalized to `https://ixicai.cn/api`. */
  baseUrl: string;
  /** Service name whitelisted in models' internal API HMAC config. */
  serviceName: string;
  /** Shared INTERNAL_API_SECRET used to sign requests. */
  internalApiSecret: string;
  timeoutMs?: number;
};

export type ModelsInternalClientErrorCode = "http" | "timeout" | "sdk";

export class ModelsInternalClientError extends Error {
  readonly status: number;
  readonly code: ModelsInternalClientErrorCode;
  constructor(
    message: string,
    status: number,
    code: ModelsInternalClientErrorCode = "http",
  ) {
    super(message);
    this.name = "ModelsInternalClientError";
    this.status = status;
    this.code = code;
  }
}

export type DateRangeQuery = {
  startDate?: string | undefined;
  endDate?: string | undefined;
};

export type UsageLogsQuery = DateRangeQuery & {
  teamId?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
};

export type TenantUsageStatsQuery = DateRangeQuery & {
  apiKeyId?: string | undefined;
};

export type TenantUsageLogsQuery = DateRangeQuery & {
  apiKeyId?: string | undefined;
  page?: number | undefined;
  limit?: number | undefined;
};

export type PricingQuery = {
  tenantId?: string | undefined;
  modelAlias: string;
  feeType?: string | undefined;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
};

type Compact<T extends Record<string, unknown>> = {
  [K in keyof T]?: Exclude<T[K], undefined>;
};

function compactQuery<T extends Record<string, unknown>>(query: T): Compact<T> {
  const result = {} as Compact<T>;
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) {
      (result as Record<string, unknown>)[key] = value;
    }
  }
  return result;
}

export type InternalModelsClient = {
  getUsageStats(query: UsageLogsQuery): Promise<ModelsInternalUsageStats>;
  getTenantUsageStats(
    tenantId: string,
    query: TenantUsageStatsQuery,
  ): Promise<ModelsInternalUsageStats>;
  getUsageLogs(query: UsageLogsQuery): Promise<ModelsInternalUsageLogs>;
  getTenantUsageLogs(
    tenantId: string,
    query: TenantUsageLogsQuery,
  ): Promise<ModelsInternalUsageLogs>;
  getTeamBalance(teamId: string): Promise<ModelsInternalBillingBalance>;
  getTenantBalance(
    tenantId: string,
  ): Promise<ModelsInternalBillingTenantBalance>;
  calculatePrice(query: PricingQuery): Promise<ModelsInternalCalculatedPrice>;
};

export function createInternalModelsClient(
  config: ModelsInternalClientConfig,
  input: { correlationId: string; logger?: Logger | undefined },
): InternalModelsClient {
  validateConfig(config);
  const client = createSignedModelsInternalDataClient({
    baseUrl: config.baseUrl,
    serviceName: config.serviceName,
    internalApiSecret: config.internalApiSecret,
    timeoutMs: config.timeoutMs ?? 8_000,
    baseHeaders: { "x-correlation-id": input.correlationId },
  });
  const log = input.logger ?? silentLogger();

  return {
    async getUsageStats(query) {
      return callInternal(
        "usage_stats",
        () => client.usage.stats({ query: compactQuery(query) }),
        log,
        input.correlationId,
      );
    },
    async getTenantUsageStats(tenantId, query) {
      return callInternal(
        "tenant_usage_stats",
        () => client.usage.tenantStats({ params: { tenantId }, query: compactQuery(query) }),
        log,
        input.correlationId,
      );
    },
    async getUsageLogs(query) {
      return callInternal(
        "usage_logs",
        () => client.usage.logs({ query: compactQuery(query) }),
        log,
        input.correlationId,
      );
    },
    async getTenantUsageLogs(tenantId, query) {
      return callInternal(
        "tenant_usage_logs",
        () => client.usage.tenantLogs({ params: { tenantId }, query: compactQuery(query) }),
        log,
        input.correlationId,
      );
    },
    async getTeamBalance(teamId) {
      return callInternal(
        "team_balance",
        () => client.billing.balanceByTeam({ params: { teamId } }),
        log,
        input.correlationId,
      );
    },
    async getTenantBalance(tenantId) {
      return callInternal(
        "tenant_balance",
        () => client.billing.balanceByTenant({ params: { tenantId } }),
        log,
        input.correlationId,
      );
    },
    async calculatePrice(query) {
      return callInternal(
        "pricing_calculate",
        () => client.pricing.calculate({ query: compactQuery(query) as ModelsInternalCalculatePriceQuery }),
        log,
        input.correlationId,
      );
    },
  };
}

async function callInternal<T>(
  operation: string,
  fn: () => Promise<T>,
  log: Logger,
  correlationId: string,
): Promise<T> {
  const startedAt = performance.now();
  log.info(`[models_internal] ${operation}_request`, {
    correlationId,
    operation,
  });

  try {
    const result = await fn();
    log.info(`[models_internal] ${operation}_ok`, {
      correlationId,
      operation,
      latencyMs: Math.round(performance.now() - startedAt),
    });
    return result;
  } catch (error) {
    const latencyMs = Math.round(performance.now() - startedAt);

    if (isModelsInternalApiError(error)) {
      if (error.status === 0) {
        log.error(`[models_internal] ${operation}_timeout`, {
          correlationId,
          operation,
          latencyMs,
          statusCategory: "timeout",
        });
        throw new ModelsInternalClientError(
          `${operation} request timed out`,
          0,
          "timeout",
        );
      }
      log.error(`[models_internal] ${operation}_failed`, {
        correlationId,
        operation,
        latencyMs,
        status: error.status,
        statusCategory: `${Math.floor(error.status / 100) || 5}xx`,
      });
      throw new ModelsInternalClientError(
        `${operation} HTTP ${error.status}`,
        error.status,
        "http",
      );
    }

    if (isTimeoutError(error)) {
      log.error(`[models_internal] ${operation}_timeout`, {
        correlationId,
        operation,
        latencyMs,
        statusCategory: "timeout",
      });
      throw new ModelsInternalClientError(
        `${operation} request timed out`,
        0,
        "timeout",
      );
    }

    log.error(`[models_internal] ${operation}_error`, {
      correlationId,
      operation,
      latencyMs,
      statusCategory: "5xx",
      failureCategory: "models_internal_unexpected",
    });
    throw new ModelsInternalClientError(
      `${operation} request failed`,
      0,
      "http",
    );
  }
}

function validateConfig(config: ModelsInternalClientConfig): void {
  if (!config.internalApiSecret?.trim()) {
    throw new ModelsInternalClientError(
      "internalApiSecret is required",
      0,
      "sdk",
    );
  }
  if (!config.serviceName?.trim()) {
    throw new ModelsInternalClientError("serviceName is required", 0, "sdk");
  }
  if (!config.baseUrl?.trim()) {
    throw new ModelsInternalClientError("baseUrl is required", 0, "sdk");
  }
}

function isTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "TimeoutError" || error.name === "AbortError") return true;
  const cause = (error as { cause?: Error }).cause;
  if (cause && (cause.name === "TimeoutError" || cause.name === "AbortError"))
    return true;
  return false;
}

function isModelsInternalApiError(
  error: unknown,
): error is ModelsInternalApiError {
  return (
    error instanceof Error &&
    error.name === "ModelsInternalApiError" &&
    typeof (error as ModelsInternalApiError).status === "number"
  );
}

function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}
