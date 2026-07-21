import { afterEach, describe, expect, it, vi } from "vitest";

import type { ServerEnv } from "../config/env.js";
import {
  resolveDefaultModelId,
  runDefaultModelsBootSmoke,
} from "./default-model-smoke.js";
import { createDofeModelCatalog } from "./dofe-model-router.js";

type CatalogEntry = {
  id: string;
  type: string;
  capabilities?: string[];
};

/**
 * Build an injected fetch that serves `/v1/models` plus a capabilities doc per
 * alias, mirroring the ixicai gateway contract the router consumes.
 */
function buildCatalogFetch(entries: CatalogEntry[]) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/v1/models")) {
      return new Response(
        JSON.stringify({ data: entries.map((e) => ({ id: e.id })) }),
      );
    }
    const match = url.match(/\/v1\/models\/([^/]+)\/capabilities$/);
    const id = match?.[1] ? decodeURIComponent(match[1]) : "";
    const entry = entries.find((e) => e.id === id);
    if (!entry) {
      return new Response(
        JSON.stringify({ model_type: "text", capabilities: [] }),
      );
    }
    return new Response(
      JSON.stringify({
        model_type: entry.type,
        capabilities: (entry.capabilities ?? []).map((capabilityName) => ({
          capabilityName,
        })),
      }),
    );
  });
}

/** All three gateway defaults, correctly typed for chat/image/video. */
function allDefaultsPresent(): CatalogEntry[] {
  return [
    { id: "glm-5.2", type: "text" },
    { id: "flux-kontext-pro", type: "image", capabilities: ["text_to_image"] },
    { id: "seedance-2.0", type: "video" },
  ];
}

function makeCatalog(entries: CatalogEntry[]) {
  const catalog = createDofeModelCatalog(
    {
      dofeModelApiKey: "router-key",
      dofeModelBaseUrl: "https://ixicai.cn/api",
    },
    { fetch: buildCatalogFetch(entries) },
  );
  if (!catalog) throw new Error("catalog must be configured for this test");
  return catalog;
}

const baseEnv = { strictDefaultModels: false } as unknown as ServerEnv;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveDefaultModelId", () => {
  it("maps each kind to the shared default alias", () => {
    expect(resolveDefaultModelId("chat")).toBe("glm-5.2");
    expect(resolveDefaultModelId("image")).toBe("flux-kontext-pro");
    expect(resolveDefaultModelId("video")).toBe("seedance-2.0");
  });
});

describe("runDefaultModelsBootSmoke", () => {
  it("is silent when every default alias is in the catalog", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await runDefaultModelsBootSmoke(baseEnv, makeCatalog(allDefaultsPresent()));

    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("warns (without exiting) when a default alias is missing", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    // Drop the video default from the catalog.
    const entries = allDefaultsPresent().filter((e) => e.id !== "seedance-2.0");
    await runDefaultModelsBootSmoke(baseEnv, makeCatalog(entries));

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const call = warnSpy.mock.calls[0];
    if (!call) throw new Error("expected a warning to be emitted");
    const [message, context] = call;
    expect(message).toContain("seedance-2.0 (video)");
    expect(message).toContain("LOVART_STRICT_DEFAULT_MODELS");
    expect(context).toMatchObject({
      failureCategory: "default_model_not_in_catalog",
    });
  });

  it("exits with code 1 when a default is missing and strict mode is on", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const strictEnv = { strictDefaultModels: true } as unknown as ServerEnv;

    const entries = allDefaultsPresent().filter((e) => e.id !== "glm-5.2");
    await runDefaultModelsBootSmoke(strictEnv, makeCatalog(entries));

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("treats a catalog fetch failure as transient and never exits", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);
    const strictEnv = { strictDefaultModels: true } as unknown as ServerEnv;

    const failingFetch = vi.fn(async () => {
      throw new Error("gateway unreachable");
    });
    const catalog = createDofeModelCatalog(
      {
        dofeModelApiKey: "router-key",
        dofeModelBaseUrl: "https://ixicai.cn/api",
      },
      { fetch: failingFetch },
    );
    if (!catalog) throw new Error("catalog must be configured for this test");

    await runDefaultModelsBootSmoke(strictEnv, catalog);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const call = warnSpy.mock.calls[0];
    if (!call) throw new Error("expected a warning to be emitted");
    expect(call[0]).toContain("catalog fetch failed");
  });

  it("is a no-op when the gateway is not configured (no catalog)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation((() => undefined) as never);

    // No dofe env and no injected catalog → createDofeModelCatalog returns
    // undefined and the smoke returns immediately.
    await runDefaultModelsBootSmoke({} as ServerEnv);

    expect(exitSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
