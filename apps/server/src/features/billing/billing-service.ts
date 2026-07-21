import type { AuthenticatedUser } from "../../auth/sso-authenticator.js";
import type { UserCredentialsRepository } from "../credentials/credentials-repository.js";
import {
  createInternalModelsClient,
  type DateRangeQuery,
  type InternalModelsClient,
  type Logger,
  type ModelsInternalClientConfig,
  type PricingQuery,
  type TenantUsageLogsQuery,
  type TenantUsageStatsQuery,
  type UsageLogsQuery,
} from "../models-internal/models-internal-client.js";

/**
 * Service facade for usage/billing/pricing queries backed by models.dofe.ai.
 *
 * Authorization is currently credential-based: a user may only query teams and
 * api keys (bots) for which they have a `ready` `user_credentials` row. This is
 * correct for Lovart's current single-team provisioning flow but should be
 * replaced by a first-class workspace/team permission service once multi-team
 * RBAC matures.
 *
 * TODO: migrate team/apikey authorization to a workspace permission service.
 */

export type BillingServiceErrorCode =
  | "forbidden"
  | "models_internal_client"
  | "unexpected";

export class BillingServiceError extends Error {
  readonly statusCode: number;
  readonly code: BillingServiceErrorCode;
  constructor(
    message: string,
    statusCode: number,
    code: BillingServiceErrorCode,
  ) {
    super(message);
    this.name = "BillingServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export type UsageStats = {
  totalRequests: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  avgLatencyMs: number;
  successCount: number;
};

export type UsageLogEntry = {
  id: string;
  teamId: string;
  model: string;
  vendor: string;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  totalTokens?: number;
  timestamp: string;
};

export type UsageLogs = {
  list: UsageLogEntry[];
  total: number;
  page: number;
  limit: number;
};

export type BillingBalance = {
  accountId: string;
  accountType: "team" | "user" | "tenant";
  balance: string;
  reservedBalance: string;
  availableBalance: string;
  currency: string;
  status: string;
  nameSnapshot?: string | null | undefined;
  lowBalanceThreshold?: string | null | undefined;
};

export type CalculatedPrice = {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
};

export type BillingRequestContext = {
  getTenantUsageStats(
    user: AuthenticatedUser,
    query: TenantUsageStatsQuery,
  ): Promise<UsageStats>;
  getTeamUsageStats(
    user: AuthenticatedUser,
    teamId: string,
    query: DateRangeQuery,
  ): Promise<UsageStats>;
  getApiKeyUsageStats(
    user: AuthenticatedUser,
    apiKeyId: string,
    query: DateRangeQuery,
  ): Promise<UsageStats>;
  getUsageLogs(user: AuthenticatedUser, query: UsageLogsQuery): Promise<UsageLogs>;
  getTenantUsageLogs(
    user: AuthenticatedUser,
    query: TenantUsageLogsQuery,
  ): Promise<UsageLogs>;
  getTenantBalance(user: AuthenticatedUser): Promise<BillingBalance>;
  getTeamBalance(user: AuthenticatedUser, teamId: string): Promise<BillingBalance>;
  calculatePrice(
    user: AuthenticatedUser,
    query: PricingQuery,
  ): Promise<CalculatedPrice>;
};

export type BillingService = {
  forRequest(correlationId: string, logger?: Logger): BillingRequestContext;
};

export type BillingServiceOptions = {
  modelsClientConfig: ModelsInternalClientConfig;
  credentialsRepository: UserCredentialsRepository;
};

export function createBillingService(
  options: BillingServiceOptions,
): BillingService {
  const { modelsClientConfig, credentialsRepository } = options;

  return {
    forRequest(correlationId, logger) {
      const client = createInternalModelsClient(modelsClientConfig, {
        correlationId,
        logger,
      });

      return createBillingRequestContext(client, credentialsRepository);
    },
  };
}

function createBillingRequestContext(
  client: InternalModelsClient,
  credentialsRepository: UserCredentialsRepository,
): BillingRequestContext {
  return {
    async getTenantUsageStats(user, query) {
      return normalizeUsageStats(
        await client.getTenantUsageStats(user.tenantId, query),
      );
    },

    async getTeamUsageStats(user, teamId, query) {
      await assertTeamAccess(credentialsRepository, user, teamId);
      return normalizeUsageStats(
        await client.getUsageStats({ ...query, teamId }),
      );
    },

    async getApiKeyUsageStats(user, apiKeyId, query) {
      await assertApiKeyAccess(credentialsRepository, user, apiKeyId);
      return normalizeUsageStats(
        await client.getTenantUsageStats(user.tenantId, {
          ...query,
          apiKeyId,
        }),
      );
    },

    async getUsageLogs(user, query) {
      if (query.teamId) {
        await assertTeamAccess(credentialsRepository, user, query.teamId);
      }
      return normalizeUsageLogs(await client.getUsageLogs(query));
    },

    async getTenantUsageLogs(user, query) {
      if (query.apiKeyId) {
        await assertApiKeyAccess(credentialsRepository, user, query.apiKeyId);
      }
      return normalizeUsageLogs(
        await client.getTenantUsageLogs(user.tenantId, query),
      );
    },

    async getTenantBalance(user) {
      return normalizeBillingBalance(
        await client.getTenantBalance(user.tenantId),
        "tenant",
      );
    },

    async getTeamBalance(user, teamId) {
      await assertTeamAccess(credentialsRepository, user, teamId);
      return normalizeBillingBalance(
        await client.getTeamBalance(teamId),
        "team",
      );
    },

    async calculatePrice(user, query) {
      return normalizeCalculatedPrice(
        await client.calculatePrice({
          ...query,
          tenantId: user.tenantId,
        }),
      );
    },
  };
}

async function assertTeamAccess(
  credentialsRepository: UserCredentialsRepository,
  user: AuthenticatedUser,
  teamId: string,
): Promise<void> {
  const row = await credentialsRepository.findReady(user.id, teamId);
  if (!row) {
    throw new BillingServiceError(
      "caller does not have access to this team",
      403,
      "forbidden",
    );
  }
}

async function assertApiKeyAccess(
  credentialsRepository: UserCredentialsRepository,
  user: AuthenticatedUser,
  apiKeyId: string,
): Promise<void> {
  const row = await credentialsRepository.findByApiKeyId(user.id, apiKeyId);
  if (!row) {
    throw new BillingServiceError(
      "caller does not have access to this api key",
      403,
      "forbidden",
    );
  }
}

function normalizeUsageStats(stats: {
  totalRequests: number;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  totalCost: number;
  avgLatencyMs: number;
  successCount: number;
}): UsageStats {
  return { ...stats };
}

function normalizeUsageLogs(logs: {
  list: UsageLogEntry[];
  total: number;
  page: number;
  limit: number;
}): UsageLogs {
  return { ...logs };
}

function normalizeBillingBalance(
  balance: {
    accountId: string;
    balance: string;
    reservedBalance: string;
    availableBalance: string;
    currency: string;
    status: string;
    tenantId?: string | null;
    nameSnapshot?: string | null;
    lowBalanceThreshold?: string | null;
    accountType?: "team" | "user";
  },
  accountType: "team" | "tenant",
): BillingBalance {
  return {
    accountId: balance.accountId,
    accountType,
    balance: balance.balance,
    reservedBalance: balance.reservedBalance,
    availableBalance: balance.availableBalance,
    currency: balance.currency,
    status: balance.status,
    nameSnapshot: balance.nameSnapshot ?? undefined,
    lowBalanceThreshold: balance.lowBalanceThreshold ?? undefined,
  };
}

function normalizeCalculatedPrice(price: {
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
}): CalculatedPrice {
  return { ...price };
}
