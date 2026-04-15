import { cn } from '@/lib/cn';
import { Markdown } from './Markdown';

interface MessageBubbleProps {
  role: 'user' | 'agent';
  content: string;
}

/**
 * MessageBubble — user message in the chat timeline.
 *
 * User messages are right-aligned with the brand gradient (no markdown
 * rendering — user text is plain). Agent "reasoning" messages don't
 * use this component — they use ReasoningBubble.tsx for the collapsible
 * behavior. When the agent sends a non-reasoning text message (rare),
 * it renders as an agent bubble here with full markdown.
 */
export function MessageBubble({ role, content }: MessageBubbleProps) {
  if (role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-gradient-to-br from-primary to-primary-container text-white rounded-3xl rounded-br-md px-5 py-3 shadow-card-sm">
          <div className="text-sm whitespace-pre-wrap leading-relaxed">{content}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'max-w-[85%] bg-surface-container-lowest border border-outline-variant/30 rounded-3xl rounded-bl-md px-5 py-3 shadow-card-sm'
        )}
      >
        <Markdown content={content} />
      </div>
    </div>
  );
}
