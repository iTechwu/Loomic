import { ChatAnthropic } from "@langchain/anthropic";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatVertexAI } from "@langchain/google-vertexai";
import type {
  BaseCheckpointSaver,
  BaseStore,
} from "@langchain/langgraph-checkpoint";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";

import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_GOOGLE_AGENT_MODEL,
  type ServerEnv,
} from "../config/env.js";
import type { NativeDataRepository } from "../database/native-data-repository.js";
import type { BrandKitService } from "../features/brand-kit/brand-kit-service.js";
import {
  dofeModelProtocolBaseUrl,
  hasDofeModelRouter,
  resolveDofeModelProtocol,
  toDofeRouterModelId,
} from "../models/dofe-model-router.js";
import type { TosObjectStorage } from "../storage/tos-object-storage.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import {
  type AgentBackendResult,
  createAgentBackend,
} from "./backends/index.js";
import { LOVART_DOFE_SYSTEM_PROMPT } from "./prompts/lovart-dofe-main.js";
import { createVideoSubAgent } from "./sub-agents.js";
import type {
  PersistImageFn,
  SubmitImageJobFn,
} from "./tools/image-generate.js";
import { createMainAgentTools } from "./tools/index.js";
import type { SubmitVideoJobFn } from "./tools/video-generate.js";
import type { WorkspaceSkillEntry } from "./workspace-skills.js";

const DOFE_PRIMARY_CHAT_MODEL = "glm-5.2";
/**
 * Ordered vision-capable fallback chain consulted whenever the primary
 * (glm-5.2, text-only) cannot serve a turn — either because the request carries
 * an image (proactive: skips a wasted 400 round-trip) or because the primary
 * hit a qualifying availability error (reactive safety net). Entries are tried
 * in order; we advance to the next only while no output has been emitted yet,
 * so a streaming response is never restarted mid-flight (which would duplicate
 * an agent action).
 *
 * Every entry is empirically confirmed vision- AND function-calling-capable on
 * the ixicai gateway (verified 2026-07). The gateway `supports_vision` flag is
 * deliberately ignored — it returns false for every model, including these.
 * NB: deepseek-v4-pro is excluded on purpose — it silently strips image parts
 * and answers as if blind (no error surfaced), strictly worse than glm-5.2's
 * explicit 400. Before adding an entry, verify vision empirically (the flag
 * lies); see the probe notes in the module history.
 */
const DOFE_VISION_FALLBACK_MODELS = ["kimi-k3", "qwen3.6-plus"] as const;
const FALLBACK_HTTP_STATUSES = new Set([
  402, 403, 404, 408, 409, 429, 500, 502, 503, 504,
]);

type ChatOpenAIOptions = NonNullable<
  ConstructorParameters<typeof ChatOpenAI>[0]
>;

function getHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as {
    status?: unknown;
    response?: { status?: unknown };
  };
  if (typeof candidate.status === "number") return candidate.status;
  if (typeof candidate.response?.status === "number") {
    return candidate.response.status;
  }
  return undefined;
}

function hasImageInput(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => {
    const content =
      message && typeof message === "object" && "content" in message
        ? (message as { content?: unknown }).content
        : undefined;
    return (
      Array.isArray(content) &&
      content.some(
        (part) =>
          part &&
          typeof part === "object" &&
          (part as { type?: unknown }).type === "image_url",
      )
    );
  });
}

/**
 * Decide whether a primary-model error should trigger the vision fallback. Pure
 * utility (exercised in isolation by tests); not on the production agent
 * invocation path — see the DofeFallbackChatOpenAI note below.
 */
export function shouldUseDofeFallback(
  error: unknown,
  hasImageInput = false,
): boolean {
  const status = getHttpStatus(error);
  if (status !== undefined && FALLBACK_HTTP_STATUSES.has(status)) return true;

  // GLM-5.2 is text-only; the ordered vision chain (kimi-k3 → qwen3.6-plus, see
  // DOFE_VISION_FALLBACK_MODELS) handles image input. NOTE: the gateway
  // /capabilities `supports_vision` flag is unreliable — it returns false for
  // every model, including the vision-capable ones, so capability is confirmed
  // empirically rather than read from that field. This branch is the reactive
  // safety net for a 400 image error that slipped past the proactive check in
  // DofeFallbackChatOpenAI below.
  return (
    status === 400 &&
    (hasImageInput ||
      (error instanceof Error &&
        /model do not support image input/i.test(error.message)))
  );
}

/**
 * Keep the ChatOpenAI surface (especially bindTools) intact while routing a turn
 * the primary cannot serve — image input or a qualifying availability failure —
 * through an ordered vision-capable fallback chain. Output is never restarted
 * once started: we advance to the next chain entry only while no chunk has been
 * emitted yet, so an agent action can't be duplicated.
 *
 * NOTE (2026-07): BYPASSED in production. The langchain agent runtime invokes
 * the model via bindTools(...).invoke(...), which reaches the OpenAI network
 * call WITHOUT calling a ChatOpenAI subclass's overridden
 * _generate/_streamResponseChunks (verified empirically). So this class does NOT
 * route images in the live agent path — production routing is per-run in
 * runtime.ts via selectChatModelSpecifierForRun. Kept only as a direct-call
 * safety net; do not rely on it for the agent path.
 */
class DofeFallbackChatOpenAI extends ChatOpenAI {
  constructor(
    fields: ChatOpenAIOptions,
    private readonly fallbacks: ChatOpenAI[],
  ) {
    super(fields);
  }

  override async _generate(...args: Parameters<ChatOpenAI["_generate"]>) {
    // Proactive routing: glm-5.2 is text-only, so if this request carries an
    // image, skip the primary entirely and walk the vision chain. Avoids a
    // wasted 400 round-trip on every image turn.
    if (hasImageInput(args[0])) {
      console.warn("[model-router] image_input_routed_to_vision_chain", {
        primary: this.model,
        visionChain: this.fallbacks.map((fallback) => fallback.model),
      });
      return this.generateThroughVisionChain(args);
    }
    try {
      return await super._generate(...args);
    } catch (error) {
      if (!shouldUseDofeFallback(error, hasImageInput(args[0]))) throw error;
      console.warn(
        "[model-router] primary_model_unavailable_using_vision_chain",
        {
          primary: this.model,
          visionChain: this.fallbacks.map((fallback) => fallback.model),
          status: getHttpStatus(error),
        },
      );
      return this.generateThroughVisionChain(args);
    }
  }

  override async *_streamResponseChunks(
    ...args: Parameters<ChatOpenAI["_streamResponseChunks"]>
  ) {
    // Proactive routing: see _generate — route image turns straight to the
    // vision chain without first failing against the primary.
    if (hasImageInput(args[0])) {
      console.warn("[model-router] image_input_routed_to_vision_chain", {
        primary: this.model,
        visionChain: this.fallbacks.map((fallback) => fallback.model),
      });
      yield* this.streamThroughVisionChain(args);
      return;
    }
    let started = false;
    try {
      for await (const chunk of super._streamResponseChunks(...args)) {
        started = true;
        yield chunk;
      }
    } catch (error) {
      if (started || !shouldUseDofeFallback(error, hasImageInput(args[0]))) {
        throw error;
      }
      console.warn(
        "[model-router] primary_model_unavailable_using_vision_chain",
        {
          primary: this.model,
          visionChain: this.fallbacks.map((fallback) => fallback.model),
          status: getHttpStatus(error),
        },
      );
      yield* this.streamThroughVisionChain(args);
    }
  }

  /**
   * Walk the vision chain for a non-streaming generate, returning the first
   * successful result. _generate either fully resolves or rejects before any
   * output reaches the caller, so every failure here is safe to retry on the
   * next entry.
   */
  private async generateThroughVisionChain(
    args: Parameters<ChatOpenAI["_generate"]>,
  ): ReturnType<ChatOpenAI["_generate"]> {
    let lastError: unknown = new Error("vision fallback chain is empty");
    for (const [index, fallback] of this.fallbacks.entries()) {
      try {
        return await fallback._generate(...args);
      } catch (error) {
        lastError = error;
        console.warn("[model-router] vision_chain_model_failed", {
          failed: fallback.model,
          status: getHttpStatus(error),
          willRetry: index < this.fallbacks.length - 1,
        });
      }
    }
    throw lastError;
  }

  /**
   * Stream the vision chain, delegating to the first entry that completes. We
   * advance to the next entry only while the current one has emitted no chunk
   * yet — once bytes have flowed, restarting would duplicate an agent action, so
   * a mid-stream failure is rethrown as-is.
   */
  private async *streamThroughVisionChain(
    args: Parameters<ChatOpenAI["_streamResponseChunks"]>,
  ) {
    let lastError: unknown = new Error("vision fallback chain is empty");
    for (const [index, fallback] of this.fallbacks.entries()) {
      let emitted = false;
      try {
        for await (const chunk of fallback._streamResponseChunks(...args)) {
          emitted = true;
          yield chunk;
        }
        return;
      } catch (error) {
        lastError = error;
        if (emitted) throw error;
        console.warn("[model-router] vision_chain_model_failed", {
          failed: fallback.model,
          status: getHttpStatus(error),
          willRetry: index < this.fallbacks.length - 1,
        });
      }
    }
    throw lastError;
  }
}

function createDofeOpenAIChatModel(
  model: string,
  apiKey: string,
  baseURL: string,
): ChatOpenAI {
  return new ChatOpenAI({
    model,
    apiKey,
    configuration: { baseURL },
    streaming: true,
    // Upstream protocols do not all provide OpenAI usage chunks.
    streamUsage: false,
  });
}

function createDofeOpenAIChatModelWithFallback(
  model: string,
  apiKey: string,
  baseURL: string,
): ChatOpenAI {
  const primary = {
    model,
    apiKey,
    configuration: { baseURL },
    streaming: true,
    streamUsage: false,
  } satisfies ChatOpenAIOptions;
  if (model !== DOFE_PRIMARY_CHAT_MODEL) return new ChatOpenAI(primary);

  const visionChain = DOFE_VISION_FALLBACK_MODELS.map((id) =>
    createDofeOpenAIChatModel(id, apiKey, baseURL),
  );
  return new DofeFallbackChatOpenAI(primary, visionChain);
}

export type LovartDofeAgent = Pick<
  ReturnType<typeof createDeepAgent>,
  "stream" | "streamEvents"
>;

export type LovartDofeAgentFactory = (options: {
  backendResult?: AgentBackendResult;
  brandKitId?: string | null;
  canvasId?: string;
  checkpointer?: BaseCheckpointSaver;
  connectionManager?: ConnectionManager;
  brandKitService: BrandKitService;
  dataRepository: NativeDataRepository;
  env: ServerEnv;
  model?: BaseLanguageModel | string;
  /**
   * Per-user models credential. When set, the DoFe router authenticates as the
   * user (strict per-user isolation). When absent, falls back to the shared
   * DOFE_MODEL_API_KEY — kept only for non-user contexts such as catalog probes.
   */
  credentials?: { designApiKey: string };
  persistImage?: PersistImageFn;
  objectStorage: TosObjectStorage;

  submitImageJob?: SubmitImageJobFn;
  submitVideoJob?: SubmitVideoJobFn;
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}) => LovartDofeAgent;

export function createLovartDofeDeepAgent(options: {
  backendResult?: AgentBackendResult;
  brandKitId?: string | null;
  canvasId?: string;
  checkpointer?: BaseCheckpointSaver;
  connectionManager?: ConnectionManager;
  brandKitService: BrandKitService;
  dataRepository: NativeDataRepository;
  env: ServerEnv;
  model?: BaseLanguageModel | string;
  /**
   * Per-user models credential. When set, the DoFe router authenticates as the
   * user (strict per-user isolation). When absent, falls back to the shared
   * DOFE_MODEL_API_KEY — kept only for non-user contexts such as catalog probes.
   */
  credentials?: { designApiKey: string };
  persistImage?: PersistImageFn;
  objectStorage: TosObjectStorage;

  submitImageJob?: SubmitImageJobFn;
  submitVideoJob?: SubmitVideoJobFn;
  store?: BaseStore;
  workspaceSkills?: WorkspaceSkillEntry[];
}): LovartDofeAgent {
  const backendResult =
    options.backendResult ?? createAgentBackend(options.env, options.canvasId);

  const modelSpec = options.model ?? createDefaultModelSpecifier(options.env);
  const resolvedModel =
    typeof modelSpec === "string"
      ? createStreamingChatModel(modelSpec, options.env, options.credentials)
      : modelSpec;

  let systemPrompt = options.brandKitId
    ? LOVART_DOFE_SYSTEM_PROMPT +
      "\n\n当前项目已绑定品牌套件。在进行设计相关工作时，请先使用 get_brand_kit 工具查询品牌信息，确保设计符合品牌规范。"
    : LOVART_DOFE_SYSTEM_PROMPT;

  // Inject enabled skills (both system and user-created) into the system prompt.
  // All skills are loaded from the database via loadWorkspaceSkills() in runtime.ts.
  const wsSkills = options.workspaceSkills ?? [];
  if (wsSkills.length > 0) {
    const skillsList = wsSkills
      .map((s) => {
        let line = `- **${s.name}**: ${s.description}\n  → Read \`${s.path}\` for full instructions`;
        if (s.files.length > 0) {
          const counts: Record<string, number> = {};
          for (const f of s.files) {
            const dir = f.path.split("/")[0] ?? "other";
            counts[dir] = (counts[dir] ?? 0) + 1;
          }
          const summary = Object.entries(counts)
            .map(([dir, n]) => `${dir}/ (${n})`)
            .join(", ");
          line += `\n  → Has: ${summary}`;
        }
        return line;
      })
      .join("\n");
    systemPrompt += `\n\n## Skills\n\nThe following skills are enabled in this workspace:\n${skillsList}`;
  }

  return createDeepAgent({
    backend: backendResult.factory,
    ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    model: resolvedModel,
    name: "lovart-dofe",
    ...(options.store ? { store: options.store } : {}),
    subagents: [createVideoSubAgent()],
    systemPrompt,
    tools: createMainAgentTools(backendResult.factory, {
      brandKitService: options.brandKitService,
      dataRepository: options.dataRepository,
      objectStorage: options.objectStorage,
      ...(options.brandKitId != null ? { brandKitId: options.brandKitId } : {}),
      ...(options.connectionManager
        ? { connectionManager: options.connectionManager }
        : {}),
      ...(options.persistImage ? { persistImage: options.persistImage } : {}),
      ...(backendResult.sandboxDir
        ? { sandboxDir: backendResult.sandboxDir }
        : {}),

      ...(options.submitImageJob
        ? { submitImageJob: options.submitImageJob }
        : {}),
      ...(options.submitVideoJob
        ? { submitVideoJob: options.submitVideoJob }
        : {}),
    }),
  });
}

/**
 * Create a streaming chat model from a `<provider>:<model-id>` specifier.
 *
 * With DOFE_MODEL_* configured, the model family selects the gateway's native
 * namespace: Gemini → /gemini, Claude → /anthropic, all other text models →
 * OpenAI-compatible /v1. Direct vendor clients are only used without a router.
 */
export function createStreamingChatModel(
  specifier: string,
  env: Pick<
    ServerEnv,
    | "dofeModelApiKey"
    | "dofeModelBaseUrl"
    | "googleApiKey"
    | "googleVertexLocation"
    | "googleVertexProject"
    | "openAIApiBase"
    | "openAIApiKey"
  >,
  credentials?: { designApiKey: string },
): BaseLanguageModel {
  // The router authenticates with the user's provisioned designApiKey when
  // available (strict per-user isolation), otherwise the shared
  // DOFE_MODEL_API_KEY (non-user contexts only). The router is usable whenever
  // the gateway base URL is configured AND some key is available.
  const routerKey = credentials?.designApiKey ?? env.dofeModelApiKey;
  if (env.dofeModelBaseUrl && routerKey) {
    const modelName = toDofeRouterModelId(specifier);
    const protocol = resolveDofeModelProtocol(modelName);
    const baseUrl = dofeModelProtocolBaseUrl(env.dofeModelBaseUrl, protocol);
    console.info("[model-router] agent_model_routed", {
      model: modelName,
      protocol,
      endpoint: baseUrl,
      keySource: credentials?.designApiKey ? "user_credential" : "global_env",
    });

    switch (protocol) {
      case "gemini":
        return new ChatGoogleGenerativeAI({
          model: modelName,
          // @google/generative-ai always emits x-goog-api-key from apiKey and
          // reserves that header from custom overrides. The DoFe data plane
          // authenticates this service with Bearer, so use a truthy whitespace
          // placeholder that the gateway treats as an absent Google key.
          apiKey: " ",
          baseUrl,
          // Keep the router credential out of the Google-specific header.
          customHeaders: { Authorization: `Bearer ${routerKey}` },
          streaming: true,
          streamUsage: false,
        });
      case "anthropic":
        return new ChatAnthropic({
          model: modelName,
          apiKey: routerKey,
          clientOptions: { baseURL: baseUrl },
          streaming: true,
          streamUsage: false,
        });
      case "openai":
        return createDofeOpenAIChatModelWithFallback(
          modelName,
          routerKey,
          baseUrl,
        );
    }
  }

  const colonIdx = specifier.indexOf(":");
  let provider = colonIdx > 0 ? specifier.slice(0, colonIdx) : "openai";
  let modelName = colonIdx > 0 ? specifier.slice(colonIdx + 1) : specifier;

  const hasGoogleApiKey = !!env.googleApiKey;
  const hasVertexAI = !!(env.googleVertexProject && env.googleVertexLocation);
  const hasGoogle = hasGoogleApiKey || hasVertexAI;

  // Provider availability fallback
  if (provider === "google" && !hasGoogle) {
    console.warn(
      `[model] Google unavailable (no GOOGLE_API_KEY or Vertex AI config), falling back to OpenAI for: ${specifier}`,
    );
    provider = "openai";
    modelName = DEFAULT_AGENT_MODEL;
  }
  if (provider === "openai" && !env.openAIApiKey && hasGoogle) {
    console.warn(
      `[model] OpenAI unavailable (no OPENAI_API_KEY), falling back to Google for: ${specifier}`,
    );
    provider = "google";
    modelName = DEFAULT_GOOGLE_AGENT_MODEL;
  }

  switch (provider) {
    case "google":
      // Prefer Vertex AI (service account) when configured; fall back to Developer API key
      if (hasVertexAI) {
        const vertexProject = env.googleVertexProject!;
        const vertexLocation = env.googleVertexLocation!;
        console.log(
          `[model] Using Vertex AI for: ${modelName} (project=${vertexProject}, location=${vertexLocation})`,
        );
        return new ChatVertexAI({
          model: modelName,
          location: vertexLocation,
          authOptions: { projectId: vertexProject },
          streaming: true,
        });
      }
      return new ChatGoogleGenerativeAI({
        model: modelName,
        apiKey: env.googleApiKey!,
        streaming: true,
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: -1, // dynamic — let the model decide
        },
      });
    case "openai":
    default:
      if (!env.openAIApiKey) {
        throw new Error(
          "No DOFE_MODEL_* router or direct OpenAI/Google model provider is configured.",
        );
      }
      return new ChatOpenAI({
        model: modelName,
        apiKey: env.openAIApiKey,
        ...(env.openAIApiBase
          ? { configuration: { baseURL: env.openAIApiBase } }
          : {}),
        streaming: true,
        streamUsage: false,
      });
  }
}

/** Known model-name prefixes that map to Google Gemini. */
const GOOGLE_MODEL_PREFIXES = ["gemini-"];

/**
 * Per-message model selection. glm-5.2 (the default chat model) is text-only,
 * so a message carrying an image attachment must run on a vision-capable model.
 *
 * This is done per-run in runtime.ts (each user message = one run = one freshly
 * built agent) rather than by overriding ChatOpenAI._generate. The langchain
 * agent runtime invokes the model through a path that does NOT call a
 * ChatOpenAI subclass's overridden `_generate`/`_streamResponseChunks` —
 * `bindTools(...).invoke(...)` reaches the OpenAI network call directly
 * (verified empirically), so any subclass-based routing silently never fires in
 * production. Building the agent with the right model routes at message
 * granularity without depending on that (bypassed) override path.
 *
 * Returns the first vision-capable model for image turns on the text-only
 * default; an explicit non-glm model chosen by the user is passed through.
 */
export function selectChatModelSpecifierForRun(
  specifier: string | undefined,
  hasImage: boolean,
): string | undefined {
  if (!hasImage) return specifier;
  const modelId = specifier
    ? toDofeRouterModelId(specifier)
    : DOFE_PRIMARY_CHAT_MODEL;
  if (modelId !== DOFE_PRIMARY_CHAT_MODEL) return specifier;
  return `dofe:${DOFE_VISION_FALLBACK_MODELS[0]}`;
}

export function createDefaultModelSpecifier(
  env: Pick<ServerEnv, "agentModel" | "dofeModelApiKey" | "dofeModelBaseUrl">,
) {
  const model = env.agentModel;
  if (hasDofeModelRouter(env)) return `dofe:${toDofeRouterModelId(model)}`;
  // Already has an explicit provider prefix — pass through as-is.
  if (model.includes(":")) return model;
  // Auto-detect Google models by name prefix.
  if (GOOGLE_MODEL_PREFIXES.some((p) => model.startsWith(p)))
    return `google:${model}`;
  return `openai:${model}`;
}
export function applyOpenAICompatEnv(
  env: Pick<ServerEnv, "openAIApiBase" | "openAIApiKey">,
  target: NodeJS.ProcessEnv = process.env,
) {
  if (env.openAIApiKey) {
    target.OPENAI_API_KEY = env.openAIApiKey;
  }

  if (env.openAIApiBase) {
    target.OPENAI_BASE_URL = env.openAIApiBase;
  }
}
