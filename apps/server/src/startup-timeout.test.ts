import { describe, expect, it } from "vitest";

import { withStartupTimeout } from "./startup-timeout.js";

describe("server startup timeout", () => {
  it("returns a completed startup operation", async () => {
    await expect(withStartupTimeout(Promise.resolve("ready"), 10)).resolves.toBe("ready");
  });

  it("fails a startup operation that never resolves", async () => {
    await expect(
      withStartupTimeout(new Promise<never>(() => {}), 10),
    ).rejects.toThrow("Server startup timed out after 10ms.");
  });
});
