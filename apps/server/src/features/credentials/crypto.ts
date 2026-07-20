import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const NONCE_BYTES = 12;
/**
 * Marker prefix for AES-256-GCM payloads so decrypt() stays safe even if the
 * operator enables/disables encryption later — any value without it is treated
 * as plaintext (legacy / unencrypted rows).
 */
const ENCRYPTED_PREFIX = "encv1";

export type CredentialCrypto = {
  readonly enabled: boolean;
  encrypt(plaintext: string): string;
  decrypt(value: string): string;
};

/**
 * AES-256-GCM credential crypto. When `key` is provided (must decode to 32
 * bytes), secrets are encrypted at rest; otherwise a plaintext passthrough is
 * used and the caller is expected to log a startup warning.
 *
 * Encrypted layout: `encv1:<base64-nonce>:<base64-tag>:<base64-ciphertext>`.
 */
export function createCredentialCrypto(
  key: string | undefined,
): CredentialCrypto {
  if (!key) {
    return {
      enabled: false,
      encrypt: (plaintext) => plaintext,
      decrypt: (value) => value,
    };
  }

  const keyBytes = decodeKey(key);
  return {
    enabled: true,
    encrypt(plaintext: string): string {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGO, keyBytes, nonce);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);
      const tag = cipher.getAuthTag();
      return [
        ENCRYPTED_PREFIX,
        nonce.toString("base64"),
        tag.toString("base64"),
        ciphertext.toString("base64"),
      ].join(":");
    },
    decrypt(value: string): string {
      if (!value.startsWith(`${ENCRYPTED_PREFIX}:`)) return value;
      const parts = value.split(":");
      // ["encv1", nonce, tag, ciphertext]
      const nonce = Buffer.from(parts[1] ?? "", "base64");
      const tag = Buffer.from(parts[2] ?? "", "base64");
      const ciphertext = Buffer.from(parts[3] ?? "", "base64");
      const decipher = createDecipheriv(ALGO, keyBytes, nonce);
      decipher.setAuthTag(tag);
      return Buffer.concat([
        decipher.update(ciphertext),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

/**
 * Accept a 32-byte key as base64, hex, or raw 32-char utf8. Anything else is a
 * configuration error we surface loudly at startup.
 */
function decodeKey(key: string): Buffer {
  const fromBase64 = Buffer.from(key, "base64");
  if (fromBase64.length === 32) return fromBase64;
  const fromHex = Buffer.from(key, "hex");
  if (fromHex.length === 32) return fromHex;
  const fromUtf8 = Buffer.from(key, "utf8");
  if (fromUtf8.length === 32) return fromUtf8;
  throw new Error(
    "LOVART_CREDENTIAL_ENCRYPTION_KEY must decode to exactly 32 bytes (base64, hex, or 32-char utf8).",
  );
}
