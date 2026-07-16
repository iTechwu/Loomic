import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Redis = require("ioredis") as new (
  value: string,
  options: Record<string, unknown>,
) => any;

export type RedisClient = {
  close(): Promise<void>;
  ping(): Promise<void>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
};

export function createRedisClient(url: string): RedisClient {
  const client = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 2, enableOfflineQueue: false });
  client.on("error", (error: Error) => console.error("[redis] client error", { message: error.message }));
  async function connected() {
    if (client.status === "wait") await client.connect();
  }
  return {
    async ping() { await connected(); await client.ping(); },
    async get(key) { await connected(); return client.get(key); },
    async set(key, value, ttlSeconds) {
      await connected();
      if (ttlSeconds) await client.set(key, value, "EX", ttlSeconds);
      else await client.set(key, value);
    },
    async close() { await client.quit().catch(() => undefined); },
  };
}
