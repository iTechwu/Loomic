export type TosConfig = {
  accessKey: string;
  bucket: string;
  bucketDomain: string;
  endpoint: string;
  internalBucketDomain: string;
  internalEndpoint: string;
  internalS3Endpoint?: string;
  region: string;
  s3Endpoint?: string;
  secretKey: string;
};

const REQUIRED_TOS_ENVIRONMENT_KEYS = [
  "TOS_ACCESS_KEY",
  "TOS_SECRET_KEY",
  "TOS_REGION",
  "TOS_ENDPOINT",
  "TOS_INTERNAL_ENDPOINT",
  "TOS_BUCKET",
  "TOS_BUCKET_DOMAIN",
  "TOS_INTERNAL_BUCKET_DOMAIN",
] as const;

/**
 * Validates server-side TOS settings as an all-or-nothing unit. Assets must
 * never fall back to a public or external endpoint after a partial deploy.
 */
export function parseTosConfig(
  source: NodeJS.ProcessEnv = process.env,
): TosConfig | undefined {
  const values = Object.fromEntries(
    REQUIRED_TOS_ENVIRONMENT_KEYS.map((key) => [key, normalize(source[key])]),
  ) as Record<(typeof REQUIRED_TOS_ENVIRONMENT_KEYS)[number], string | undefined>;
  const configuredCount = Object.values(values).filter(Boolean).length;

  if (configuredCount === 0) return undefined;

  const missing = REQUIRED_TOS_ENVIRONMENT_KEYS.filter((key) => !values[key]);
  if (missing.length > 0) {
    throw new Error(`TOS configuration is incomplete: missing ${missing.join(", ")}`);
  }

  return {
    accessKey: values.TOS_ACCESS_KEY!,
    bucket: values.TOS_BUCKET!,
    bucketDomain: normalizeHttpsUrl(values.TOS_BUCKET_DOMAIN!),
    endpoint: normalizeHttpsUrl(values.TOS_ENDPOINT!),
    internalBucketDomain: normalizeHttpsUrl(values.TOS_INTERNAL_BUCKET_DOMAIN!),
    internalEndpoint: normalizeHttpsUrl(values.TOS_INTERNAL_ENDPOINT!),
    ...(normalize(source.TOS_S3_ENDPOINT)
      ? { s3Endpoint: normalizeHttpsUrl(normalize(source.TOS_S3_ENDPOINT)!) }
      : {}),
    ...(normalize(source.TOS_INTERNAL_S3_ENDPOINT)
      ? {
          internalS3Endpoint: normalizeHttpsUrl(
            normalize(source.TOS_INTERNAL_S3_ENDPOINT)!,
          ),
        }
      : {}),
    region: values.TOS_REGION!,
    secretKey: values.TOS_SECRET_KEY!,
  };
}

function normalize(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function normalizeHttpsUrl(value: string): string {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  return withProtocol.replace(/\/+$/, "");
}
