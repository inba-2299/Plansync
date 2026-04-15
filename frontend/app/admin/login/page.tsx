'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { adminLogin, adminMe } from '@/lib/admin-client';
import { cn } from '@/lib/cn';

/**
 * Plansync Admin — Login page
 *
 * Standalone login form at /admin/login. Posts to the backend's
 * /admin/login endpoint which verifies credentials and issues an
 * HttpOnly cookie. On success, redirects to /admin.
 *
 * If the user is already authenticated (valid cookie), the page
 * auto-redirects to /admin on mount via adminMe().
 *
 * Visual style: Plansync brand (purple gradient lightning bolt) but
 * in an admin context — darker background, "ADMIN CONSOLE" label,
 * more dashboard-like than the main app.
 */
export default function AdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If already authenticated, redirect to dashboard
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await adminMe();
      if (!cancelled && res.ok) {
        router.replace('/admin');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const res = await adminLogin(username, password);
      if (!res.ok) {
        if (res.code === 'portal_not_configured') {
          setError(
            'The admin portal is not configured on the backend. Set ADMIN_USERNAME and ADMIN_PASSWORD env vars on Railway.'
          );
        } else {
          setError(res.error ?? 'Login failed');
        }
        return;
      }
      router.replace('/admin');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center p-6 font-body">
      {/* Purple gradient background decoration */}
      <div
        className="absolute inset-0 -z-10 overflow-hidden"
        aria-hidden="true"
      >
        <div className="absolute -top-40 -right-40 w-96 h-96 rounded-full bg-primary/10 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 rounded-full bg-secondary/10 blur-3xl" />
      </div>

      <div className="w-full max-w-md">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-card-lg">
              <span className="material-symbols-outlined filled text-white text-2xl">
                bolt
              </span>
            </div>
            <div className="text-left">
              <div className="font-headline font-extrabold text-2xl text-on-surface tracking-tight">
                Plansync
              </div>
              <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-primary -mt-0.5">
                Admin Console
              </div>
            </div>
          </div>
        </div>

        {/* Login card */}
        <form
          onSubmit={handleSubmit}
          className="bg-surface-container-lowest rounded-3xl shadow-card-lg border border-outline-variant/30 overflow-hidden"
        >
          <div className="bg-gradient-to-br from-primary/5 to-secondary/5 px-6 py-5 border-b border-outline-variant/20">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-primary text-xl">
                  shield_person
                </span>
              </div>
              <div className="flex-1">
                <div className="font-headline font-bold text-on-surface text-lg">
                  Sign in
                </div>
                <div className="text-xs text-on-surface-variant">
                  Operator access for observability and agent configuration
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 space-y-4">
            {/* Username */}
            <div>
              <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 ml-1">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting}
                autoComplete="username"
                autoFocus
                className={cn(
                  'w-full bg-white border border-outline-variant/30 rounded-xl px-5 py-3 text-on-surface',
                  'placeholder:text-outline focus:ring-2 focus:ring-primary/20 focus:border-primary/40',
                  'transition-all text-sm',
                  'disabled:opacity-50'
                )}
                placeholder="admin"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-widest mb-1.5 ml-1">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting}
                autoComplete="current-password"
                className={cn(
                  'w-full bg-white border border-outline-variant/30 rounded-xl px-5 py-3 text-on-surface font-mono',
                  'placeholder:text-outline focus:ring-2 focus:ring-primary/20 focus:border-primary/40',
                  'transition-all text-sm',
                  'disabled:opacity-50'
                )}
                placeholder="••••••••••••"
              />
            </div>

            {/* Error banner */}
            {error && (
              <div className="p-3 bg-error-container/30 rounded-xl border border-error/20 flex items-start gap-2">
                <span className="material-symbols-outlined text-error text-base flex-shrink-0 mt-0.5">
                  error
                </span>
                <div className="text-xs text-error flex-1">{error}</div>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={submitting || !username || !password}
              className={cn(
                'w-full py-3 bg-gradient-to-r from-primary to-primary-container text-white font-headline font-bold text-sm',
                'rounded-xl shadow-card hover:scale-[1.01] active:scale-[0.99] transition-all',
                'flex items-center justify-center gap-2',
                'disabled:from-outline disabled:to-outline disabled:scale-100 disabled:cursor-not-allowed disabled:shadow-none'
              )}
            >
              {submitting ? (
                <>
                  <span className="material-symbols-outlined text-base animate-spin">
                    progress_activity
                  </span>
                  Verifying…
                </>
              ) : (
                <>
                  <span>Sign In</span>
                  <span className="material-symbols-outlined text-base">
                    arrow_forward
                  </span>
                </>
              )}
            </button>
          </div>

          {/* Footer */}
          <div className="bg-surface-container-low/50 px-6 py-3 border-t border-outline-variant/20 flex items-center justify-center gap-1.5">
            <span className="material-symbols-outlined text-success text-sm filled">
              verified_user
            </span>
            <span className="text-[11px] text-on-surface-variant">
              HttpOnly cookie auth · session expires in 2 hours
            </span>
          </div>
        </form>

        {/* Back to main app */}
        <div className="text-center mt-6">
          <a
            href="/"
            className="text-xs text-on-surface-variant hover:text-primary underline underline-offset-2 transition-colors"
          >
            ← Back to Plansync
          </a>
        </div>
      </div>
    </div>
  );
}
