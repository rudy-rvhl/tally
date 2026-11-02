/** AES-256-GCM encryption for original statement files and receipts at rest. */
import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) throw new Error("ENCRYPTION_KEY is not set. See .env.example.");
  const k = Buffer.from(raw, "base64");
  if (k.length !== 32) throw new Error("ENCRYPTION_KEY must be 32 bytes, base64-encoded.");
  return k;
}

/** Plain-language description of a missing or malformed key, or null when the key is fine. */
export function encryptionKeyProblem(): string | null {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) return "The server's ENCRYPTION_KEY isn't set in the .env file, so statements can't be stored securely. Add it (see .env.example) and restart the app.";
  if (Buffer.from(raw, "base64").length !== 32) return "The server's ENCRYPTION_KEY in the .env file isn't a valid 32-byte key. Generate one with the command in .env.example and restart the app.";
  return null;
}

/** Output layout: 12-byte IV | 16-byte tag | ciphertext */
export function encrypt(plain: Buffer): Uint8Array<ArrayBuffer> {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return new Uint8Array(Buffer.concat([iv, c.getAuthTag(), body]));
}

export function decrypt(input: Uint8Array): Buffer {
  const blob = Buffer.from(input);
  const d = createDecipheriv("aes-256-gcm", key(), blob.subarray(0, 12));
  d.setAuthTag(blob.subarray(12, 28));
  return Buffer.concat([d.update(blob.subarray(28)), d.final()]);
}
