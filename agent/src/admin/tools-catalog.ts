/**
 * Tool catalog metadata for the admin dashboard.
 *
 * The agent has 22 tools (21 custom + 1 Anthropic server tool) organized
 * into 8 functional groups. This file exposes display metadata for each
 * one so the admin UI can render a grid of tool cards grouped by
 * category, with human-readable descriptions and toggle buttons.
 *
 * NOTE: This is UI metadata, not the actual tool schemas. The real
 * Anthropic tool schemas live in `agent/src/tools/index.ts`. Keep the
 * `name` field here in sync with that file — if a tool is renamed there,
 * update the catalog here too.
 *
 * `canDisable: false` marks tools that must NEVER be turned off via the
 * admin UI. Currently only `request_user_approval` is protected
 * (disabling it would break the entire interactive UX — it's the only
 * blocking tool in the system).
 */

export type ToolCategory =
  | 'input'
  | 'planning'
  | 'memory'
  | 'hitl'
  | 'creation'
  | 'verification'
  | 'display'
  | 'runtime_recovery';

export interface ToolCatalogEntry {
  name: string;
  displayName: string;
  category: ToolCategory;
  icon: string; // Material Symbols name
  description: string;
  canDisable: boolean;
  /** True for Anthropic server tools (we don't implement them). */
  isServerTool?: boolean;
}

export interface ToolCategoryMeta {
  id: ToolCategory;
  label: string;
  description: string;
  icon: string;
}

export const TOOL_CATEGORIES: ToolCategoryMeta[] = [
  {
    id: 'input',
    label: 'Input & Context',
    description: 'Read the user\'s file and fetch workspace state',
    icon: 'upload_file',
  },
  {
    id: 'planning',
    label: 'Planning & Metacognition',
    description: 'Self-planning, reflection, validation, journey state',
    icon: 'account_tree',
  },
  {
    id: 'memory',
    label: 'Memory',
    description: 'Named working-memory keys across turns',
    icon: 'memory',
  },
  {
    id: 'hitl',
    label: 'Human-in-the-Loop',
    description: 'The only blocking tool — pauses the loop for user input',
    icon: 'front_hand',
  },
  {
    id: 'creation',
    label: 'Creation & Mutation',
    description: 'Write project, phases, tasks, dependencies to Rocketlane',
    icon: 'add_circle',
  },
  {
    id: 'verification',
    label: 'Verification & Retry',
    description: 'Read back created entities and target retry on failures',
    icon: 'fact_check',
  },
  {
    id: 'display',
    label: 'Display',
    description: 'Emit rich cards the frontend renders inline',
    icon: 'widgets',
  },
  {
    id: 'runtime_recovery',
    label: 'Runtime Docs Recovery',
    description: 'Look up Rocketlane API changes if the cached reference goes stale',
    icon: 'public',
  },
];

export const TOOL_CATALOG: ToolCatalogEntry[] = [
  // ───── Input & Context (3) ─────
  {
    name: 'parse_csv',
    displayName: 'Parse CSV',
    category: 'input',
    icon: 'table_rows',
    description:
      'Reads the uploaded file from the artifact store and returns a summary with column headers, row count, and a sample of rows.',
    canDisable: true,
  },
  {
    name: 'get_rocketlane_context',
    displayName: 'Get Rocketlane Context',
    category: 'input',
    icon: 'cloud_download',
    description:
      'Fetches projects, customers, and team members from the user\'s Rocketlane workspace. Used to pre-populate metadata prompts.',
    canDisable: true,
  },
  {
    name: 'query_artifact',
    displayName: 'Query Artifact',
    category: 'input',
    icon: 'search',
    description:
      'Dereferences a stored blob to a specific slice (e.g. a row range or a nested field) — lets the agent read big data on demand without bloating context.',
    canDisable: true,
  },

  // ───── Planning & Metacognition (4) ─────
  {
    name: 'create_execution_plan',
    displayName: 'Create Execution Plan',
    category: 'planning',
    icon: 'checklist',
    description:
      'Writes the agent\'s own TODO list as a visible pinned card. Re-called to update step statuses as the work progresses.',
    canDisable: true,
  },
  {
    name: 'update_journey_state',
    displayName: 'Update Journey State',
    category: 'planning',
    icon: 'route',
    description:
      'Drives the sticky JourneyStepper at the top of the chat. Agent calls this at every phase transition so the user sees where the run is.',
    canDisable: true,
  },
  {
    name: 'validate_plan',
    displayName: 'Validate Plan',
    category: 'planning',
    icon: 'rule',
    description:
      'Runs 11 structural checks over the parsed plan (orphan tasks, circular deps, bad dates, missing phases, etc.). Agent self-corrects before proceeding.',
    canDisable: true,
  },
  {
    name: 'reflect_on_failure',
    displayName: 'Reflect on Failure',
    category: 'planning',
    icon: 'psychology',
    description:
      'Renders a visible purple-bordered "Observation / Hypothesis / Next action" card. Agent calls this after any error before retrying.',
    canDisable: true,
  },

  // ───── Memory (2) ─────
  {
    name: 'remember',
    displayName: 'Remember',
    category: 'memory',
    icon: 'bookmark_add',
    description:
      'Writes a named fact to working memory (e.g. "user_date_format=DD/MM"). Kept out of conversation history to avoid bloat.',
    canDisable: true,
  },
  {
    name: 'recall',
    displayName: 'Recall',
    category: 'memory',
    icon: 'bookmark',
    description:
      'Reads a previously-remembered fact back by key. Used when the agent needs a value from earlier in the session.',
    canDisable: true,
  },

  // ───── HITL (1) — PROTECTED ─────
  {
    name: 'request_user_approval',
    displayName: 'Request User Approval',
    category: 'hitl',
    icon: 'front_hand',
    description:
      'The ONLY blocking tool. Pauses the loop and emits a clickable approval card. Used for API key entry, workspace confirmation, file upload, plan approval, metadata gathering. Cannot be disabled — the entire interactive UX depends on it.',
    canDisable: false,
  },

  // ───── Creation & Mutation (6) ─────
  {
    name: 'execute_plan_creation',
    displayName: 'Execute Plan Creation',
    category: 'creation',
    icon: 'rocket_launch',
    description:
      'The happy-path batch tool. Loads the parsed plan from the artifact store and creates the full project (phases → tasks → subtasks → milestones → dependencies) in one backend call. 10× cheaper and 35× faster than fine-grained execution.',
    canDisable: true,
  },
  {
    name: 'create_rocketlane_project',
    displayName: 'Create Project',
    category: 'creation',
    icon: 'folder_special',
    description:
      'POST /projects — creates the Rocketlane project shell. Used as a fallback when `execute_plan_creation` hits an error that needs surgical recovery.',
    canDisable: true,
  },
  {
    name: 'create_phase',
    displayName: 'Create Phase',
    category: 'creation',
    icon: 'workspaces',
    description:
      'POST /phases — creates a phase with required start/end dates. Phase dates are required by Rocketlane; agent derives them from children if not explicit.',
    canDisable: true,
  },
  {
    name: 'create_task',
    displayName: 'Create Task',
    category: 'creation',
    icon: 'task_alt',
    description:
      'POST /tasks — creates a single task, subtask, or milestone. Used for targeted recovery. Subtasks use parent.taskId, milestones use type: MILESTONE.',
    canDisable: true,
  },
  {
    name: 'create_tasks_bulk',
    displayName: 'Create Tasks (Bulk)',
    category: 'creation',
    icon: 'playlist_add',
    description:
      'Batch-creates all tasks within a single phase. Idempotency-keyed to prevent double-creation on retry.',
    canDisable: true,
  },
  {
    name: 'add_dependency',
    displayName: 'Add Dependency',
    category: 'creation',
    icon: 'link',
    description:
      'POST /tasks/{id}/add-dependencies — creates the second-pass dependency edges after all tasks exist. Two-pass creation is required by Rocketlane.',
    canDisable: true,
  },

  // ───── Verification & Retry (2) ─────
  {
    name: 'get_task',
    displayName: 'Get Task',
    category: 'verification',
    icon: 'visibility',
    description:
      'GET /tasks/{id} — read-back verification after creation. Agent spot-checks whether a task was actually created correctly.',
    canDisable: true,
  },
  {
    name: 'retry_task',
    displayName: 'Retry Task',
    category: 'verification',
    icon: 'restart_alt',
    description:
      'Targeted retry of a single failed task with corrected args. Skips gracefully if the tempId is already in the idmap.',
    canDisable: true,
  },

  // ───── Display (3) ─────
  {
    name: 'display_plan_for_review',
    displayName: 'Display Plan for Review',
    category: 'display',
    icon: 'account_tree',
    description:
      'Emits a PlanReviewTree card showing all phases / tasks / subtasks / milestones / dependencies in a collapsible structure. Typically called before the plan-approval request_user_approval.',
    canDisable: true,
  },
  {
    name: 'display_progress_update',
    displayName: 'Display Progress Update',
    category: 'display',
    icon: 'trending_up',
    description:
      'Emits a ProgressFeed card with current completion percentage. Called periodically during execution.',
    canDisable: true,
  },
  {
    name: 'display_completion_summary',
    displayName: 'Display Completion Summary',
    category: 'display',
    icon: 'celebration',
    description:
      'Emits the final CompletionCard with stats (phases/tasks/milestones/dependencies created), build duration, and a "View in Rocketlane" link.',
    canDisable: true,
  },

  // ───── Runtime Docs Recovery (1, server tool) ─────
  {
    name: 'web_search',
    displayName: 'Web Search',
    category: 'runtime_recovery',
    icon: 'public',
    description:
      'Anthropic-hosted server tool. The agent uses this when a Rocketlane endpoint fails with an unknown-field error (suggesting the API has changed). Searches for current docs, caches the fix via `remember`, and retries.',
    canDisable: true,
    isServerTool: true,
  },
];

/** Count tools in each category for the UI's "Group header (N)" labels. */
export function countByCategory(): Record<ToolCategory, number> {
  const counts: Record<string, number> = {};
  for (const t of TOOL_CATALOG) {
    counts[t.category] = (counts[t.category] ?? 0) + 1;
  }
  return counts as Record<ToolCategory, number>;
}
