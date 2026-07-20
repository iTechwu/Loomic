import { describe, expect, it } from "vitest";

import { redisRetryDelay } from "./redis-client.js";

describe("Redis startup retry policy", () => {
  it("fails closed after two bounded reconnection attempts", () => {
    expect(redisRetryDelay(1)).toBe(200);
    expect(redisRetryDelay(2)).toBe(400);
    expect(redisRetryDelay(3)).toBeNull();
  });
});
