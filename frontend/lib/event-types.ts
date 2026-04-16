// SYNC NOTE: Backend source at agent/src/types.ts — update both when changing shared shapes

/**
 * Event types — frontend-side mirror of agent/src/types.ts AgentEvent.
 *
 * Kept manually in sync. If you change the AgentEvent union in the agent
 * backend, update this file too. (We chose duplication over a shared
 * package to avoid monorepo build-tool overhead for a 1.5-day project.)
 */

export type JourneyStatus = 'pending' | 'in_progress' | 'done' | 'error';

export interface JourneyStep {
  id: string;
  label: string;
  status: JourneyStatus;
}

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_input_delta'; id: string; partialJson: string }
  | { type: 'tool_use_end'; id: string }
  | { type: 'tool_result'; id: string; summary: string }
  | { type: 'display_component'; component: string; props: unknown }
  | { type: 'journey_update'; steps: JourneyStep[] }
  | { type: 'memory_write'; key: string }
  | {
      type: 'awaiting_user';
      toolUseId: string;
      payload: {
        question: string;
        options: Array<{ label: string; value: string; description?: string }>;
        context?: string | null;
      } | null;
    }
  | {
      type: 'rate_limited';
      retryInSeconds: number;
      attempt: number;
      maxAttempts: number;
      message?: string;
    }
  | { type: 'done'; stopReason?: string }
  | {
      type: 'error';
      message: string;
      kind?: 'rate_limit' | 'auth' | 'generic';
    };

/**
 * What the user clicks on in an ApprovalPrompt — sent back to /agent
 * as `uiAction` to resume the loop.
 */
export interface UiAction {
  toolUseId: string;
  data: string;
  label?: string;
}

/**
 * Display component props — kept loose because the agent backend defines
 * the shapes per component name. Each agent-emitted component file is
 * the authority on its own props shape.
 */
export interface DisplayComponentEvent {
  type: 'display_component';
  component: string;
  props: Record<string, unknown>;
}
