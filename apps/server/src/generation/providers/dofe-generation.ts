import type {
  GeneratedImage,
  GeneratedVideo,
  ImageGenerateParams,
  ImageProvider,
  ModelInfo,
  ProviderAuth,
  VideoGenerateParams,
  VideoModelInfo,
  VideoOperation,
  VideoProvider,
} from "../types.js";
import { GenerationError, aspectRatioToDimensions } from "../utils.js";

/**
 * DoFe (ixicai.cn) generation provider.
 *
 * All image and video models exposed by the gateway are produced through the
 * single multimodal_generation async protocol:
 *
 *   POST   {base}/generation/tasks      → { taskId, status, outputAssets? }
 *   GET    {base}/generation/tasks/:id  → poll until terminal
 *   GET    {base}/generation/tasks/:id/artifacts → { assets[] } (fallback)
 *
 * Authentication is per-user: each generate() call must carry the owning user's
 * design apikey via params.auth. There is no constructor-time key, so the
 * provider is a stateless singleton safe to share across requests.
 *
 * The gateway `/v1/models` catalog is the sole model-id authority. Both
 * providers start with an empty model list and are populated at boot by
 * `registerAllProviders` from `createDofeModelCatalog` (image + video alias
 * projection). Lovart does not maintain a second executable catalog here.
 */

const DEFAULT_BASE_URL = "https://ixicai.cn/api";
// The ixicai gateway serves every public surface under /v1: the OpenAI
// catalog at /v1/models and the multimodal generation ts-rest contract at
// /v1/generation/tasks (pathPrefix '/v1/generation' in @repo/contracts, no app
// global prefix). A path without /v1 404s — verified live against ixicai.cn.
const TASK_PATH = "/v1/generation/tasks";

const IMAGE_POLL_INTERVAL_MS = 2_000;
const IMAGE_POLL_TIMEOUT_MS = 240_000;
const VIDEO_POLL_INTERVAL_MS = 4_000;
const VIDEO_POLL_TIMEOUT_MS = 600_000;

// ─── Shared task protocol ────────────────────────────────────────────────────

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } }
  | { type: "video_url"; video_url: { url: string } };

type ContentRole = "prompt" | "reference" | "source_video" | "motion_reference";

type GenerationContentItem = {
  part: ContentPart;
  order: number;
  role?: ContentRole;
};

type TaskAsset = {
  assetId: string;
  type?: string;
  url: string;
  mimeType?: string;
  durationSeconds?: number;
  resolution?: string;
  ratio?: string;
};

type TaskResponse = {
  taskId: string;
  status: string;
  outputAssets?: TaskAsset[];
  errorCode?: string | null;
  errorMessage?: string | null;
};

type EndpointKind = "image_async" | "video_async";

function buildContent(
  prompt: string,
  inputImages?: string[],
): GenerationContentItem[] {
  const parts: ContentPart[] = [{ type: "text", text: prompt }];
  for (const url of inputImages ?? []) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts.map((part, order) => ({
    part,
    order,
    ...(part.type === "text"
      ? { role: "prompt" as const }
      : { role: "reference" as const }),
  }));
}

function buildVideoContent(
  prompt: string,
  inputImages: string[] | undefined,
  inputVideo: string | undefined,
  videoRole: "source_video" | "motion_reference" | undefined,
): GenerationContentItem[] {
  const items = buildContent(prompt, inputImages);
  if (inputVideo && videoRole) {
    items.push({
      part: { type: "video_url", video_url: { url: inputVideo } },
      order: items.length,
      role: videoRole,
    });
  }
  return items;
}

type ResolvedVideoOperation = {
  operation?: VideoOperation;
  videoRole?: "source_video" | "motion_reference";
};

function resolveVideoOperation(
  params: VideoGenerateParams,
  modelInfo: VideoModelInfo | undefined,
): ResolvedVideoOperation {
  if (!params.inputVideo) {
    return {};
  }

  if (modelInfo && !modelInfo.capabilities.videoToVideo) {
    throw new GenerationError(
      "dofe",
      "invalid_input",
      `Model ${params.model} does not support video-to-video operations.`,
    );
  }

  const operation = params.videoOperation ?? "video_edit";
  if (operation === "motion_control") {
    return { operation, videoRole: "motion_reference" };
  }
  if (operation === "video_edit" || operation === "video_extend") {
    return { operation, videoRole: "source_video" };
  }

  // Other operations are not valid when a source video is supplied. Reject
  // early so the gateway never receives an inconsistent request.
  throw new GenerationError(
    "dofe",
    "invalid_input",
    `videoOperation "${operation}" is not supported with inputVideo.`,
  );
}

function requireAuth(auth: ProviderAuth | undefined): string {
  const key = auth?.designApiKey;
  if (!key) {
    // Strict no-fallback: the dofe provider never falls back to a shared key.
    throw new GenerationError(
      "dofe",
      "credentials_missing",
      "DoFe generation requires per-user credentials (params.auth.designApiKey).",
    );
  }
  return key;
}

async function createTask(
  baseUrl: string,
  apiKey: string,
  body: {
    model: string;
    endpointKind: EndpointKind;
    content: GenerationContentItem[];
    params?: Record<string, unknown>;
  },
): Promise<TaskResponse> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}${TASK_PATH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...body, metadata: { source: "lovart.dofe.ai" } }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new GenerationError(
      "dofe",
      "transport_error",
      "DoFe createTask request did not complete.",
    );
  }
  if (response.status === 401 || response.status === 403) {
    throw new GenerationError(
      "dofe",
      "credentials_invalid",
      `DoFe rejected the user key (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    throw new GenerationError(
      "dofe",
      "api_error",
      `DoFe createTask failed with HTTP ${response.status}.`,
    );
  }
  return parseTaskResponse(await response.json(), "createTask");
}

async function getTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
): Promise<TaskResponse> {
  let response: Response;
  try {
    response = await fetch(
      `${baseUrl.replace(/\/$/, "")}${TASK_PATH}/${encodeURIComponent(taskId)}`,
      {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    throw new GenerationError(
      "dofe",
      "transport_error",
      "DoFe getTask request did not complete.",
    );
  }
  if (!response.ok) {
    throw new GenerationError(
      "dofe",
      "api_error",
      `DoFe getTask HTTP ${response.status} for task ${taskId}.`,
    );
  }
  return parseTaskResponse(await response.json(), "getTask");
}

/**
 * The generation endpoint is outside the SDK data client. Validate its
 * published task shape at the adapter boundary so malformed gateway responses
 * cannot be mistaken for terminal successes by the poller.
 */
function parseTaskResponse(payload: unknown, operation: string): TaskResponse {
  // Models responses are enveloped as `{ code, msg, data }`; accept a plain
  // task object too because the established task endpoint returns that shape in
  // some deployments. This is shape compatibility, not a local endpoint type.
  const data =
    isRecord(payload) && isRecord(payload.data)
      ? payload.data
      : isRecord(payload)
        ? payload
        : undefined;
  const taskId =
    typeof data?.taskId === "string"
      ? data.taskId
      : typeof data?.localTaskId === "string"
        ? data.localTaskId
        : undefined;
  if (!data || !taskId || typeof data.status !== "string") {
    throw new GenerationError(
      "dofe",
      "api_contract_error",
      `DoFe ${operation} returned an invalid task response.`,
    );
  }
  return {
    taskId,
    status: data.status,
    ...(Array.isArray(data.outputAssets)
      ? { outputAssets: data.outputAssets.filter(isTaskAsset) }
      : {}),
    ...(typeof data.errorCode === "string"
      ? { errorCode: data.errorCode }
      : {}),
  };
}

async function pollUntilTerminal(
  baseUrl: string,
  apiKey: string,
  initial: TaskResponse,
  intervalMs: number,
  timeoutMs: number,
): Promise<TaskResponse> {
  const startedAt = Date.now();
  let task = initial;
  // If the create response is already terminal, skip polling.
  while (isNonTerminal(task.status)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new GenerationError(
        "dofe",
        "api_error",
        `DoFe task ${task.taskId} timed out after ${timeoutMs}ms (status=${task.status}).`,
      );
    }
    await delay(intervalMs);
    task = await getTask(baseUrl, apiKey, task.taskId);
  }

  if (task.status !== "succeeded") {
    throw new GenerationError(
      "dofe",
      "task_failed",
      `DoFe task ${task.taskId} ended in ${task.status}.`,
    );
  }
  return task;
}

function isNonTerminal(status: string): boolean {
  return status === "pending" || status === "queued" || status === "running";
}

function firstAssetUrl(task: TaskResponse): { url: string; asset: TaskAsset } {
  const asset = task.outputAssets?.[0];
  if (!asset?.url) {
    throw new GenerationError(
      "dofe",
      "no_output",
      "DoFe task succeeded but produced no output asset.",
    );
  }
  return { url: asset.url, asset };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskAsset(value: unknown): value is TaskAsset {
  return (
    isRecord(value) &&
    typeof value.assetId === "string" &&
    typeof value.url === "string" &&
    (value.mimeType === undefined || typeof value.mimeType === "string") &&
    (value.durationSeconds === undefined ||
      typeof value.durationSeconds === "number")
  );
}

// ─── Providers ───────────────────────────────────────────────────────────────

export class DofeImageProvider implements ImageProvider {
  readonly name = "dofe";
  private currentModels: readonly ModelInfo[] = [];
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  get models(): readonly ModelInfo[] {
    return this.currentModels;
  }

  setModels(models: readonly ModelInfo[]): void {
    this.currentModels = models;
  }

  async generate(params: ImageGenerateParams): Promise<GeneratedImage> {
    const apiKey = requireAuth(params.auth);
    const { width, height } = aspectRatioToDimensions(
      params.aspectRatio ?? "1:1",
    );

    const task = await createTask(this.baseUrl, apiKey, {
      model: params.model,
      endpointKind: "image_async",
      content: buildContent(params.prompt, params.inputImages),
      // ImageGenerationParams supports { resolution?, count? }; pass the aspect
      // ratio as a WxH resolution (confirmed working across image models).
      params: { count: 1, resolution: `${width}x${height}` },
    });

    const terminal = await pollUntilTerminal(
      this.baseUrl,
      apiKey,
      task,
      IMAGE_POLL_INTERVAL_MS,
      IMAGE_POLL_TIMEOUT_MS,
    );
    const { url, asset } = firstAssetUrl(terminal);
    return {
      url,
      mimeType: asset.mimeType ?? "image/png",
      width,
      height,
    };
  }
}

export class DofeVideoProvider implements VideoProvider {
  readonly name = "dofe";
  private currentModels: readonly VideoModelInfo[] = [];
  constructor(private readonly baseUrl: string = DEFAULT_BASE_URL) {}

  get models(): readonly VideoModelInfo[] {
    return this.currentModels;
  }

  setModels(models: readonly VideoModelInfo[]): void {
    this.currentModels = models;
  }

  async generate(params: VideoGenerateParams): Promise<GeneratedVideo> {
    const apiKey = requireAuth(params.auth);
    const resolution = params.resolution ?? "720p";
    const { width, height } = aspectRatioToDimensions(
      params.aspectRatio ?? "16:9",
    );

    const modelInfo = this.models.find((m) => m.id === params.model);
    const { operation, videoRole } = resolveVideoOperation(params, modelInfo);

    const task = await createTask(this.baseUrl, apiKey, {
      model: params.model,
      endpointKind: "video_async",
      content: buildVideoContent(
        params.prompt,
        params.inputImages,
        params.inputVideo,
        videoRole,
      ),
      params: {
        ratio: params.aspectRatio,
        resolution,
        ...(params.duration ? { duration: params.duration } : {}),
        ...(typeof params.enableAudio === "boolean"
          ? { generateAudio: params.enableAudio }
          : {}),
        ...(operation ? { videoOperation: operation } : {}),
      },
    });

    const terminal = await pollUntilTerminal(
      this.baseUrl,
      apiKey,
      task,
      VIDEO_POLL_INTERVAL_MS,
      VIDEO_POLL_TIMEOUT_MS,
    );
    const { url, asset } = firstAssetUrl(terminal);
    return {
      url,
      mimeType: asset.mimeType ?? "video/mp4",
      width,
      height,
      durationSeconds: asset.durationSeconds ?? params.duration ?? 5,
    };
  }
}
