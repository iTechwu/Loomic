import { describe, expect, it } from "vitest";

import { parseTosConfig } from "./tos-config.js";

describe("parseTosConfig", () => {
  it("returns a server-only TOS configuration when every required value is present", () => {
    expect(
      parseTosConfig({
        TOS_ACCESS_KEY: "access-key",
        TOS_SECRET_KEY: "secret-key",
        TOS_REGION: "cn-beijing",
        TOS_ENDPOINT: "tos-cn-beijing.volces.com",
        TOS_INTERNAL_ENDPOINT: "tos-cn-beijing.ivolces.com",
        TOS_BUCKET: "lovart-assets",
        TOS_BUCKET_DOMAIN: "cdn.example.test",
        TOS_INTERNAL_BUCKET_DOMAIN: "lovart-assets.tos-cn-beijing.ivolces.com",
      }),
    ).toEqual({
      accessKey: "access-key",
      bucket: "lovart-assets",
      bucketDomain: "https://cdn.example.test",
      endpoint: "https://tos-cn-beijing.volces.com",
      internalBucketDomain: "https://lovart-assets.tos-cn-beijing.ivolces.com",
      internalEndpoint: "https://tos-cn-beijing.ivolces.com",
      region: "cn-beijing",
      secretKey: "secret-key",
    });
  });

  it("rejects a partial TOS configuration instead of silently falling back to a public endpoint", () => {
    expect(() =>
      parseTosConfig({
        TOS_ACCESS_KEY: "access-key",
        TOS_BUCKET: "lovart-assets",
      }),
    ).toThrow("TOS configuration is incomplete");
  });
});
