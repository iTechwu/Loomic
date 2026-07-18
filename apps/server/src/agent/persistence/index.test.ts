import { describe, expect, it, vi } from "vitest";

import { createAgentPersistenceService } from "./index.js";

describe("createAgentPersistenceService", () => {
  it("does not start store migrations until checkpoint migrations finish", async () => {
    let finishCheckpointer: (() => void) | undefined;
    const checkpointerReady = new Promise<void>((resolve) => {
      finishCheckpointer = resolve;
    });
    const createStore = vi.fn(async () => ({}) as never);
    const service = createAgentPersistenceService(
      { databaseUrl: "postgres://example" },
      {
        createCheckpointer: async () => {
          await checkpointerReady;
          return {} as never;
        },
        createStore,
      },
    );

    const persistence = service.getPersistence();
    await Promise.resolve();

    expect(createStore).not.toHaveBeenCalled();

    finishCheckpointer?.();
    await expect(persistence).resolves.toEqual({ checkpointer: {}, store: {} });
  });
});
