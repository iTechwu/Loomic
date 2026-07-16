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
};

/**
 * Server-only TOS adapter. Write traffic uses the configured internal endpoint;
 * browser reads receive a short-lived URL signed for the external bucket domain.
 */
export function createTosObjectStorage(
  config: TosConfig,
  client: TosSdkClient,
): TosObjectStorage {
  return {
    async copy(sourceKey, targetKey) {
      const response = await client.copyObject({
        bucket: config.bucket,
        key: targetKey,
        srcBucket: config.bucket,
        srcKey: sourceKey,
      });
      return { etag: response.data?.ETag ?? null, key: targetKey };
    },
    createReadUrl(key, expiresInSeconds) {
      return client.getPreSignedUrl({
        alternativeEndpoint: config.bucketDomain,
        bucket: config.bucket,
        expires: expiresInSeconds,
        isCustomDomain: true,
        key,
        method: "GET",
      });
    },
    async delete(key) {
      await client.deleteObject({ bucket: config.bucket, key });
    },
    async put(input) {
      const response = await client.putObject({
        body: input.body,
        bucket: config.bucket,
        contentType: input.contentType,
        key: input.key,
      });
      return { etag: response.headers?.etag ?? null, key: input.key };
    },
  };
}

/** Loads the TOS SDK only in a configured server or Worker process. */
export function createConfiguredTosObjectStorage(
  config: TosConfig,
): TosObjectStorage {
  const client = new TosClient({
    accessKeyId: config.accessKey,
    accessKeySecret: config.secretKey,
    endpoint: config.internalEndpoint,
    region: config.region,
  }) as TosSdkClient;

  return createTosObjectStorage(config, client);
}
