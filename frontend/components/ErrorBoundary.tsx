'use client';

import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /**
   * Optional fallback override. By default a "something went wrong" card
   * is rendered with a reload button. Pass a custom ReactNode here if a
   * caller wants a different recovery surface.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * ErrorBoundary — wraps the chat body so a render crash in any
 * agent-emitted card degrades gracefully instead of white-paging the
 * entire app.
 *
 * Why class component: React's built-in error boundary API only works on
 * class components (`componentDidCatch` / `getDerivedStateFromError`).
 * Function components have no equivalent as of React 19.
 *
 * Usage:
 *   <ErrorBoundary>
 *     <Chat />
 *   </ErrorBoundary>
 *
 * Recovery: the user can click "Reload" to remount the subtree. The chat
 * is SSE-driven but stateless on the frontend — a fresh mount re-hydrates
 * the journey and the session ID reroll produces a fresh agent run.
 *
 * This was added after a Session 4 production crash where
 * PlanReviewTree's `item.dependsOn.length` hit undefined, triggering a
 * blanket "Application error: a client-side exception has occurred"
 * blank page with no recovery path. PlanReviewTree has since been
 * hardened, but the error boundary exists as a second line of defense
 * against any future render-safety bug in an agent-emitted card.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: { componentStack?: string | null }) {
    // Console log only. We intentionally don't ship Sentry or similar to
    // keep the deployment surface small — `console.error` in a Vercel
    // production build lands in the Function Logs panel and in the
    // browser devtools console, which is sufficient for debugging.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught render error:', error);
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] component stack:', errorInfo?.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    if (this.props.fallback) {
      return this.props.fallback(error, this.reset);
    }

    return (
      <div className="min-h-screen bg-surface text-on-surface font-body flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-surface-container-lowest border border-error/30 rounded-3xl shadow-card overflow-hidden">
          <div className="bg-gradient-to-br from-error/10 to-warning/5 px-6 py-5 border-b border-error/20">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center flex-shrink-0">
                <span className="material-symbols-outlined text-error text-xl">
                  error
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-widest font-bold text-error mb-0.5">
                  Something went wrong
                </div>
                <div className="font-headline font-extrabold text-on-surface text-lg">
                  The Plansync UI hit a render error
                </div>
              </div>
            </div>
          </div>
          <div className="p-6 space-y-4">
            <p className="text-sm text-on-surface-variant leading-relaxed">
              The agent is fine on the server — your session state is
              safe in Redis. Something in the UI failed to render a card.
              Click reload below to reset the view.
            </p>

            <details className="text-[11px] bg-surface-container-low/50 rounded-xl p-3 border border-outline-variant/20">
              <summary className="cursor-pointer font-semibold text-on-surface-variant">
                Error details
              </summary>
              <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] text-on-surface-variant/80">
                {error.message}
              </pre>
            </details>

            <div className="flex gap-2">
              <button
                onClick={this.reset}
                className="flex-1 py-3 bg-gradient-to-r from-primary to-primary-container text-white font-headline font-bold text-sm rounded-xl shadow-card hover:scale-[1.01] active:scale-[0.99] transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-base">refresh</span>
                Reset view
              </button>
              <button
                onClick={() => window.location.reload()}
                className="flex-1 py-3 bg-surface-container-low text-on-surface border border-outline-variant/40 font-headline font-bold text-sm rounded-xl hover:bg-surface-container transition-all flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-base">
                  restart_alt
                </span>
                Full reload
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
}
