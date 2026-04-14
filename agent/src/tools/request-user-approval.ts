import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';

/**
 * request_user_approval(question, options, context?) — Group D HITL tool.
 *
 * THE ONLY BLOCKING TOOL. When this is called:
 *   1. The tool returns `blocking: true` in its result
 *   2. The ReAct loop sees the flag, emits an `awaiting_user` SSE event
 *      with the toolUseId + payload, persists `pending` on the session,
 *      and closes the HTTP response
 *   3. Frontend renders an ApprovalPrompt with the clickable options
 *   4. User clicks → frontend POSTs to /agent with uiAction: {toolUseId, data}
 *   5. Loop resumes: the uiAction is injected as a tool_result for this
 *      toolUseId, and the conversation continues from Claude's next turn
 *
 * Agent uses this for: API key entry, file upload prompts, plan approval,
 * ambiguous date resolution, deep-nesting decisions, duplicate handling,
 * retry/skip/abort choices.
 */

export interface RequestUserApprovalInput {
  question: string;
  options: Array<{
    label: string;
    value: string;
    description?: string;
  }>;
  context?: string;
}

const MAX_OPTIONS = 6;

export async function requestUserApprovalTool(
  input: RequestUserApprovalInput,
  _ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.question || typeof input.question !== 'string') {
    return { summary: 'ERROR: request_user_approval requires `question` (non-empty string)' };
  }

  if (!Array.isArray(input.options) || input.options.length === 0) {
    return {
      summary:
        'ERROR: request_user_approval requires `options` (non-empty array of {label, value, description?})',
    };
  }

  if (input.options.length > MAX_OPTIONS) {
    return {
      summary: `ERROR: too many options (${input.options.length}). Max ${MAX_OPTIONS}. Collapse similar options into fewer choices.`,
    };
  }

  const options = input.options.map((o, i) => ({
    label: typeof o?.label === 'string' && o.label.length > 0 ? o.label : `Option ${i + 1}`,
    value: typeof o?.value === 'string' && o.value.length > 0 ? o.value : `opt_${i}`,
    description: typeof o?.description === 'string' ? o.description : undefined,
  }));

  return {
    summary: `Awaiting user choice: "${input.question}"\nOptions: ${options
      .map((o) => `${o.label} (value=${o.value})`)
      .join(' | ')}`,
    blocking: true,
    blockingPayload: {
      question: input.question,
      options,
      context: input.context ?? null,
    },
  };
}
