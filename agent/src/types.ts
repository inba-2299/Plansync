// SYNC NOTE: Frontend mirror at frontend/lib/event-types.ts — update both when changing shared shapes
//
// Shared types used across the agent backend.
//
// Kept in one file (rather than /shared) because the agent is TypeScript
// and tsx/tsc handle relative imports best when everything is under src/.
// The frontend duplicates the AgentEvent/JourneyStep shapes in
// frontend/lib/event-types.ts — keep them in sync manually.

// ---------- Anthropic messages (minimal, local type instead of SDK namespace) ----------

export type AnthropicContentBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string | AnthropicContentBlock[];
      is_error?: boolean;
    };

export interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

// ---------- Plan (the structured project plan the agent builds) ----------

export type PlanItemType = 'phase' | 'task' | 'subtask' | 'milestone';

export interface PlanItem {
  /** Temporary client-side id the agent assigns; becomes an RL id after creation */
  id: string;
  name: string;
  type: PlanItemType;
  parentId: string | null;
  depth: number;
  startDate: string | null; // YYYY-MM-DD
  dueDate: string | null;
  effortInMinutes: number | null;
  description: string | null;
  /** 1 = To do, 2 = In progress, 3 = Completed */
  status: 1 | 2 | 3 | null;
  progress: number | null; // 0-100
  milestoneCandidate: boolean;
  milestoneReason: string | null;
  dependsOn: string[]; // references to other PlanItem.id values
}

export interface Plan {
  projectName: string;
  items: PlanItem[];
  sourceRowCount: number;
}

// ---------- Id map (tempId -> real Rocketlane id after creation) ----------

export interface IdMapEntry {
  type: 'project' | 'phase' | 'task' | 'subtask' | 'milestone';
  rlId: number;
  tempId: string;
  parentTempId: string | null;
  createdAt: number;
}

// ---------- Journey stepper (agent-driven top-level progress) ----------

export type JourneyStatus = 'pending' | 'in_progress' | 'done' | 'error';

export interface JourneyStep {
  id: string;
  label: string;
  status: JourneyStatus;
}

// ---------- SSE events (what flows from backend to frontend) ----------

export type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_use_start'; id: string; name: string }
  | { type: 'tool_input_delta'; id: string; partialJson: string }
  | { type: 'tool_use_end'; id: string }
  | { type: 'tool_result'; id: string; summary: string }
  | { type: 'display_component'; component: string; props: unknown }
  | { type: 'journey_update'; steps: JourneyStep[] }
  | { type: 'memory_write'; key: string }
  | { type: 'awaiting_user'; toolUseId: string; payload: unknown }
  | {
      // Emitted when we catch a 429 from Anthropic and are about to retry.
      // The frontend renders a dedicated "Rate limited, retrying in Xs"
      // card that replaces itself on each subsequent rate_limited event
      // and clears when the next text_delta or tool_use_start fires.
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
      // Subtype hint for the frontend so it can render a specific recovery
      // card (e.g. 'rate_limit' → show "wait + retry" guidance with a
      // "Start new session" escape hatch; 'auth' → prompt for a new API
      // key; 'generic' → default red banner).
      kind?: 'rate_limit' | 'auth' | 'generic';
    };

// ---------- Session state ----------

export interface SessionMeta {
  sessionId: string;
  createdAt: number;
  ttlAt: number;
  turnCount: number;
  /** AES-GCM encrypted Rocketlane API key (never stored in plain text) */
  rlApiKeyEnc?: string;
  rlWorkspaceId?: number;
  /** Real Rocketlane project ID after create_rocketlane_project succeeds */
  rlProjectId?: number;
  /** AES-GCM encrypted user-provided Anthropic API key (BYOK). If set, used instead of ANTHROPIC_API_KEY env var. */
  anthropicApiKeyEnc?: string;
  /** User-selected model override. Highest precedence in the model resolution chain. */
  anthropicModel?: string;
}

export interface ExecLogEntry {
  ts: number;
  tool: string;
  rlCall?: { method: string; path: string };
  rlStatus?: number;
  latencyMs?: number;
  idempotencyKey?: string;
  error?: string;
}

// ---------- Artifacts ----------

export type ArtifactKind =
  | 'csv-rows'
  | 'rl-context'
  | 'validator-report'
  | 'plan-tree'
  | 'exec-results'
  | 'generic';

export interface Artifact<T = unknown> {
  id: string;
  kind: ArtifactKind;
  /** Short human-readable summary (what the agent sees first) */
  preview: string;
  /** Full blob stored server-side; agent queries via query_artifact tool */
  content: T;
  createdAt: number;
}

// ---------- Tool dispatch ----------

/**
 * Context passed to every tool implementation.
 *
 * Tools MAY mutate `session` in-place (e.g. remember writes to
 * session.remember, create_phase adds to session.idmap). The dispatcher
 * persists session after every turn via saveSession().
 *
 * `getRlClient()` is lazy — the first caller in a turn instantiates a
 * RocketlaneClient with the decrypted API key; subsequent callers in the
 * same turn get the same instance (cached in the loop's closure). Tools
 * that don't touch Rocketlane never call it.
 *
 * RlClient is typed as `unknown` here to avoid a circular import between
 * types.ts and rocketlane/client.ts. Each tool file that uses it imports
 * the real type from '../rocketlane/client' and casts via a thin helper.
 */
export interface ToolDispatchContext<SessionT = unknown> {
  sessionId: string;
  session: SessionT;
  emit: (event: AgentEvent) => void;
  getRlClient: () => unknown;
}

export interface ToolDispatchResult {
  /** Short summary that goes back to Claude as the tool_result content */
  summary: string;
  /** Optional artifact id if the tool produced a large blob stored separately */
  artifactId?: string;
  /** Additional events to emit (beyond the standard tool_use lifecycle events) */
  events?: AgentEvent[];
  /** True only for request_user_approval — pauses the loop */
  blocking?: boolean;
  /** Payload for awaiting_user event when blocking === true */
  blockingPayload?: unknown;
}

// ---------- Validation (for validate_plan tool) ----------

export interface ValidationError {
  code: string;
  detail: string;
  itemId?: string;
}

export interface PlanStats {
  phases: number;
  tasks: number;
  subtasks: number;
  milestones: number;
  maxDepth: number;
  dependencies: number;
}

export interface ValidationResult {
  valid: boolean;
  stats?: PlanStats;
  warnings: string[];
  errors: ValidationError[];
}
