'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/cn';

interface ApiKeyCardProps {
  onSubmit: (apiKey: string) => void | Promise<void>;
}

/**
 * ApiKeyCard — agent-emitted card for collecting the user's Rocketlane
 * API key. The agent emits this via display_component, the frontend
 * renders it inline in the chat, the user types and submits, the
 * Chat.tsx parent calls /session/:id/apikey to encrypt+store on the
 * backend, then resumes the agent loop.
 *
 * The key is password-masked. It only ever leaves this component via
 * onSubmit → fetch → backend (never logged, never in conversation
 * history, AES-256-GCM encrypted at rest in Redis).
 */
export function ApiKeyCard({ onSubmit }: ApiKeyCardProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!value.trim() || submitting || submitted) return;
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(value.trim());
      setSubmitted(true);
      setValue('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="bg-surface-container-lowest border border-outline-variant/30 rounded-3xl shadow-card overflow-hidden"
    >
      {/* Header strip */}
      <div className="bg-gradient-to-br from-primary/5 to-secondary/5 px-6 py-4 flex items-center gap-3 border-b border-outline-variant/20">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-card-sm">
          <span className="material-symbols-outlined filled text-white text-lg">key</span>
        </div>
        <div className="flex-1">
          <div className="font-headline font-bold text-on-surface text-base">
            Connect Rocketlane
          </div>
          <div className="text-xs text-on-surface-variant">
            Enter your private API key to sync workspace data
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="p-6 space-y-4">
        {!submitted ? (
          <>
            <div className="space-y-2">
              <label htmlFor="api-key-input" className="block text-[10px] font-bold text-on-surface-variant uppercase tracking-widest ml-1">
                API Key
              </label>
              <div className="relative group">
                <input
                  id="api-key-input"
                  type="password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSubmit();
                  }}
                  placeholder="rk_live_xxxxxxxxxxxxxxxx"
                  disabled={submitting}
                  autoFocus
                  className={cn(
                    'w-full bg-white border border-outline-variant/30 rounded-xl px-5 py-3.5 text-on-surface',
                    'placeholder:text-outline focus:ring-2 focus:ring-primary/20 focus:border-primary/40',
                    'transition-all font-mono text-sm',
                    'disabled:opacity-50'
                  )}
                />
              </div>
            </div>

            <div className="p-3 bg-info/5 rounded-xl flex gap-3 border border-info/20">
              <span className="material-symbols-outlined text-info text-xl flex-shrink-0">
                info
              </span>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                You can find your API key in Rocketlane under{' '}
                <strong className="font-bold text-on-surface">
                  Settings → Integrations → API Keys
                </strong>
                . Plansync requires read &amp; write access. The key is{' '}
                <strong className="font-semibold text-on-surface">
                  AES-256 encrypted
                </strong>{' '}
                before storage and never logged.
              </p>
            </div>

            {error && (
              <div className="p-3 bg-error-container/30 rounded-xl text-xs text-error border border-error/20">
                {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={!value.trim() || submitting}
              className={cn(
                'w-full py-3.5 bg-gradient-to-r from-primary to-primary-container text-white font-headline font-bold text-sm',
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
                  Encrypting &amp; storing…
                </>
              ) : (
                <>
                  <span>Establish Connection</span>
                  <span className="material-symbols-outlined text-lg">arrow_forward</span>
                </>
              )}
            </button>
          </>
        ) : (
          <div className="flex items-center gap-3 p-2">
            <div className="w-10 h-10 rounded-full bg-success/10 flex items-center justify-center">
              <span className="material-symbols-outlined text-success">check_circle</span>
            </div>
            <div className="flex-1">
              <div className="font-bold text-on-surface text-sm">API key stored securely</div>
              <div className="text-xs text-on-surface-variant">
                Connection established. The agent is resuming…
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="bg-surface-container-low/50 px-6 py-2.5 border-t border-outline-variant/20 flex items-center justify-center gap-1.5">
        <span className="material-symbols-outlined text-success text-sm filled">
          verified_user
        </span>
        <span className="text-[11px] text-on-surface-variant">
          End-to-end encrypted &middot; never used for training
        </span>
      </div>
    </motion.div>
  );
}
