import type {
  GeneratedImage,
  GeneratedVideo,
  ImageGenerateParams,
  ImageProvider,
  ModelInfo,
  ProviderAuth,
  VideoGenerateParams,
  VideoModelInfo,
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
 * Runtime model IDs are loaded from the authenticated ixicai catalog. The
 * exported lists below are retained for source compatibility only; providers
 * start empty and are populated from `/v1/models` plus capabilities.
 */

const DEFAULT_BASE_URL = "https://ixicai.cn/api";
// The ixicai OpenAI-compatible catalog is served under /v1, but multimodal
// generation is a separate ts-rest contract rooted at /generation.
const TASK_PATH = "/generation/tasks";

const IMAGE_POLL_INTERVAL_MS = 2_000;
const IMAGE_POLL_TIMEOUT_MS = 240_000;
const VIDEO_POLL_INTERVAL_MS = 4_000;
const VIDEO_POLL_TIMEOUT_MS = 600_000;

// ─── Catalogs ───────────────────────────────────────────────────────────────

export const DOFE_IMAGE_MODELS: readonly ModelInfo[] = [
  img(
    "flux-kontext-pro",
    "Flux Kontext Pro",
    "High-fidelity context-aware image editing and generation.",
  ),
  img(
    "flux-kontext-max",
    "Flux Kontext Max",
    "Top-tier Flux quality for demanding image tasks.",
  ),
  img(
    "bytedance-seedream-4.5",
    "Seedream 4.5",
    "ByteDance Seedream 4.5 — versatile photoreal generation.",
  ),
  img(
    "bytedance-seedream-5.0",
    "Seedream 5.0",
    "ByteDance Seedream 5.0 — improved detail and prompt adherence.",
  ),
  img("seedream-5.0", "Seedream 5.0", "Seedream 5.0 image generation."),
  img(
    "seedream-5.0-pro",
    "Seedream 5.0 Pro",
    "Seedream 5.0 Pro — highest Seedream quality.",
  ),
  img(
    "gpt-image-1.5",
    "GPT Image 1.5",
    "OpenAI GPT Image 1.5 with strong text rendering.",
  ),
  img("gpt-image-2", "GPT Image 2", "OpenAI GPT Image 2."),
  img(
    "gpt-image-2-all",
    "GPT Image 2 All",
    "OpenAI GPT Image 2 (all capabilities).",
  ),
  img(
    "imagen-4.0-generate-001",
    "Imagen 4",
    "Google Imagen 4 — text-to-image only.",
  ),
  img(
    "gemini-2.5-flash-image",
    "Gemini 2.5 Flash Image",
    "Fast Gemini image generation and editing.",
  ),
  img(
    "gemini-3.1-flash-image",
    "Gemini 3.1 Flash Image",
    "Gemini 3.1 Flash image model.",
  ),
  img(
    "gemini-3.1-flash-lite-image",
    "Gemini 3.1 Flash Lite Image",
    "Lightweight Gemini 3.1 image model.",
  ),
  img("gemini-3-pro-image", "Gemini 3 Pro Image", "Gemini 3 Pro image model."),
];

export const DOFE_VIDEO_MODELS: readonly VideoModelInfo[] = [
  vid(
    "seedance-2.0",
    "Seedance 2.0",
    "ByteDance Seedance 2.0 — flagship text/image-to-video.",
  ),
  vid("seedance-2.0-fast", "Seedance 2.0 Fast", "Lower-latency Seedance 2.0."),
  vid("seedance-2.0-mini", "Seedance 2.0 Mini", "Lightweight Seedance 2.0."),
  vid(
    "kling-v3",
    "Kling 3",
    "Kuaishou Kling 3 — text/image-to-video with audio.",
  ),
  vid("kling-v2-6", "Kling 2.6", "Kuaishou Kling 2.6 — text/image-to-video."),
  vid(
    "veo-3.1-generate",
    "Veo 3.1",
    "Google Veo 3.1 — high-quality text/image-to-video.",
  ),
  vid(
    "veo-3.0-generate-001",
    "Veo 3.0",
    "Google Veo 3.0 — text-to-video with audio.",
  ),
  vid("veo-3.0-fast-generate-001", "Veo 3.0 Fast", "Google Veo 3.0 Fast."),
  vid(
    "viduq3-pro",
    "Vidu Q3 Pro",
    "Vidu Q3 Pro — long-duration text/image-to-video.",
  ),
  vid(
    "viduq3-turbo",
    "Vidu Q3 Turbo",
    "Vidu Q3 Turbo — faster Vidu generation.",
  ),
];

function img(id: string, displayName: string, description: string): ModelInfo {
  return { id, displayName, description };
}

function vid(
  id: string,
  displayName: string,
  description: string,
): VideoModelInfo {
  return {
    id,
    displayName,
    description,
    capabilities: {
      textToVideo: true,
      imageToVideo: true,
      videoToVideo: false,
      audio: true,
    },
    limits: { maxDuration: 10, maxResolution: "1080p", maxInputImages: 1 },
  };
}

// ─── Shared task protocol ────────────────────────────────────────────────────

type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

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

function buildContent(prompt: string, inputImages?: string[]): ContentPart[] {
  const parts: ContentPart[] = [{ type: "text", text: prompt }];
  for (const url of inputImages ?? []) {
    parts.push({ type: "image_url", image_url: { url } });
  }
  return parts;
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
    content: ContentPart[];
    params?: Record<string, unknown>;
  },
): Promise<TaskResponse> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${TASK_PATH}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ ...body, metadata: { source: "lovart.dofe.ai" } }),
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 401 || response.status === 403) {
    throw new GenerationError(
      "dofe",
      "credentials_invalid",
      `DoFe rejected the user key (HTTP ${response.status}).`,
    );
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new GenerationError(
      "dofe",
      "api_error",
      `DoFe createTask HTTP ${response.status}: ${detail.slice(0, 500)}`,
    );
  }
  const payload = (await response.json()) as unknown;
  // models envelope: { code, msg, data } — accept either.
  const data =
    (isRecord(payload) && isRecord(payload.data)
      ? payload.data
      : isRecord(payload)
        ? payload
        : {}) ?? {};
  const taskId =
    typeof data.taskId === "string"
      ? data.taskId
      : typeof data.localTaskId === "string"
        ? data.localTaskId
        : "";
  if (!taskId) {
    throw new GenerationError(
      "dofe",
      "api_error",
      "DoFe createTask returned no taskId.",
    );
  }
  return data as unknown as TaskResponse;
}

async function getTask(
  baseUrl: string,
  apiKey: string,
  taskId: string,
): Promise<TaskResponse> {
  const response = await fetch(
    `${baseUrl.replace(/\/$/, "")}${TASK_PATH}/${encodeURIComponent(taskId)}`,
    {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!response.ok) {
    throw new GenerationError(
      "dofe",
      "api_error",
      `DoFe getTask HTTP ${response.status} for task ${taskId}.`,
    );
  }
  const payload = (await response.json()) as unknown;
  const data =
    (isRecord(payload) && isRecord(payload.data)
      ? payload.data
      : isRecord(payload)
        ? payload
        : {}) ?? {};
  return data as unknown as TaskResponse;
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
      `DoFe task ${task.taskId} ended in ${task.status}: ${task.errorMessage ?? task.errorCode ?? "no details"}.`,
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

    const task = await createTask(this.baseUrl, apiKey, {
      model: params.model,
      endpointKind: "video_async",
      content: buildContent(params.prompt, params.inputImages),
      params: {
        ratio: params.aspectRatio,
        resolution,
        ...(params.duration ? { duration: params.duration } : {}),
        ...(typeof params.enableAudio === "boolean"
          ? { generateAudio: params.enableAudio }
          : {}),
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
