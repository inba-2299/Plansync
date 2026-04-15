import { cn } from '@/lib/cn';
import { Markdown } from './Markdown';

interface ReasoningBubbleProps {
  content: string;
  complete: boolean;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * ReasoningBubble — the agent's streaming text between tool calls.
 *
 * While streaming (complete=false), shows fully expanded with a blinking
 * cursor at the end. Once a tool call starts, the agent loop marks it
 * complete + collapsed by default. The user can click to re-expand.
 *
 * This is the SINGLE BIGGEST visual signal that "this is an agent" —
 * users see Claude think out loud, then act, then think again.
 */
export function ReasoningBubble({
  content,
  complete,
  collapsed,
  onToggleCollapse,
}: ReasoningBubbleProps) {
  // Empty bubbles (just started) — show a soft placeholder
  if (!content) {
    return (
      <div className="flex justify-start animate-fade-in">
        <div className="max-w-[85%] bg-surface-container-low/50 border border-outline-variant/20 rounded-2xl px-4 py-3 text-xs text-on-surface-variant flex items-center gap-2">
          <span className="material-symbols-outlined text-base text-primary/60">psychology</span>
          <span className="italic">thinking…</span>
        </div>
      </div>
    );
  }

  // Truncated preview when collapsed: first ~80 chars
  const preview =
    content.length > 100 ? content.slice(0, 100).trim() + '…' : content;

  return (
    <div className="flex justify-start animate-fade-in">
      <div
        className={cn(
          'max-w-[85%] rounded-2xl transition-all',
          collapsed
            ? 'bg-surface-container-low/40 hover:bg-surface-container-low/70 border border-outline-variant/20 cursor-pointer'
            : 'bg-surface-container-lowest border border-outline-variant/30 shadow-card-sm'
        )}
        onClick={collapsed ? onToggleCollapse : undefined}
      >
        <div className="flex items-start gap-3 px-4 py-3">
          <span
            className={cn(
              'material-symbols-outlined text-lg flex-shrink-0 mt-0.5',
              complete ? 'text-on-surface-variant' : 'text-primary'
            )}
          >
            psychology
          </span>
          <div className="flex-1 min-w-0">
            {collapsed ? (
              <div className="text-xs text-on-surface-variant flex items-center justify-between gap-2">
                <span className="italic truncate">{preview}</span>
                <button
                  className="text-[10px] uppercase font-bold tracking-wider text-primary/70 hover:text-primary flex-shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleCollapse();
                  }}
                >
                  expand
                </button>
              </div>
            ) : (
              <div className="text-sm text-on-surface leading-relaxed">
                {complete ? (
                  <Markdown content={content} />
                ) : (
                  // While streaming, render as plain text so partial
                  // markdown tokens (half-finished **bold**) don't
                  // reflow the bubble on every delta
                  <div className="whitespace-pre-wrap">
                    {content}
                    <span className="streaming-cursor" />
                  </div>
                )}
                {complete && (
                  <button
                    className="block mt-2 text-[10px] uppercase font-bold tracking-wider text-on-surface-variant/60 hover:text-primary"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleCollapse();
                    }}
                  >
                    collapse
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
