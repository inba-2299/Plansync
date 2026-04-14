import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';

/**
 * AES-256-GCM encryption for per-session secrets stored in Redis.
 *
 * Why: users of the Plansync agent enter their Rocketlane API key in the
 * UI. We need to keep that key available across turns (since the agent
 * calls Rocketlane multiple times during a run) but we should NOT store
 * it in plain text in Redis — if Redis is ever compromised, all keys leak.
 *
 * Instead: encrypt with AES-GCM using a server-side ENCRYPTION_KEY (32
 * random bytes, base64-encoded in env). Decrypt only in-memory at the
 * moment the RL client is created for a request. The key never gets
 * written to disk or logs.
 *
 * Format: output is `<iv_b64>:<authTag_b64>:<ciphertext_b64>` — one line,
 * safe to store in a Redis HASH field.
 */

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12; // recommended for GCM

function loadKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY not set. Generate with: openssl rand -base64 32 and add to env.'
    );
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length !== KEY_BYTES) {
    throw new Error(
      `ENCRYPTION_KEY must decode to exactly ${KEY_BYTES} bytes (got ${buf.length}). Regenerate with: openssl rand -base64 32`
    );
  }
  return buf;
}

export function encrypt(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    ':'
  );
}

export function decrypt(encoded: string): string {
  const key = loadKey();
  const parts = encoded.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted payload format (expected iv:tag:ciphertext)');
  }
  const [ivB64, authTagB64, ciphertextB64] = parts;
  const iv = Buffer.from(ivB64, 'base64');
  const authTag = Buffer.from(authTagB64, 'base64');
  const ciphertext = Buffer.from(ciphertextB64, 'base64');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
