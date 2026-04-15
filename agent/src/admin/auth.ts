import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Admin authentication — HMAC-signed token for the admin portal.
 *
 * NOT the same auth as end-user sessions (there's no end-user auth
 * in Plansync yet — users identify themselves by sessionId alone).
 * This module only protects the /admin/* routes.
 *
 * Format:
 *   <base64url(payload)>.<base64url(hmac_sha256(payload))>
 *
 * Payload is JSON: `{ role: "admin", iat, exp, jti }`
 * Signing key = ENCRYPTION_KEY (reused; same trust level)
 *
 * Lifetime: 2 hours. On expiry the admin re-enters their password at
 * /admin/login. No refresh tokens — the password itself IS the
 * long-lived credential.
 *
 * Storage on the frontend: HTTP-only cookie `plansync_admin_token`.
 * HTTP-only means XSS cannot read it from JavaScript, so even a
 * vulnerability in any other Plansync page can't steal the admin
 * token. The cookie is auto-sent by the browser on every request to
 * the same origin so the frontend never has to manually attach it.
 *
 * There is NO signup flow. Admin credentials are set by the operator
 * (Inbaraj) as Railway env vars:
 *   ADMIN_USERNAME
 *   ADMIN_PASSWORD
 * If either is missing, /admin/* routes return 503 to make it
 * impossible to leave the portal accidentally unprotected.
 */

const DEFAULT_LIFETIME_SECONDS = 2 * 60 * 60; // 2 hours

export interface AdminTokenPayload {
  role: 'admin';
  iat: number; // issued at (ms since epoch)
  exp: number; // expires at (ms since epoch)
  jti: string; // unique token id (reserved for future revocation list)
}

export type TokenVerifyResult =
  | { valid: true; payload: AdminTokenPayload }
  | { valid: false; error: string };

function getSigningKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'ENCRYPTION_KEY not set — cannot mint or verify admin tokens'
    );
  }
  return Buffer.from(raw, 'base64');
}

function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64urlDecode(input: string): Buffer {
  const padded =
    input.replace(/-/g, '+').replace(/_/g, '/') +
    '='.repeat((4 - (input.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

/** Mint a fresh admin token. Called after successful password verification. */
export function mintAdminToken(
  lifetimeSeconds: number = DEFAULT_LIFETIME_SECONDS
): { token: string; expiresAt: number } {
  const now = Date.now();
  const payload: AdminTokenPayload = {
    role: 'admin',
    iat: now,
    exp: now + lifetimeSeconds * 1000,
    jti: randomBytes(8).toString('hex'),
  };
  const encodedPayload = base64urlEncode(JSON.stringify(payload));

  const signature = createHmac('sha256', getSigningKey())
    .update(encodedPayload)
    .digest();
  const encodedSignature = base64urlEncode(signature);

  return {
    token: `${encodedPayload}.${encodedSignature}`,
    expiresAt: payload.exp,
  };
}

/** Verify a token. Returns `valid: true` + payload on success. */
export function verifyAdminToken(token: string): TokenVerifyResult {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'No token provided' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'Malformed token' };
  }
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) {
    return { valid: false, error: 'Malformed token' };
  }

  const expectedSig = createHmac('sha256', getSigningKey())
    .update(encodedPayload)
    .digest();
  const providedSig = base64urlDecode(encodedSignature);

  if (expectedSig.length !== providedSig.length) {
    return { valid: false, error: 'Invalid signature' };
  }
  try {
    if (!timingSafeEqual(expectedSig, providedSig)) {
      return { valid: false, error: 'Invalid signature' };
    }
  } catch {
    return { valid: false, error: 'Invalid signature' };
  }

  let payload: AdminTokenPayload;
  try {
    const raw = base64urlDecode(encodedPayload).toString('utf-8');
    payload = JSON.parse(raw) as AdminTokenPayload;
  } catch {
    return { valid: false, error: 'Malformed payload' };
  }

  if (payload.role !== 'admin') {
    return { valid: false, error: 'Wrong role claim' };
  }
  if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) {
    return { valid: false, error: 'Token expired' };
  }

  return { valid: true, payload };
}

/**
 * Constant-time string comparison. Prevents timing attacks on the
 * password comparison that could leak the password character-by-character.
 */
export function safeStringCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const abuf = Buffer.from(a, 'utf-8');
  const bbuf = Buffer.from(b, 'utf-8');
  if (abuf.length !== bbuf.length) {
    // Still do a comparison with a zero-length buffer to avoid leaking
    // length info via timing. We return false anyway.
    try {
      timingSafeEqual(abuf, Buffer.alloc(abuf.length));
    } catch {}
    return false;
  }
  try {
    return timingSafeEqual(abuf, bbuf);
  } catch {
    return false;
  }
}

/**
 * Check that both ADMIN_USERNAME and ADMIN_PASSWORD env vars are set.
 * If either is missing, the /admin/* routes should return 503 instead
 * of an auth prompt — it's safer to FAIL CLOSED (no access) than to
 * leave the portal unprotected with an empty credential.
 */
export function isAdminPortalConfigured(): boolean {
  return (
    typeof process.env.ADMIN_USERNAME === 'string' &&
    process.env.ADMIN_USERNAME.length > 0 &&
    typeof process.env.ADMIN_PASSWORD === 'string' &&
    process.env.ADMIN_PASSWORD.length > 0
  );
}

/**
 * Verify a (username, password) pair against the env vars using
 * constant-time comparison. Returns `true` only if both match exactly.
 */
export function verifyAdminCredentials(
  username: string,
  password: string
): boolean {
  if (!isAdminPortalConfigured()) return false;
  const expectedUsername = process.env.ADMIN_USERNAME ?? '';
  const expectedPassword = process.env.ADMIN_PASSWORD ?? '';
  // Compare both fields in constant time even if the username is wrong.
  // This avoids a timing side-channel where the password check is
  // skipped entirely when the username is wrong.
  const usernameMatch = safeStringCompare(username, expectedUsername);
  const passwordMatch = safeStringCompare(password, expectedPassword);
  return usernameMatch && passwordMatch;
}

/** The cookie name used to store the admin token. */
export const ADMIN_COOKIE_NAME = 'plansync_admin_token';
