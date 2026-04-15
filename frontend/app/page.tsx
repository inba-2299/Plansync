import { Chat } from '@/components/Chat';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/**
 * Plansync home page — single page, single component.
 *
 * The Chat component is the entire app: orchestrates the agent loop,
 * holds the message timeline, renders all agent-emitted components, and
 * provides the input footer. There is no other route except /admin
 * (coming after the take-home submission).
 *
 * Wrapped in an ErrorBoundary so a render crash in any agent-emitted
 * card degrades to a recoverable "Something went wrong" card instead
 * of a blanket "Application error: a client-side exception has occurred"
 * white-page. Added after a Session 4 production crash where a
 * Haiku-generated plan had an item missing `dependsOn`.
 */
export default function Home() {
  return (
    <ErrorBoundary>
      <Chat />
    </ErrorBoundary>
  );
}
