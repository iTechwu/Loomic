import type {
  BaseCheckpointSaver,
  BaseStore,
} from "@langchain/langgraph-checkpoint";
import type { BaseLanguageModel } from "@langchain/core/language_models/base";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatVertexAI } from "@langchain/google-vertexai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { createDeepAgent } from "deepagents";

import {
  DEFAULT_AGENT_MODEL,
  DEFAULT_GOOGLE_AGENT_MODEL,
  type ServerEnv,
} from "../config/env.js";
import {
  dofeModelProtocolBaseUrl,
  hasDofeModelRouter,
  resolveDofeModelProtocol,
  toDofeRouterModelId,
} from "../models/dofe-model-router.js";
import type { ConnectionManager } from "../ws/connection-manager.js";
import {
  createAgentBackend,
  type AgentBackendResult,
} from "./backends/index.js";
import { LOVART_DOFE_SYSTEM_PROMPT } from "./prompts/lovart-dofe-main.js";
import { createVideoSubAgent } from "./sub-agents.js";
import { createMainAgentTools } from "./tools/index.js";
import type {
  PersistImageFn,
  SubmitImageJobFn,
} from "./tools/image-generate.js";
import type { SubmitVideoJobFn } from "./tools/video-generate.js";
import type { WorkspaceSkillEntry } from "./workspace-skills.js";
import type { NativeDataRepository } from "../database/native-data-repository.js";
import type { TosObjectStorage } from "../storage/tos-object-storage.js";
import type { BrandKitService } from "../features/brand-kit/brand-kit-service.js";

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
        return new ChatOpenAI({
          model: modelName,
          apiKey: routerKey,
          configuration: { baseURL: baseUrl },
          streaming: true,
          // Upstream protocols do not all provide OpenAI usage chunks.
          streamUsage: false,
        });
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
