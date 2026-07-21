import {
  DEFAULT_CHAT_MODEL,
  DEFAULT_IMAGE_MODEL,
  DEFAULT_VIDEO_MODEL,
} from "@lovart.dofe/shared";

import type { ServerEnv } from "../config/env.js";
import {
  logOperationalFailure,
  logOperationalWarning,
} from "../utils/operational-log.js";
import {
  type DofeModelCatalog,
  createDofeModelCatalog,
} from "./dofe-model-router.js";

export type DefaultModelKind = "chat" | "image" | "video";

/** Stable log category for default-model catalog membership events. */
const SMOKE_CATEGORY = "default_model_not_in_catalog";

/**
 * The default alias used for each generation surface. Sourced from the shared
 * single source of truth so the smoke and every call site can never drift.
 */
export function resolveDefaultModelId(kind: DefaultModelKind): string {
  switch (kind) {
    case "chat":
      return DEFAULT_CHAT_MODEL;
    case "image":
      return DEFAULT_IMAGE_MODEL;
    case "video":
      return DEFAULT_VIDEO_MODEL;
  }
}

/**
 * Verify each default model alias exists in the gateway `/v1/models` catalog.
 *
 * Mirrors `checkInternalApiSecretSmoke` (see server.ts/worker.ts): a miss is a
 * loud warning by default, and fatal when `env.strictDefaultModels` is set, so
 * a release that ships a default the gateway no longer serves cannot boot. A
 * catalog fetch failure is treated as transient (warn + return) — never fatal —
 * to avoid taking Lovart down on a gateway blip, consistent with the router's
 * stale-cache handling.
 *
 * Callers may inject `catalog` for testing; production passes none and the
 * smoke builds its own from `env`.
 */
export async function runDefaultModelsBootSmoke(
  env: ServerEnv,
  catalog?: DofeModelCatalog,
): Promise<void> {
  const resolvedCatalog = catalog ?? createDofeModelCatalog(env);
  if (!resolvedCatalog) {
    // No gateway configured — other startup guards cover this. Nothing to
    // validate an absent catalog against.
    return;
  }
  const strict = env.strictDefaultModels === true;
  const kinds: DefaultModelKind[] = ["chat", "image", "video"];

  // Promise.all shares the catalog's in-flight refresh (the router dedupes a
  // pending refresh), so this is one gateway round-trip for all three lists.
  const results = await Promise.all(
    kinds.map(async (kind): Promise<"ok" | "missing" | "fetch-error"> => {
      try {
        const models =
          kind === "chat"
            ? await resolvedCatalog.listChatModels()
            : kind === "image"
              ? await resolvedCatalog.listImageModels()
              : await resolvedCatalog.listVideoModels();
        return models.some((m) => m.id === resolveDefaultModelId(kind))
          ? "ok"
          : "missing";
      } catch {
        return "fetch-error";
      }
    }),
  );

  if (results.includes("fetch-error")) {
    logOperationalWarning(
      "[default-models] catalog fetch failed during boot smoke; skipping default validation (gateway may be temporarily unreachable).",
      SMOKE_CATEGORY,
    );
    return;
  }

  const missing = kinds.filter((_, idx) => results[idx] === "missing");
  if (missing.length === 0) return;

  const detail = missing
    .map((kind) => `${resolveDefaultModelId(kind)} (${kind})`)
    .join(", ");
  const message = `[default-models] default model(s) absent from ixicai /v1/models catalog: ${detail}. Update the shared DEFAULT_*_MODEL constant or restore the alias on the gateway.`;

  if (strict) {
    logOperationalFailure(
      `${message} (fatal; LOVART_STRICT_DEFAULT_MODELS=true)`,
      SMOKE_CATEGORY,
    );
    process.exit(1);
  } else {
    logOperationalWarning(
      `${message} (non-fatal; set LOVART_STRICT_DEFAULT_MODELS=true to block boot)`,
      SMOKE_CATEGORY,
    );
  }
}
