// Shared contracts for usage, billing, and pricing endpoints that proxy
// models.dofe.ai internal data-plane responses.
import { z } from "zod";

import { timestampSchema } from "./contracts.js";

/** ISO 8601 calendar date (YYYY-MM-DD) used for usage date ranges. */
export const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

const dateRangeQuerySchema = z.object({
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
});

export const usageStatsQuerySchema = dateRangeQuerySchema.extend({
  teamId: z.string().uuid().optional(),
});
export type UsageStatsQuery = z.infer<typeof usageStatsQuerySchema>;

export const tenantUsageStatsQuerySchema = dateRangeQuerySchema.extend({
  apiKeyId: z.string().uuid().optional(),
});
export type TenantUsageStatsQuery = z.infer<typeof tenantUsageStatsQuerySchema>;

/** Query for /api/usage/bots/:apiKeyId/stats; apiKeyId is a path parameter. */
export const apiKeyUsageStatsQuerySchema = dateRangeQuerySchema;
export type ApiKeyUsageStatsQuery = z.infer<typeof apiKeyUsageStatsQuerySchema>;

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export const usageLogsQuerySchema = dateRangeQuerySchema
  .extend({
    teamId: z.string().uuid().optional(),
  })
  .merge(paginationQuerySchema);
export type UsageLogsQuery = z.infer<typeof usageLogsQuerySchema>;

export const tenantUsageLogsQuerySchema = dateRangeQuerySchema
  .extend({
    apiKeyId: z.string().uuid().optional(),
  })
  .merge(paginationQuerySchema);
export type TenantUsageLogsQuery = z.infer<typeof tenantUsageLogsQuerySchema>;

export const usageStatsResponseSchema = z.object({
  totalRequests: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalCost: z.number(),
  avgLatencyMs: z.number().nonnegative(),
  successCount: z.number().int().nonnegative(),
});
export type UsageStatsResponse = z.infer<typeof usageStatsResponseSchema>;

export const usageLogEntrySchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  model: z.string().min(1),
  vendor: z.string().min(1),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalCost: z.number(),
  totalTokens: z.number().int().nonnegative().optional(),
  timestamp: timestampSchema,
});
export type UsageLogEntry = z.infer<typeof usageLogEntrySchema>;

export const usageLogsResponseSchema = z.object({
  list: z.array(usageLogEntrySchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().nonnegative(),
  limit: z.number().int().nonnegative(),
});
export type UsageLogsResponse = z.infer<typeof usageLogsResponseSchema>;

export const billingBalanceResponseSchema = z.object({
  accountId: z.string().min(1),
  accountType: z.enum(["team", "user", "tenant"]),
  balance: z.string(),
  reservedBalance: z.string(),
  availableBalance: z.string(),
  currency: z.string(),
  status: z.string(),
  // Tenant balance carries a snapshot name and threshold; preserve them loosely.
  nameSnapshot: z.string().optional(),
  lowBalanceThreshold: z.string().optional(),
});
export type BillingBalanceResponse = z.infer<typeof billingBalanceResponseSchema>;

export const pricingCalculateRequestSchema = z.object({
  modelAlias: z.string().min(1),
  feeType: z.string().optional(),
  inputTokens: z.coerce.number().int().nonnegative().optional(),
  outputTokens: z.coerce.number().int().nonnegative().optional(),
});
export type PricingCalculateRequest = z.infer<typeof pricingCalculateRequestSchema>;

export const pricingCalculateResponseSchema = z.object({
  inputTokens: z.number().int().nonnegative().optional(),
  outputTokens: z.number().int().nonnegative().optional(),
  estimatedCost: z.number().optional(),
});
export type PricingCalculateResponse = z.infer<typeof pricingCalculateResponseSchema>;
