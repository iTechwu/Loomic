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
// createTask is SYNCHRONOUS on the ixicai gateway: the POST connection is held
// open until the generation finishes and the terminal status + presigned output
// URL are returned in the same response (verified live: gpt-image-2-sp returns
// HTTP 201 after ~53s, flux-pro-1.1 after ~8s). The earlier 30s budget aborted
// slow models mid-generation and reported a misleading "createTask request did
// not complete". This must cover the slowest model's wall-clock time; the cost
// is a long-lived POST, which is inherent to the gateway's sync task contract.
const CREATE_TASK_TIMEOUT_MS = 180_000;

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

function getVideoCapabilityMetadata(
  params: VideoGenerateParams,
  modelInfo: VideoModelInfo | undefined,
) {
  const capabilityName = params.inputVideo
    ? "video_to_video"
    : params.inputImages?.length
      ? "image_to_video"
      : "text_to_video";
  return modelInfo?.capabilityMetadata?.[capabilityName];
}

function validateVideoParams(
  params: VideoGenerateParams,
  modelInfo: VideoModelInfo | undefined,
): void {
  const metadata = getVideoCapabilityMetadata(params, modelInfo);
  if (!metadata) return;

  if (
    params.resolution &&
    metadata.resolutions &&
    !metadata.resolutions.includes(params.resolution)
  ) {
    throw new GenerationError(
      "dofe",
      "invalid_input",
      `Model ${params.model} does not support resolution ${params.resolution}.`,
    );
  }
  if (
    params.aspectRatio &&
    metadata.ratios &&
    !metadata.ratios.includes(params.aspectRatio)
  ) {
    throw new GenerationError(
      "dofe",
      "invalid_input",
      `Model ${params.model} does not support aspect ratio ${params.aspectRatio}.`,
    );
  }
  const duration = metadata.durationSeconds;
  if (
    params.duration !== undefined &&
    ((duration?.min !== undefined && params.duration < duration.min) ||
      (duration?.max !== undefined && params.duration > duration.max))
  ) {
    throw new GenerationError(
      "dofe",
      "invalid_input",
      `Model ${params.model} does not support duration ${params.duration}s.`,
    );
  }
  if (
    metadata.maxInputAssets !== undefined &&
    (params.inputImages?.length ?? 0) > metadata.maxInputAssets
  ) {
    throw new GenerationError(
      "dofe",
      "invalid_input",
      `Model ${params.model} supports at most ${metadata.maxInputAssets} input assets.`,
    );
  }
  if (params.enableAudio === true && metadata.supportsGenerateAudio === false) {
    throw new GenerationError(
      "dofe",
      "invalid_input",
      `Model ${params.model} does not support audio generation.`,
    );
  }
}

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
  const url = buildTaskUrl(baseUrl);
  console.info("[dofe-generation] createTask start", {
    model: body.model,
    endpointKind: body.endpointKind,
    url,
  });
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          ...body,
          metadata: { source: "lovart.dofe.ai" },
        }),
        // Sync task contract: the gateway holds the connection until the
        // generation is done (see CREATE_TASK_TIMEOUT_MS), so this is the full
        // generation budget, not just a handshake.
        signal: AbortSignal.timeout(CREATE_TASK_TIMEOUT_MS),
      },
      // createTask is NOT idempotent: every POST mints a new gateway task and
      // bills the user (e.g. ~$0.20/image for gpt-image-2-sp). Retrying on a
      // timeout would create duplicate tasks that all complete server-side
      // while we discard every response — the old attempts:3 path generated 3
      // images and charged 3× before failing. Keep attempts at 1 and let the
      // job-level retry in worker.processMessage handle genuinely transient
      // transport failures instead.
      { label: "createTask", attempts: 1, backoffMs: 1_000 },
    );
  } catch (error) {
    const cause =
      error instanceof Error
        ? (error as Error & { cause?: Error }).cause?.message
        : undefined;
    console.error("[dofe-generation] createTask request did not complete", {
      model: body.model,
      url,
      elapsedMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      ...(cause ? { cause } : {}),
    });
    throw new GenerationError(
      "dofe",
      "transport_error",
      "DoFe createTask request did not complete.",
    );
  }

  console.info("[dofe-generation] createTask response", {
    model: body.model,
    status: response.status,
    elapsedMs: Date.now() - startedAt,
  });

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
  const url = buildTaskUrl(baseUrl, `/${encodeURIComponent(taskId)}`);
  let response: Response;
  try {
    response = await fetchWithRetry(
      url,
      {
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(20_000),
      },
      { label: "getTask", attempts: 3, backoffMs: 1_000 },
    );
  } catch (error) {
    const cause =
      error instanceof Error
        ? (error as Error & { cause?: Error }).cause?.message
        : undefined;
    console.error("[dofe-generation] getTask request did not complete", {
      taskId,
      url,
      error: error instanceof Error ? error.message : String(error),
      ...(cause ? { cause } : {}),
    });
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
    try {
      task = await getTask(baseUrl, apiKey, task.taskId);
      console.info("[dofe-generation] poll status", {
        taskId: task.taskId,
        status: task.status,
        elapsedMs: Date.now() - startedAt,
      });
    } catch (error) {
      console.warn("[dofe-generation] poll getTask failed", {
        taskId: task.taskId,
        status: task.status,
        elapsedMs: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      // Re-throw on terminal-ish failures; allow the outer loop to retry
      // transient network errors up to the overall timeout.
      throw error;
    }
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
  // Reject malformed URLs before downstream consumers try to fetch them. The
  // gateway should always return absolute https URLs, but defensive parsing
  // turns confusing DNS errors (e.g. getaddrinfo ENOTFOUND dofe-system.https)
  // into an explicit contract error.
  let validated: URL;
  try {
    validated = new URL(asset.url);
  } catch {
    throw new GenerationError(
      "dofe",
      "api_contract_error",
      `DoFe task returned an invalid output asset URL: ${asset.url.slice(0, 200)}`,
    );
  }
  if (validated.protocol !== "https:" && validated.protocol !== "http:") {
    throw new GenerationError(
      "dofe",
      "api_contract_error",
      `DoFe task returned an unsupported asset URL protocol: ${validated.protocol}`,
    );
  }
  return { url: validated.toString(), asset };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Network-level failures (DNS, TCP, TLS, reset, timeout) are distinct from HTTP
 * error responses. Retry them a small number of times because ixicai.cn can be
 * flaky on the first handshake, especially from overseas/local dev networks.
 */
function isRetryableNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("abort") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    message.includes("enotfound") ||
    message.includes("econnrefused") ||
    message.includes("socket") ||
    message.includes("connect") ||
    message.includes("und_err")
  );
}

async function fetchWithRetry(
  input: string,
  init: RequestInit | undefined,
  options: { label: string; attempts: number; backoffMs: number },
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.attempts; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      const cause =
        error instanceof Error
          ? (error as Error & { cause?: Error }).cause?.message
          : undefined;
      console.warn(
        `[dofe-generation] ${options.label} network attempt ${attempt}/${options.attempts} failed`,
        {
          url: typeof input === "string" ? input : "[Request]",
          error: error instanceof Error ? error.message : String(error),
          ...(cause ? { cause } : {}),
        },
      );
      if (attempt < options.attempts && isRetryableNetworkError(error)) {
        await delay(options.backoffMs * attempt);
        continue;
      }
      break;
    }
  }
  throw lastError;
}

/**
 * Build the generation endpoint URL and guard against the common misconfiguration
 * where the base URL drifts away from `/api` or the path loses `/v1`.
 */
function buildTaskUrl(baseUrl: string, suffix = ""): string {
  const normalized = baseUrl.replace(/\/$/, "");
  const full = `${normalized}${TASK_PATH}${suffix}`;
  if (!full.includes("/api/v1/generation/tasks")) {
    throw new GenerationError(
      "dofe",
      "config_error",
      `DoFe generation URL does not point to /api/v1/generation/tasks: ${full}`,
    );
  }
  return full;
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

    console.info("[dofe-generation] generate image start", {
      model: params.model,
      aspectRatio: params.aspectRatio ?? "1:1",
      resolution: `${width}x${height}`,
    });
    const startedAt = Date.now();

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
    console.info("[dofe-generation] generate image done", {
      model: params.model,
      elapsedMs: Date.now() - startedAt,
      taskId: terminal.taskId,
      status: terminal.status,
      // The gateway returns an already-presigned TOS URL. Log the signing
      // state + length instead of a truncated prefix: a prior url.slice(0, 80)
      // cut off the X-Tos-Signature query string and made a valid presigned
      // URL look unsigned, sending investigation down the wrong path.
      assetSigned: url.includes("X-Tos-Signature"),
      assetUrlLength: url.length,
      assetHost: new URL(url).host,
      mimeType: asset.mimeType ?? "image/png",
      width,
      height,
    });
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
    const { width, height } = aspectRatioToDimensions(
      params.aspectRatio ?? "16:9",
    );

    console.info("[dofe-generation] generate video start", {
      model: params.model,
      aspectRatio: params.aspectRatio ?? "16:9",
    });
    const startedAt = Date.now();

    const modelInfo = this.models.find((m) => m.id === params.model);
    const { operation, videoRole } = resolveVideoOperation(params, modelInfo);
    validateVideoParams(params, modelInfo);

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
        ...(params.aspectRatio ? { ratio: params.aspectRatio } : {}),
        ...(params.resolution ? { resolution: params.resolution } : {}),
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
    console.info("[dofe-generation] generate video done", {
      model: params.model,
      elapsedMs: Date.now() - startedAt,
      taskId: terminal.taskId,
      status: terminal.status,
      // See generate image done: log signing state + length, not a truncated
      // prefix that hides the X-Tos-Signature query string.
      assetSigned: url.includes("X-Tos-Signature"),
      assetUrlLength: url.length,
      assetHost: new URL(url).host,
    });
    return {
      url,
      mimeType: asset.mimeType ?? "video/mp4",
      width,
      height,
      durationSeconds: asset.durationSeconds ?? params.duration ?? 5,
    };
  }
}
