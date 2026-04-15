import { Chat } from '@/components/Chat';

/**
 * Plansync home page — single page, single component.
 *
 * The Chat component is the entire app: orchestrates the agent loop,
 * holds the message timeline, renders all agent-emitted components, and
 * provides the input footer. There is no other route except /admin
 * (coming after the take-home submission).
 */
export default function Home() {
  return <Chat />;
}
