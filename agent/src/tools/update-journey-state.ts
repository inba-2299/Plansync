import type {
  JourneyStep,
  JourneyStatus,
  ToolDispatchContext,
  ToolDispatchResult,
} from '../types';
import type { Session } from '../memory/session';

/**
 * update_journey_state(steps[]) — Group B planning tool.
 *
 * Agent-driven progress stepper. The agent calls this whenever the
 * overall phase of its work changes. Frontend renders a sticky
 * JourneyStepper at the top of the chat UI.
 *
 * Standard six-step journey:
 *   Connect → Upload → Analyze → Review & Approve → Execute → Complete
 *
 * But the agent may customize (e.g. sub-steps during execution).
 *
 * State is REPORTED by the agent, not ENFORCED by the backend.
 */

const VALID_STATUSES: ReadonlyArray<JourneyStatus> = [
  'pending',
  'in_progress',
  'done',
  'error',
];

export interface UpdateJourneyStateInput {
  steps: Array<{ id?: string; label?: string; status?: JourneyStatus }>;
}

export async function updateJourneyStateTool(
  input: UpdateJourneyStateInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!Array.isArray(input?.steps) || input.steps.length === 0) {
    return {
      summary:
        'ERROR: update_journey_state requires `steps` (non-empty array of {id, label, status})',
    };
  }

  const steps: JourneyStep[] = input.steps.map((s, i) => {
    const status: JourneyStatus =
      s?.status && VALID_STATUSES.includes(s.status) ? s.status : 'pending';
    return {
      id: typeof s?.id === 'string' && s.id ? s.id : `step_${i + 1}`,
      label: typeof s?.label === 'string' && s.label ? s.label : `Step ${i + 1}`,
      status,
    };
  });

  ctx.session.journey = steps;

  const trail = steps
    .map((s) => {
      const icon =
        s.status === 'done'
          ? '✓'
          : s.status === 'in_progress'
            ? '●'
            : s.status === 'error'
              ? '✗'
              : '○';
      return `${icon} ${s.label}`;
    })
    .join(' → ');

  return {
    summary: `Journey updated: ${trail}`,
    events: [
      {
        type: 'journey_update',
        steps,
      },
    ],
  };
}
