import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';

import { parseCsvTool } from './parse-csv';
import { getRocketlaneContextTool } from './get-rocketlane-context';
import { queryArtifactTool } from './query-artifact';
import { validatePlanTool } from './validate-plan';
import {
  createExecutionPlanTool,
  type CreateExecutionPlanInput,
} from './create-execution-plan';
import { updateJourneyStateTool } from './update-journey-state';
import { reflectOnFailureTool } from './reflect-on-failure';
import { rememberTool } from './remember';
import { recallTool } from './recall';

/**
 * Tool registry — the one place that glues Anthropic tool schemas
 * to their local TypeScript implementations.
 *
 * CURRENT STATE (Hour 2.5-4 checkpoint):
 *   - Group A (input): parse_csv, get_rocketlane_context, query_artifact
 *   - Group B (planning): validate_plan, create_execution_plan,
 *     update_journey_state, reflect_on_failure
 *   - Group C (memory): remember, recall
 *
 * COMING in Hour 4-5.5:
 *   - Group D (HITL — blocking): request_user_approval
 *   - Group E (creation): create_rocketlane_project, create_phase,
 *     create_task, create_tasks_bulk, add_dependency
 *   - Group F (verification): get_task, retry_task
 *   - Group G (display): display_plan_for_review, display_progress_update,
 *     display_completion_summary
 *   - Group H (server tool from Anthropic): web_search (added directly to
 *     the messages.stream tools array, not dispatched locally)
 */

// ---------- dispatcher ----------

type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolDispatchContext<Session>
) => Promise<ToolDispatchResult>;

const HANDLERS: Record<string, ToolHandler> = {
  parse_csv: (input, ctx) => parseCsvTool(input as { fileId: string }, ctx),
  get_rocketlane_context: (input, ctx) => getRocketlaneContextTool(input, ctx),
  query_artifact: (input, ctx) =>
    queryArtifactTool(input as { artifactId: string; path?: string }, ctx),
  validate_plan: (input, ctx) =>
    validatePlanTool(
      input as { plan: import('../types').Plan; sourceRowCount?: number },
      ctx
    ),
  create_execution_plan: (input, ctx) =>
    createExecutionPlanTool(input as unknown as CreateExecutionPlanInput, ctx),
  update_journey_state: (input, ctx) =>
    updateJourneyStateTool(
      input as {
        steps: Array<{ id?: string; label?: string; status?: import('../types').JourneyStatus }>;
      },
      ctx
    ),
  reflect_on_failure: (input, ctx) =>
    reflectOnFailureTool(
      input as { observation: string; hypothesis: string; next_action: string },
      ctx
    ),
  remember: (input, ctx) => rememberTool(input as { key: string; value: unknown }, ctx),
  recall: (input, ctx) => recallTool(input as { key?: string }, ctx),
};

export async function dispatch(
  name: string,
  input: unknown,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  const handler = HANDLERS[name];
  if (!handler) {
    return {
      summary: `ERROR: unknown tool "${name}". Available tools: ${Object.keys(HANDLERS).join(', ')}`,
    };
  }

  try {
    const safeInput = input && typeof input === 'object' ? (input as Record<string, unknown>) : {};
    return await handler(safeInput, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      summary: `ERROR in tool "${name}": ${message}`,
    };
  }
}

export function isKnownTool(name: string): boolean {
  return name in HANDLERS;
}

// ---------- Anthropic tool schemas ----------

export const TOOL_SCHEMAS = [
  // ------- Group A: Input & context -------

  {
    name: 'parse_csv',
    description:
      'Read a previously-uploaded CSV/Excel file from the artifact store. Returns column headers, row count, sheet names (for multi-sheet Excel), and the first 10 rows as a sample. For more rows use query_artifact with path like "rows[10:30]". Call this immediately after the user uploads a file.',
    input_schema: {
      type: 'object',
      properties: {
        fileId: {
          type: 'string',
          description:
            'The artifactId returned by the upload endpoint. Looks like "art_abc123...".',
        },
      },
      required: ['fileId'],
    },
  },

  {
    name: 'get_rocketlane_context',
    description:
      "Fetch the user's Rocketlane workspace context: existing projects (for duplicate detection and owner defaults), companies (for customer selection), and team members (for owner email). Requires the user's Rocketlane API key to have been provided earlier. Results are stored in an artifact; use query_artifact for specific slices.",
    input_schema: {
      type: 'object',
      properties: {},
    },
  },

  {
    name: 'query_artifact',
    description:
      'Read a slice of a stored artifact blob without loading the whole thing into context. Supports paths like "rows[0:10]", "teamMembers[2].email", "projects.length". Use this instead of asking for the whole artifact — it keeps token usage down.',
    input_schema: {
      type: 'object',
      properties: {
        artifactId: {
          type: 'string',
          description: 'The artifact id (looks like "art_abc123").',
        },
        path: {
          type: 'string',
          description:
            'Path into the artifact. Empty string or omitted = whole content. Examples: "rows", "rows[0]", "rows[0:10]", "projects[2].projectName", "errors.length".',
        },
      },
      required: ['artifactId'],
    },
  },

  // ------- Group B: Planning & metacognition -------

  {
    name: 'validate_plan',
    description:
      'Run 11 programmatic checks on a structured project plan. Returns errors (hard failures that must be fixed) and warnings (soft issues to acknowledge). Call this before showing the plan to the user, and again after any user-requested edits. If errors are returned, regenerate the plan to fix them and re-validate.',
    input_schema: {
      type: 'object',
      properties: {
        plan: {
          type: 'object',
          description: 'The structured plan to validate',
          properties: {
            projectName: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  type: { type: 'string', enum: ['phase', 'task', 'subtask', 'milestone'] },
                  parentId: { type: ['string', 'null'] },
                  depth: { type: 'integer' },
                  startDate: { type: ['string', 'null'] },
                  dueDate: { type: ['string', 'null'] },
                  effortInMinutes: { type: ['integer', 'null'] },
                  description: { type: ['string', 'null'] },
                  status: { type: ['integer', 'null'] },
                  progress: { type: ['integer', 'null'] },
                  milestoneCandidate: { type: 'boolean' },
                  milestoneReason: { type: ['string', 'null'] },
                  dependsOn: { type: 'array', items: { type: 'string' } },
                },
                required: ['id', 'name', 'type', 'parentId', 'depth'],
              },
            },
            sourceRowCount: { type: 'integer' },
          },
          required: ['projectName', 'items'],
        },
        sourceRowCount: {
          type: 'integer',
          description:
            'Optional: the number of rows in the source CSV. If provided, the validator warns about large mismatches.',
        },
      },
      required: ['plan'],
    },
  },

  {
    name: 'create_execution_plan',
    description:
      "Write your own TODO list as a visible card so the user can see what's coming next. Call at the start of a non-trivial goal (especially after file upload). If you change approach mid-run, call again with the updated plan — the user sees the update in real time.",
    input_schema: {
      type: 'object',
      properties: {
        goal: {
          type: 'string',
          description: 'One-sentence description of what you are trying to accomplish',
        },
        steps: {
          type: 'array',
          description: 'Ordered list of steps you plan to take',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', description: 'Short id like "parse" or "validate"' },
              label: {
                type: 'string',
                description: 'Human-readable label shown in the card',
              },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done', 'error'],
                description: 'Optional initial status (default: pending, first step = in_progress)',
              },
              notes: {
                type: 'string',
                description: 'Optional short notes shown under the step',
              },
            },
            required: ['id', 'label'],
          },
        },
      },
      required: ['goal', 'steps'],
    },
  },

  {
    name: 'update_journey_state',
    description:
      'Update the sticky journey stepper at the top of the chat UI. Call whenever your overall phase of work changes so the user always knows "where are we?". Standard 6-step journey: Connect → Upload → Analyze → Review & Approve → Execute → Complete. Initialize this at the START of every session with all 6 steps.',
    input_schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          description: 'Full stepper state (replaces previous state — always send all steps)',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done', 'error'],
              },
            },
            required: ['id', 'label', 'status'],
          },
        },
      },
      required: ['steps'],
    },
  },

  {
    name: 'reflect_on_failure',
    description:
      'Call this AFTER any tool failure or validation error, BEFORE retrying. State your observation (what happened), hypothesis (why it probably happened), and next_action (what you will try). Renders as a prominent purple card so the user sees you thinking rather than flailing. Two to four sentences per field.',
    input_schema: {
      type: 'object',
      properties: {
        observation: {
          type: 'string',
          description: 'What went wrong — the error, failure mode, or unexpected result',
        },
        hypothesis: {
          type: 'string',
          description: 'Your reasoning about why it happened',
        },
        next_action: {
          type: 'string',
          description: 'Concrete next step you will take',
        },
      },
      required: ['observation', 'hypothesis', 'next_action'],
    },
  },

  // ------- Group C: Memory -------

  {
    name: 'remember',
    description:
      'Store a named fact in working memory across turns WITHOUT cluttering conversation history. Use for: user preferences ("user_date_format": "DD/MM"), resolved ambiguities, decisions, runtime API corrections. Complement to recall.',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description:
            'Short identifier for the memory. Use namespaced keys for categories, e.g. "user_date_format", "rl_api_fix:createPhase".',
        },
        value: {
          description: 'Any JSON-serializable value (string, number, boolean, object, array).',
        },
      },
      required: ['key', 'value'],
    },
  },

  {
    name: 'recall',
    description:
      'Read a remembered fact back. If called with no key (or empty string), returns a list of all remembered keys so you know what is in memory.',
    input_schema: {
      type: 'object',
      properties: {
        key: {
          type: 'string',
          description: 'The memory key to read. Omit to list all keys.',
        },
      },
    },
  },
] as const;

export type KnownToolName = keyof typeof HANDLERS;
