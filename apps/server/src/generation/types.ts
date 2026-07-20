/** Metadata describing a model supported by a provider. */
export interface ModelInfo {
  /** Provider-scoped model ID, e.g. "google/nano-banana-pro" */
  id: string;
  /** Human-readable name shown to users */
  displayName: string;
  /** Short description for LLM model selection */
  description: string;
  /** URL to the model owner's avatar/icon */
  iconUrl?: string;
}

/**
 * Semantic quality levels — each provider translates to its own resolution param.
 * - standard: ~1K (fastest, preview quality)
 * - hd:       ~2K (default, production quality)
 * - ultra:    ~4K (highest, print quality — not all models support this)
 */
export type ImageQuality = "standard" | "hd" | "ultra";

export type OutputFormat = "png" | "jpg" | "webp";

/**
 * Per-user credentials injected into `provider.generate()` so the DoFe
 * (ixicai.cn) gateway authenticates each model call as the owning user rather
 * than the shared DOFE_MODEL_API_KEY. Strict no-fallback: providers throw when
 * `designApiKey` is absent.
 */
export type ProviderAuth = {
  /** Design apikey (sk-...) — Bearer for /generation/tasks. */
  designApiKey: string;
  /** Seedance asset AK/SK — reserved for asset OpenAPI uploads (future). */
  seedanceAccessKeyId?: string;
  seedanceSecretAccessKey?: string;
};

export interface ImageGenerateParams {
  prompt: string;
  model: string;
  aspectRatio?: string;
  inputImages?: string[];
  /** Semantic quality level, provider translates to model-specific resolution */
  quality?: ImageQuality;
  /** Output format preference */
  outputFormat?: OutputFormat;
  metadata?: Record<string, unknown>;
  /** Per-user DoFe gateway credentials (strict no-fallback when using the dofe provider). */
  auth?: ProviderAuth;
}

export interface GeneratedImage {
  url: string;
  mimeType: string;
  width: number;
  height: number;
}

export interface ImageProvider {
  readonly name: string;
  readonly models: readonly ModelInfo[];
  generate(params: ImageGenerateParams): Promise<GeneratedImage>;
}

export interface VideoGenerateParams {
  prompt: string;
  model: string;
  resolution?: "480p" | "720p" | "1080p" | "4k";
  duration?: number;
  aspectRatio?: string;
  inputImages?: string[];
  inputVideo?: string;
  /** Enable audio generation (only supported by some providers). */
  enableAudio?: boolean;
  /** Per-user DoFe gateway credentials (strict no-fallback when using the dofe provider). */
  auth?: ProviderAuth;
}

export interface GeneratedVideo {
  url: string;
  mimeType: string;
  width: number;
  height: number;
  durationSeconds: number;
}

export interface VideoProvider {
  readonly name: string;
  readonly models: readonly VideoModelInfo[];
  generate(params: VideoGenerateParams): Promise<GeneratedVideo>;
}

/** Extended model info with video-specific capabilities metadata. */
export interface VideoModelInfo extends ModelInfo {
  capabilities: {
    textToVideo: boolean;
    imageToVideo: boolean;
    videoToVideo: boolean;
    audio: boolean;
  };
  limits: {
    maxDuration: number;
    allowedDurations?: number[];
    maxResolution: "480p" | "720p" | "1080p" | "2160p";
    maxInputImages: number;
  };
}
