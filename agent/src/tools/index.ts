import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';

// Group A: Input & context
import { parseCsvTool } from './parse-csv';
import { getRocketlaneContextTool } from './get-rocketlane-context';
import { queryArtifactTool } from './query-artifact';

// Group B: Planning & metacognition
import { validatePlanTool } from './validate-plan';
import {
  createExecutionPlanTool,
  type CreateExecutionPlanInput,
} from './create-execution-plan';
import { updateJourneyStateTool } from './update-journey-state';
import { reflectOnFailureTool } from './reflect-on-failure';

// Group C: Memory
import { rememberTool } from './remember';
import { recallTool } from './recall';

// Group D: HITL (blocking)
import { requestUserApprovalTool } from './request-user-approval';

// Group E: Creation
import { createRocketlaneProjectTool } from './create-rocketlane-project';
import { createPhaseTool } from './create-phase';
import { createTaskTool, type CreateTaskInput } from './create-task';
import { createTasksBulkTool } from './create-tasks-bulk';
import { addDependencyTool } from './add-dependency';
import { executePlanCreationTool } from './execute-plan-creation';

// Group F: Verification
import { getTaskTool } from './get-task';
import { retryTaskTool } from './retry-task';

// Group G: Display
import { displayPlanForReviewTool } from './display-plan-for-review';
import { displayProgressUpdateTool } from './display-progress-update';
import { displayCompletionSummaryTool } from './display-completion-summary';

/**
 * Tool registry — glues Anthropic tool schemas to local handlers.
 *
 * 20 custom tools organized into 7 groups + 1 Anthropic server tool (web_search)
 * added directly to the tools array in loop.ts.
 */

// ---------- dispatcher ----------

type ToolHandler = (
  input: Record<string, unknown>,
  ctx: ToolDispatchContext<Session>
) => Promise<ToolDispatchResult>;

const HANDLERS: Record<string, ToolHandler> = {
  // Group A
  parse_csv: (input, ctx) => parseCsvTool(input as { fileId: string }, ctx),
  get_rocketlane_context: (input, ctx) => getRocketlaneContextTool(input, ctx),
  query_artifact: (input, ctx) =>
    queryArtifactTool(input as { artifactId: string; path?: string }, ctx),

  // Group B
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

  // Group C
  remember: (input, ctx) => rememberTool(input as { key: string; value: unknown }, ctx),
  recall: (input, ctx) => recallTool(input as { key?: string }, ctx),

  // Group D (blocking)
  request_user_approval: (input, ctx) =>
    requestUserApprovalTool(
      input as {
        question: string;
        options: Array<{ label: string; value: string; description?: string }>;
        context?: string;
      },
      ctx
    ),

  // Group E (creation)
  create_rocketlane_project: (input, ctx) =>
    createRocketlaneProjectTool(
      input as {
        projectName: string;
        ownerEmail: string;
        customerName: string;
        startDate?: string;
        dueDate?: string;
        description?: string;
      },
      ctx
    ),
  create_phase: (input, ctx) =>
    createPhaseTool(
      input as {
        tempId: string;
        phaseName: string;
        startDate: string;
        dueDate: string;
        description?: string;
      },
      ctx
    ),
  create_task: (input, ctx) => createTaskTool(input as unknown as CreateTaskInput, ctx),
  create_tasks_bulk: (input, ctx) =>
    createTasksBulkTool(
      input as {
        phaseTempId: string;
        tasks: Array<unknown>;
      } as unknown as import('./create-tasks-bulk').CreateTasksBulkInput,
      ctx
    ),
  add_dependency: (input, ctx) =>
    addDependencyTool(
      input as { fromTempId: string; toTempId: string; type?: string; lagDays?: number } as unknown as import('./add-dependency').AddDependencyInput,
      ctx
    ),
  execute_plan_creation: (input, ctx) =>
    executePlanCreationTool(
      input as unknown as import('./execute-plan-creation').ExecutePlanCreationInput,
      ctx
    ),

  // Group F (verification)
  get_task: (input, ctx) =>
    getTaskTool(input as { rlId?: number; tempId?: string }, ctx),
  retry_task: (input, ctx) => retryTaskTool(input as unknown as CreateTaskInput, ctx),

  // Group G (display)
  display_plan_for_review: (input, ctx) =>
    displayPlanForReviewTool(input as { plan: import('../types').Plan }, ctx),
  display_progress_update: (input, ctx) =>
    displayProgressUpdateTool(
      input as { completed: number; total: number; currentPhase?: string; detail?: string },
      ctx
    ),
  display_completion_summary: (input, ctx) =>
    displayCompletionSummaryTool(
      input as unknown as import('./display-completion-summary').DisplayCompletionSummaryInput,
      ctx
    ),
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

export type KnownToolName = keyof typeof HANDLERS;

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
        fileId: { type: 'string', description: 'Artifact id returned by upload.' },
      },
      required: ['fileId'],
    },
  },

  {
    name: 'get_rocketlane_context',
    description:
      "Fetch the user's Rocketlane workspace context: existing projects (duplicate detection + owner defaults), companies (customer selection), team members (owner email selection). Requires the user's Rocketlane API key to have been stored earlier. Stored as an artifact; use query_artifact for specific slices.",
    input_schema: { type: 'object', properties: {} },
  },

  {
    name: 'query_artifact',
    description:
      'Read a slice of a stored artifact blob without loading the whole thing. Path syntax: "rows[0:10]", "teamMembers[2].email", "projects.length". Keeps token usage bounded.',
    input_schema: {
      type: 'object',
      properties: {
        artifactId: { type: 'string' },
        path: {
          type: 'string',
          description:
            'Path into the artifact. Empty = whole content. Examples: "rows", "rows[0:10]", "projects[2].projectName".',
        },
      },
      required: ['artifactId'],
    },
  },

  // ------- Group B: Planning & metacognition -------

  {
    name: 'validate_plan',
    description:
      'Run 11 programmatic checks on a structured project plan. Returns errors (must fix) and warnings (acknowledge). Call before showing the plan to the user and after any user-requested edits. Regenerate and re-validate on errors.',
    input_schema: {
      type: 'object',
      properties: {
        plan: {
          type: 'object',
          properties: {
            projectName: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  name: { type: 'string' },
                  type: {
                    type: 'string',
                    enum: ['phase', 'task', 'subtask', 'milestone'],
                  },
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
          },
          required: ['projectName', 'items'],
        },
        sourceRowCount: { type: 'integer' },
      },
      required: ['plan'],
    },
  },

  {
    name: 'create_execution_plan',
    description:
      "Write your own TODO list as a visible card so the user can see what's coming next. Call at the start of a non-trivial goal. If you change approach mid-run, call again with the updated plan.",
    input_schema: {
      type: 'object',
      properties: {
        goal: { type: 'string' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              status: {
                type: 'string',
                enum: ['pending', 'in_progress', 'done', 'error'],
              },
              notes: { type: 'string' },
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
      'Update the sticky journey stepper at the top of the chat UI. Always send the FULL steps list, not a delta. Initialize at session start with 6 standard steps: Connect → Upload → Analyze → Review & Approve → Execute → Complete.',
    input_schema: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
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
      'Call AFTER any tool failure or validation error, BEFORE retrying. State observation, hypothesis, next_action. Renders as a prominent purple card. Two to four sentences per field.',
    input_schema: {
      type: 'object',
      properties: {
        observation: { type: 'string' },
        hypothesis: { type: 'string' },
        next_action: { type: 'string' },
      },
      required: ['observation', 'hypothesis', 'next_action'],
    },
  },

  // ------- Group C: Memory -------

  {
    name: 'remember',
    description:
      'Store a named fact in working memory across turns without cluttering conversation history. Use for user preferences, resolved ambiguities, decisions, runtime API corrections.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        value: { description: 'Any JSON-serializable value' },
      },
      required: ['key', 'value'],
    },
  },

  {
    name: 'recall',
    description: 'Read a remembered fact. Omit key to list all remembered keys.',
    input_schema: {
      type: 'object',
      properties: { key: { type: 'string' } },
    },
  },

  // ------- Group D: HITL (BLOCKING) -------

  {
    name: 'request_user_approval',
    description:
      'THE ONLY BLOCKING TOOL. Pauses the agent loop and shows the user a prompt with clickable options. Use for: API key entry, file upload prompts, plan approval, ambiguous date resolution, deep-nesting decisions, duplicate handling, retry/skip/abort choices. The agent resumes when the user clicks an option. Max 6 options.',
    input_schema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to show the user' },
        options: {
          type: 'array',
          maxItems: 6,
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Button label shown to user' },
              value: {
                type: 'string',
                description: 'Machine value passed back in the tool_result',
              },
              description: { type: 'string', description: 'Optional sub-text shown under label' },
            },
            required: ['label', 'value'],
          },
        },
        context: { type: 'string', description: 'Optional extra context shown to the user' },
      },
      required: ['question', 'options'],
    },
  },

  // ------- Group E: Creation -------

  {
    name: 'create_rocketlane_project',
    description:
      'Create the Rocketlane project shell. First call of pass 1. Stores projectId for subsequent create_phase calls. ownerEmail must be a TEAM_MEMBER email (get from get_rocketlane_context). autoCreateCompany: true creates the customer if missing.',
    input_schema: {
      type: 'object',
      properties: {
        projectName: { type: 'string' },
        ownerEmail: { type: 'string' },
        customerName: { type: 'string' },
        startDate: { type: 'string', description: 'YYYY-MM-DD' },
        dueDate: { type: 'string', description: 'YYYY-MM-DD' },
        description: { type: 'string' },
      },
      required: ['projectName', 'ownerEmail', 'customerName'],
    },
  },

  {
    name: 'create_phase',
    description:
      'Create one phase. Requires the project to already exist in this session (via create_rocketlane_project). Both dates are REQUIRED by Rocketlane. tempId is the agent-assigned plan item id used to reference this phase in subsequent create_task calls.',
    input_schema: {
      type: 'object',
      properties: {
        tempId: { type: 'string' },
        phaseName: { type: 'string' },
        startDate: { type: 'string' },
        dueDate: { type: 'string' },
        description: { type: 'string' },
      },
      required: ['tempId', 'phaseName', 'startDate', 'dueDate'],
    },
  },

  {
    name: 'create_task',
    description:
      'Create ONE task, subtask, or milestone. For a regular task: omit parentTempId. For a subtask: set parentTempId to parent task tempId. For a milestone: set type=MILESTONE. Prefer create_tasks_bulk when creating many tasks in one phase.',
    input_schema: {
      type: 'object',
      properties: {
        tempId: { type: 'string' },
        phaseTempId: { type: 'string' },
        parentTempId: { type: 'string' },
        taskName: { type: 'string' },
        type: { type: 'string', enum: ['TASK', 'MILESTONE'] },
        startDate: { type: 'string' },
        dueDate: { type: 'string' },
        effortInMinutes: { type: 'integer' },
        progress: { type: 'integer', minimum: 0, maximum: 100 },
        status: { type: 'integer', enum: [1, 2, 3] },
        description: { type: 'string' },
      },
      required: ['tempId', 'phaseTempId', 'taskName'],
    },
  },

  {
    name: 'create_tasks_bulk',
    description:
      'Hot path for execution. Creates all tasks in one phase in one tool call, with progress events every 3 tasks. Tasks must be ordered: parents before children. Continues past individual failures and returns a {created, failed} summary — retry failures with retry_task.',
    input_schema: {
      type: 'object',
      properties: {
        phaseTempId: { type: 'string' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              tempId: { type: 'string' },
              parentTempId: { type: 'string' },
              taskName: { type: 'string' },
              type: { type: 'string', enum: ['TASK', 'MILESTONE'] },
              startDate: { type: 'string' },
              dueDate: { type: 'string' },
              effortInMinutes: { type: 'integer' },
              progress: { type: 'integer' },
              status: { type: 'integer', enum: [1, 2, 3] },
              description: { type: 'string' },
            },
            required: ['tempId', 'taskName'],
          },
        },
      },
      required: ['phaseTempId', 'tasks'],
    },
  },

  {
    name: 'add_dependency',
    description:
      'PASS 2 tool. fromTempId depends on toTempId (fromTempId cannot start until toTempId finishes). Both tempIds must exist in session idmap from pass 1. Rocketlane only supports Finish-to-Start at the API level; type/lagDays parameters are accepted but only FS with no lag is actually set.',
    input_schema: {
      type: 'object',
      properties: {
        fromTempId: { type: 'string' },
        toTempId: { type: 'string' },
        type: { type: 'string', enum: ['FS', 'SS', 'FF', 'SF'] },
        lagDays: { type: 'integer' },
      },
      required: ['fromTempId', 'toTempId'],
    },
  },

  {
    name: 'execute_plan_creation',
    description:
      "THE HAPPY PATH for creating a Rocketlane project from an approved plan. Batches the entire execution (project shell, phases, tasks, subtasks, milestones in pass 1; dependencies in pass 2) into a single tool call. Takes the plan via artifactId (from display_plan_for_review) so the full plan JSON doesn't have to pass through the tool input — massively reduces token cost vs calling create_phase/create_task/add_dependency individually. Emits ProgressFeed events throughout so the frontend card updates in real time. Call this AFTER: (1) the plan has been validated, (2) display_plan_for_review has been called and returned an artifactId, (3) the user has approved the plan via request_user_approval, and (4) you've collected project metadata (name/customer/owner/dates) via sequential approvals. Returns a summary with counts of successes and failures. For any failed items listed in the summary, fall back to fine-grained tools (retry_task, create_task, add_dependency) to recover individually.",
    input_schema: {
      type: 'object',
      properties: {
        planArtifactId: {
          type: 'string',
          description:
            'The artifactId returned by display_plan_for_review. Required — the tool loads the plan from this artifact instead of re-inlining it.',
        },
        projectName: { type: 'string' },
        ownerEmail: {
          type: 'string',
          description: 'A TEAM_MEMBER email from get_rocketlane_context',
        },
        customerName: {
          type: 'string',
          description:
            "A customer company name from get_rocketlane_context, OR a new name — the Rocketlane API auto-creates the company if it doesn't exist.",
        },
        startDate: {
          type: 'string',
          description: 'YYYY-MM-DD format. The project start date.',
        },
        dueDate: {
          type: 'string',
          description: 'YYYY-MM-DD format. The project end date.',
        },
        description: { type: 'string' },
      },
      required: [
        'planArtifactId',
        'projectName',
        'ownerEmail',
        'customerName',
        'startDate',
        'dueDate',
      ],
    },
  },

  // ------- Group F: Verification -------

  {
    name: 'get_task',
    description:
      'Read a task directly from Rocketlane for verification. Accepts either rlId (number — real Rocketlane ID) or tempId (string — resolved via session idmap). Use after create_tasks_bulk to spot-check a sample.',
    input_schema: {
      type: 'object',
      properties: {
        rlId: { type: 'integer' },
        tempId: { type: 'string' },
      },
    },
  },

  {
    name: 'retry_task',
    description:
      'Retry a failed task creation with corrected arguments. Same input schema as create_task. Skips if the tempId was successfully created on a previous attempt (idempotent).',
    input_schema: {
      type: 'object',
      properties: {
        tempId: { type: 'string' },
        phaseTempId: { type: 'string' },
        parentTempId: { type: 'string' },
        taskName: { type: 'string' },
        type: { type: 'string', enum: ['TASK', 'MILESTONE'] },
        startDate: { type: 'string' },
        dueDate: { type: 'string' },
        effortInMinutes: { type: 'integer' },
        progress: { type: 'integer' },
        status: { type: 'integer', enum: [1, 2, 3] },
        description: { type: 'string' },
      },
      required: ['tempId', 'phaseTempId', 'taskName'],
    },
  },

  // ------- Group G: Display -------

  {
    name: 'display_plan_for_review',
    description:
      'Render the structured plan as a PlanReviewTree card so the user can review it before approving. Typically called immediately before request_user_approval. Also stores the plan as an artifact for later reference.',
    input_schema: {
      type: 'object',
      properties: {
        plan: {
          type: 'object',
          description: 'Same shape as validate_plan input',
        },
      },
      required: ['plan'],
    },
  },

  {
    name: 'display_progress_update',
    description:
      'Update the ProgressFeed card during long-running execution. Called periodically (e.g. during create_tasks_bulk). completed + total drive the progress bar; currentPhase + detail give contextual text.',
    input_schema: {
      type: 'object',
      properties: {
        completed: { type: 'integer' },
        total: { type: 'integer' },
        currentPhase: { type: 'string' },
        detail: { type: 'string' },
      },
      required: ['completed', 'total'],
    },
  },

  {
    name: 'display_completion_summary',
    description:
      'Render the final CompletionCard at the end of a successful run. Shows stats + link to the created project in Rocketlane. Call this exactly once at the end.',
    input_schema: {
      type: 'object',
      properties: {
        stats: {
          type: 'object',
          properties: {
            phasesCreated: { type: 'integer' },
            tasksCreated: { type: 'integer' },
            subtasksCreated: { type: 'integer' },
            milestonesCreated: { type: 'integer' },
            dependenciesCreated: { type: 'integer' },
            totalCreated: { type: 'integer' },
            failed: { type: 'integer' },
            durationSeconds: { type: 'number' },
          },
        },
        projectUrl: { type: 'string' },
        projectName: { type: 'string' },
      },
      required: ['stats'],
    },
  },
] as const;
