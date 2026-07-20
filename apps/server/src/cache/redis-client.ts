import { createRequire } from "node:module";
import type { Redis as IORedis } from "ioredis";

const require = createRequire(import.meta.url);
const Redis = require("ioredis") as new (
  value: string,
  options: Record<string, unknown>,
) => any;

export type RedisClient = {
  close(): Promise<void>;
  /**
   * The shared connection is intentionally exposed for infrastructure plugins
   * such as Fastify rate limiting. Application features should use the narrow
   * methods below so their Redis contract stays explicit.
   */
  connection: IORedis;
  ping(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
};

export function createRedisClient(url: string): RedisClient {
  // Rate limiting is a security boundary. Connect eagerly so a configured but
  // unavailable Redis cannot silently degrade into per-instance accounting.
  const client = new Redis(url, {
    connectTimeout: 2_000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 2,
  });
  client.on("error", (error: Error) => console.error("[redis] client error", { message: error.message }));
  return {
    connection: client,
    async ping() { await client.ping(); },
    async get(key) { return client.get(key); },
    async set(key, value, ttlSeconds) {
      if (ttlSeconds) await client.set(key, value, "EX", ttlSeconds);
      else await client.set(key, value);
    },
    async close() { await client.quit().catch(() => undefined); },
  };
}
