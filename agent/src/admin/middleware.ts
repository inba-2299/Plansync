import type { Request, Response, NextFunction } from 'express';
import {
  ADMIN_COOKIE_NAME,
  isAdminPortalConfigured,
  verifyAdminToken,
} from './auth';

/**
 * Admin authentication middleware.
 *
 * Express doesn't parse cookies out of the box. Rather than pulling in
 * the `cookie-parser` package for a single use, we parse the Cookie
 * header manually — it's ~10 lines and saves a dependency.
 *
 * The middleware:
 *   1. Returns 503 if the portal isn't configured (missing env vars).
 *      FAIL-CLOSED — never allow access when misconfigured.
 *   2. Reads the `plansync_admin_token` cookie from the request.
 *   3. Verifies the token's HMAC signature + expiry.
 *   4. On success → calls next() with `req.admin = true`.
 *   5. On failure → returns 401 with a clear error code so the
 *      frontend can redirect to /admin/login.
 */

declare module 'express-serve-static-core' {
  interface Request {
    admin?: boolean;
  }
}

/** Parse a Cookie header into a plain object. */
function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!cookieHeader) return out;
  for (const pair of cookieHeader.split(';')) {
    const [rawName, ...rest] = pair.trim().split('=');
    if (!rawName) continue;
    const name = rawName.trim();
    const value = rest.join('=').trim();
    if (name) out[name] = decodeURIComponent(value ?? '');
  }
  return out;
}

/**
 * requireAdminAuth — Express middleware that gates /admin/* routes.
 *
 * Usage:
 *   app.get('/admin/dashboard', requireAdminAuth, async (req, res) => { ... })
 */
export function requireAdminAuth(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  if (!isAdminPortalConfigured()) {
    res
      .status(503)
      .json({
        error:
          'Admin portal is not configured. Set ADMIN_USERNAME and ADMIN_PASSWORD env vars on the backend.',
        code: 'portal_not_configured',
      });
    return;
  }

  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token) {
    res.status(401).json({ error: 'Not authenticated', code: 'no_token' });
    return;
  }

  const verify = verifyAdminToken(token);
  if (!verify.valid) {
    res
      .status(401)
      .json({
        error: `Invalid or expired admin token: ${verify.error}`,
        code: 'invalid_token',
      });
    return;
  }

  req.admin = true;
  next();
}

/**
 * Helper to build the Set-Cookie header for the admin token.
 *
 * HttpOnly — JavaScript on the page can NOT read this cookie, which
 *   protects it from XSS.
 * Secure — only sent over HTTPS (irrelevant on localhost, enforced in
 *   production since Vercel + Railway are HTTPS-only).
 * SameSite=None — required so the cookie survives cross-origin requests
 *   from Vercel (frontend) to Railway (backend). Combined with Secure
 *   this is the modern cross-site cookie standard.
 * Max-Age — 2 hours in seconds, matching the token's exp claim.
 */
export function buildAdminCookieHeader(
  token: string,
  lifetimeSeconds: number
): string {
  const flags = [
    `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}`,
    `Max-Age=${lifetimeSeconds}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=None',
  ];
  return flags.join('; ');
}

/** Build the header that clears the admin cookie (for logout). */
export function buildClearAdminCookieHeader(): string {
  const flags = [
    `${ADMIN_COOKIE_NAME}=`,
    'Max-Age=0',
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=None',
  ];
  return flags.join('; ');
}
