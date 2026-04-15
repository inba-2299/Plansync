import { useState } from 'react';
import { cn } from '@/lib/cn';

interface ToolCallLineProps {
  name: string;
  inputJson: string;
  complete: boolean;
  result?: string;
}

/**
 * ToolCallLine — one-liner for a tool_use block in the chat timeline.
 *
 * Compact by default. Click to expand and see the input JSON + result
 * summary. While the input is streaming, shows a subtle indeterminate
 * progress effect.
 *
 * Tools that produce visible side effects (display_component events)
 * have their own dedicated render path — this is just the lightweight
 * inline indicator.
 */
export function ToolCallLine({
  name,
  inputJson,
  complete,
  result,
}: ToolCallLineProps) {
  const [expanded, setExpanded] = useState(false);

  // Friendly label for the tool name
  const friendlyName = name.replace(/_/g, ' ');

  // Detect error in result summary
  const isError = result?.toLowerCase().startsWith('error:') ?? false;

  // Status icon
  const statusIcon = !complete ? (
    <span className="material-symbols-outlined text-primary text-base animate-pulse">
      progress_activity
    </span>
  ) : isError ? (
    <span className="material-symbols-outlined text-error text-base">error</span>
  ) : (
    <span className="material-symbols-outlined text-success text-base">check_circle</span>
  );

  return (
    <div className="flex justify-start animate-fade-in">
      <div
        className={cn(
          'max-w-[85%] rounded-xl transition-all',
          isError
            ? 'bg-error-container/20 border border-error/20'
            : 'bg-info/[0.04] border border-info/20',
          'hover:shadow-card-sm cursor-pointer'
        )}
        onClick={() => setExpanded((v) => !v)}
      >
        <div className="flex items-center gap-3 px-4 py-2.5">
          {statusIcon}
          <div className="flex items-baseline gap-2 min-w-0 flex-1">
            <span className="material-symbols-outlined text-sm text-on-surface-variant">
              build
            </span>
            <code
              className={cn(
                'text-xs font-mono font-semibold whitespace-nowrap',
                isError ? 'text-error' : 'text-info'
              )}
            >
              {name}
            </code>
            {complete && result && !expanded && (
              <span className="text-[11px] text-on-surface-variant truncate italic">
                → {result.split('\n')[0].slice(0, 90)}
              </span>
            )}
            {!complete && (
              <span className="text-[11px] text-on-surface-variant italic">
                running…
              </span>
            )}
          </div>
          <span className="material-symbols-outlined text-sm text-on-surface-variant/60 flex-shrink-0">
            {expanded ? 'expand_less' : 'expand_more'}
          </span>
        </div>

        {expanded && (
          <div className="border-t border-outline-variant/20 px-4 py-3 space-y-3 animate-slide-up">
            {inputJson && (
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">
                  Input
                </div>
                <pre className="text-[11px] font-mono bg-surface-container-low rounded-lg p-2 overflow-x-auto text-on-surface-variant max-h-40">
                  {tryFormatJson(inputJson)}
                </pre>
              </div>
            )}
            {result && (
              <div>
                <div className="text-[10px] uppercase tracking-widest font-bold text-on-surface-variant mb-1">
                  Result
                </div>
                <pre className="text-[11px] font-mono bg-surface-container-low rounded-lg p-2 overflow-x-auto text-on-surface whitespace-pre-wrap max-h-60">
                  {result}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  function tryFormatJson(s: string): string {
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  }
}
