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
 * Server-only TOS adapter. Write traffic uses the configured internal endpoint;
 * browser reads receive a short-lived URL signed for the external bucket domain.
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

/** Loads the TOS SDK only in a configured server or Worker process. */
export function createConfiguredTosObjectStorage(
  config: TosConfig,
): TosObjectStorage {
  const client = new TosClient({
    accessKeyId: config.accessKey,
    accessKeySecret: config.secretKey,
    endpoint: toHost(config.internalEndpoint),
    region: config.region,
  }) as TosSdkClient;

  return createTosObjectStorage(config, client);
}
