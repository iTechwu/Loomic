import type { AssetBucket } from "../../database/native-data-repository.js";
import type { NativeDataRepository } from "../../database/native-data-repository.js";
import type { TosObjectStorage } from "../../storage/tos-object-storage.js";

const DOFE_SYSTEM_BUCKET = "dofe-system";
const SIGNED_URL_EXPIRY_SECONDS = 3600;

export type PersistGeneratedAssetInput = {
  sourceUrl: string;
  mimeType: string;
  userId: string;
  workspaceId: string;
  projectId?: string;
  dataRepository: NativeDataRepository;
  objectStorage: TosObjectStorage;
  /** The TOS endpoint used to recognize provider URLs, e.g. https://tos-cn-beijing.volces.com */
  tosEndpoint: string;
  title?: string | undefined;
};

export type PersistedAsset = {
  assetId: string;
  signedUrl: string;
  objectPath: string;
  bucket: AssetBucket;
  mimeType: string;
};

/**
 * Persist a generated image/video asset into the DoFe system bucket.
 *
 * If the provider already returned a TOS URL in dofe-system, we extract the
 * object key and record it locally without downloading bytes. Otherwise we
 * download the asset and upload it into dofe-system. The returned signed URL
 * always points at the stored (bucket, key) pair.
 */
export async function persistGeneratedAsset(
  input: PersistGeneratedAssetInput,
): Promise<PersistedAsset> {
  const parsed = parseTosUrl(input.sourceUrl, input.tosEndpoint);
  const isAlreadyInSystemBucket =
    parsed?.bucket === DOFE_SYSTEM_BUCKET;

  const systemStorage = input.objectStorage.forBucket(DOFE_SYSTEM_BUCKET);

  let objectPath: string;
  let byteSize: number | null = null;
  let etag: string | null = null;

  if (isAlreadyInSystemBucket) {
    objectPath = parsed.key;
    // Best-effort HEAD to learn size without downloading the object.
    byteSize = await probeContentLength(input.sourceUrl);
  } else {
    const downloaded = await fetchAssetBuffer(input.sourceUrl, input.mimeType);
    byteSize = downloaded.buffer.length;

    const ext = extensionForMime(input.mimeType);
    const safeTitle = (input.title ?? "generated")
      .slice(0, 40)
      .replace(/[^a-zA-Z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    const fileName = `${safeTitle}-${Date.now()}.${ext}`;
    objectPath = `generated/${input.workspaceId}/${fileName}`;

    const uploaded = await systemStorage.put({
      body: downloaded.buffer,
      contentType: input.mimeType,
      key: objectPath,
    });
    etag = uploaded.etag;
  }

  const assetRow = await input.dataRepository.createAsset({
    bucket: DOFE_SYSTEM_BUCKET,
    byteSize,
    createdBy: input.userId,
    etag,
    mimeType: input.mimeType,
    objectPath,
    ...(input.projectId ? { projectId: input.projectId } : {}),
    workspaceId: input.workspaceId,
  });

  if (!assetRow) {
    // If we uploaded the object but could not record metadata, attempt to clean
    // up so we do not orphan bytes in dofe-system.
    if (!isAlreadyInSystemBucket) {
      await systemStorage.delete(objectPath).catch(() => undefined);
    }
    throw new Error("Failed to create asset metadata");
  }

  const signedUrl = systemStorage.createReadUrl(
    objectPath,
    SIGNED_URL_EXPIRY_SECONDS,
  );

  return {
    assetId: assetRow.id,
    signedUrl,
    objectPath,
    bucket: DOFE_SYSTEM_BUCKET,
    mimeType: input.mimeType,
  };
}

/**
 * Parse a TOS URL into (bucket, key).
 *
 * Supports both virtual-hosted style
 *   https://bucket.endpoint/key
 * and path style
 *   https://endpoint/bucket/key
 * against the configured TOS endpoint.
 */
export function parseTosUrl(
  url: string,
  endpoint: string,
): { bucket: string; key: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const endpointHost = toHost(endpoint).toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const pathname = decodeURIComponent(parsed.pathname);

  // Virtual-hosted style: https://bucket.endpoint/key
  if (host.endsWith(`.${endpointHost}`) && host !== endpointHost) {
    const bucket = host.slice(0, host.length - endpointHost.length - 1);
    const key = pathname.startsWith("/") ? pathname.slice(1) : pathname;
    if (!bucket || !key) return null;
    return { bucket, key };
  }

  // Path style: https://endpoint/bucket/key
  if (host === endpointHost) {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length < 2) return null;
    const bucket = segments[0];
    const key = segments.slice(1).join("/");
    if (!bucket || !key) return null;
    return { bucket, key };
  }

  return null;
}

async function fetchAssetBuffer(
  sourceUrl: string,
  mimeType: string,
): Promise<{ buffer: Buffer }> {
  let response: Response;
  try {
    response = await fetch(sourceUrl);
  } catch (downloadError) {
    const detail =
      downloadError instanceof Error
        ? downloadError.message
        : String(downloadError);
    throw new Error(`Failed to download generated asset: ${detail}`);
  }
  if (!response.ok) {
    throw new Error(
      `Failed to download generated asset: ${response.status} ${response.statusText}`,
    );
  }
  const contentType = response.headers.get("content-type") ?? mimeType;
  const arrayBuffer = await response.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer) };
}

async function probeContentLength(url: string): Promise<number | null> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    const length = response.headers.get("content-length");
    if (length) return Number.parseInt(length, 10);
  } catch {
    // Best-effort: size is not required for display.
  }
  return null;
}

function extensionForMime(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/gif":
      return "gif";
    case "video/webm":
      return "webm";
    case "video/mp4":
      return "mp4";
    default:
      return mimeType.startsWith("video/") ? "mp4" : "png";
  }
}

function toHost(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}
