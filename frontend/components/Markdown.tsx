'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/cn';

interface MarkdownProps {
  content: string;
  className?: string;
}

/**
 * Markdown — shared renderer for all agent-produced text in the chat.
 *
 * The agent streams markdown (bold, lists, code, links, tables via
 * remark-gfm). Without this component, messages like
 * `**3 team members** available` render literally with asterisks,
 * which looks like raw markup.
 *
 * The outer wrapper intentionally has NO font-size or color classes —
 * text styles inherit from the parent container. This lets the same
 * renderer work inside a chat bubble (text-sm) and a reflection field
 * (text-xs) without class conflicts. Pass a `className` if you want to
 * override layout-level things like width or spacing.
 */
export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div className={cn('leading-relaxed', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Paragraphs — tight vertical rhythm, no margin on first/last
          p: ({ children }) => (
            <p className="mb-2 last:mb-0 first:mt-0">{children}</p>
          ),
          // Strong/bold
          strong: ({ children }) => (
            <strong className="font-semibold text-on-surface">{children}</strong>
          ),
          // Emphasis/italic
          em: ({ children }) => <em className="italic">{children}</em>,
          // Unordered list — tight padding, bullet marker
          ul: ({ children }) => (
            <ul className="list-disc list-outside pl-5 mb-2 last:mb-0 space-y-1">
              {children}
            </ul>
          ),
          // Ordered list
          ol: ({ children }) => (
            <ol className="list-decimal list-outside pl-5 mb-2 last:mb-0 space-y-1">
              {children}
            </ol>
          ),
          // List items
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          // Inline code — subtle monospace chip
          code: ({ className, children, ...props }) => {
            const isBlock = className?.includes('language-');
            if (isBlock) {
              return (
                <code
                  className="block bg-surface-container-low rounded-lg p-3 text-[12px] font-mono text-on-surface overflow-x-auto my-2"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <code
                className="bg-surface-container-low rounded px-1.5 py-0.5 text-[12px] font-mono text-primary"
                {...props}
              >
                {children}
              </code>
            );
          },
          // Pre — wraps code blocks (let the inner code handle styling)
          pre: ({ children }) => <pre className="my-2">{children}</pre>,
          // Headings — the agent rarely emits these but handle them
          h1: ({ children }) => (
            <h1 className="text-base font-bold font-headline mt-2 mb-1 first:mt-0">
              {children}
            </h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-[15px] font-bold font-headline mt-2 mb-1 first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-sm font-bold font-headline mt-2 mb-1 first:mt-0">
              {children}
            </h3>
          ),
          // Links — branded, opens in new tab
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 hover:text-primary-container"
            >
              {children}
            </a>
          ),
          // Blockquote
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-primary/40 pl-3 italic text-on-surface-variant my-2">
              {children}
            </blockquote>
          ),
          // Horizontal rule
          hr: () => <hr className="my-3 border-outline-variant/30" />,
          // Tables (from remark-gfm)
          table: ({ children }) => (
            <div className="overflow-x-auto my-2">
              <table className="min-w-full text-[12px] border-collapse">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-surface-container-low">{children}</thead>,
          th: ({ children }) => (
            <th className="border border-outline-variant/30 px-2 py-1 text-left font-semibold">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border border-outline-variant/30 px-2 py-1">{children}</td>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
