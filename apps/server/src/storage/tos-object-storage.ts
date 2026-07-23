import type { TosConfig } from "./tos-config.js";
import { TosClient } from "@volcengine/tos-sdk";

type TosSdkClient = {
  copyObject(input: {
    bucket: string;
    key: string;
    srcBucket: string;
    srcKey: string;
  }): Promise<{ data?: { ETag?: string } }>;
  deleteObject(input: { bucket: string; key: string }): Promise<unknown>;
  getPreSignedUrl(input: {
    alternativeEndpoint: string;
    bucket: string;
    expires: number;
    isCustomDomain: true;
    key: string;
    method: "GET";
  }): string;
  putObject(input: {
    body: Buffer;
    bucket: string;
    contentType: string;
    key: string;
  }): Promise<{ headers?: { etag?: string } }>;
};

export type TosObjectStorage = {
  copy(
    sourceKey: string,
    targetKey: string,
  ): Promise<{ etag: string | null; key: string }>;
  createReadUrl(key: string, expiresInSeconds: number): string;
  delete(key: string): Promise<void>;
  put(input: {
    body: Buffer;
    contentType: string;
    key: string;
  }): Promise<{ etag: string | null; key: string }>;
  /**
   * Returns a storage client configured for the requested bucket. The default
   * client operates on the application bucket; use forBucket('dofe-system') to
   * read/write generated assets that live in the DoFe gateway output bucket.
   */
  forBucket(bucket: string): TosObjectStorage;
};

const DEFAULT_DOFE_SYSTEM_BUCKET = "dofe-system";

function toHost(url: string): string {
  // @volcengine/tos-sdk treats the endpoint / alternativeEndpoint as a bare
  // host. Passing a scheme-prefixed value produces malformed URLs such as
  // "https://https://cdn.example.com/..." and DNS errors like
  // "dofe-system.https". Strip any scheme and trailing path just in case.
  return url.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

function endpointHost(endpoint: string): string {
  return toHost(endpoint);
}

function deriveSystemBucketDomain(config: TosConfig): string {
  const explicit = config.systemBucketDomain;
  if (explicit) return normalizeHttpsUrl(explicit);
  const host = endpointHost(config.endpoint);
  const bucket = config.systemBucket ?? DEFAULT_DOFE_SYSTEM_BUCKET;
  return `https://${bucket}.${host}`;
}

function normalizeHttpsUrl(value: string): string {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

/**
 * Server-only TOS adapter. Both writes (put/copy/delete) and signed read URLs
 * go through the external TOS endpoint / bucket domain; see
 * `createConfiguredTosObjectStorage` for why the internal endpoint is not used.
 */
export function createTosObjectStorage(
  config: TosConfig,
  client: TosSdkClient,
): TosObjectStorage {
  return createTosObjectStorageForBucket(
    config,
    client,
    config.bucket,
    config.bucketDomain,
  );
}

function createTosObjectStorageForBucket(
  config: TosConfig,
  client: TosSdkClient,
  bucket: string,
  bucketDomain: string,
): TosObjectStorage {
  const self: TosObjectStorage = {
    async copy(sourceKey, targetKey) {
      const response = await client.copyObject({
        bucket,
        key: targetKey,
        srcBucket: bucket,
        srcKey: sourceKey,
      });
      return { etag: response.data?.ETag ?? null, key: targetKey };
    },
    createReadUrl(key, expiresInSeconds) {
      return client.getPreSignedUrl({
        alternativeEndpoint: toHost(bucketDomain),
        bucket,
        expires: expiresInSeconds,
        isCustomDomain: true,
        key,
        method: "GET",
      });
    },
    async delete(key) {
      await client.deleteObject({ bucket, key });
    },
    async put(input) {
      const response = await client.putObject({
        body: input.body,
        bucket,
        contentType: input.contentType,
        key: input.key,
      });
      return { etag: response.headers?.etag ?? null, key: input.key };
    },
    forBucket(otherBucket) {
      if (otherBucket === bucket) return self;
      const systemBucket = config.systemBucket ?? DEFAULT_DOFE_SYSTEM_BUCKET;
      if (otherBucket === systemBucket) {
        return createTosObjectStorageForBucket(
          config,
          client,
          systemBucket,
          deriveSystemBucketDomain(config),
        );
      }
      return createTosObjectStorageForBucket(
        config,
        client,
        otherBucket,
        `https://${otherBucket}.${endpointHost(config.endpoint)}`,
      );
    },
  };
  return self;
}

/**
 * Loads the TOS SDK only in a configured server or Worker process.
 *
 * The write client targets the EXTERNAL endpoint (`config.endpoint`,
 * `TOS_ENDPOINT` / `*.volces.com`). The VPC-internal endpoint
 * (`TOS_INTERNAL_ENDPOINT` / `*.ivolces.com`) is only reachable from inside
 * Volcano Engine; when the process runs elsewhere (e.g. local dev) every
 * put/copy/delete hangs until the SDK timeout and uploads fail with a generic
 * 500. Signed read URLs are unaffected — they are produced against
 * `config.bucketDomain` via `alternativeEndpoint`, not the client endpoint.
 *
 * TODO(@storage): `TOS_INTERNAL_ENDPOINT` / `TOS_INTERNAL_BUCKET_DOMAIN` are
 * still parsed and required by `parseTosConfig` but no longer drive the write
 * path. Revisit whether to drop them from the required set once no deployment
 * relies on the internal endpoint.
 */
export function createConfiguredTosObjectStorage(
  config: TosConfig,
): TosObjectStorage {
  const client = new TosClient({
    accessKeyId: config.accessKey,
    accessKeySecret: config.secretKey,
    endpoint: toHost(config.endpoint),
    region: config.region,
  }) as TosSdkClient;

  return createTosObjectStorage(config, client);
}
