/**
 * History Integrity — a first-class agent capability.
 *
 * Validates and repairs the conversation history before it's sent to the
 * Anthropic API. Mirrors the role of `validate_plan` for user-provided
 * plans: proactive checks + automatic repair where possible, and clear
 * reporting when repair isn't possible.
 *
 * Anthropic enforces three structural invariants in multi-turn tool-use
 * conversations:
 *
 *   1. Every assistant `tool_use` block must have a matching `tool_result`
 *      block in the very next user message.
 *   2. Every user `tool_result` block must have a matching `tool_use` block
 *      in the immediately-preceding assistant message.
 *   3. No duplicate `tool_result` blocks for the same `tool_use_id`.
 *
 * Violations of any of these produce a 400 invalid_request_error that
 * blocks ALL future turns in the session until the history is fixed.
 *
 * We encounter violations in three scenarios:
 *   - User types free text while an approval is pending (orphan tool_use)
 *   - User re-clicks an already-answered approval card (orphan tool_result)
 *   - A race or bug produces duplicate results for the same tool_use_id
 *
 * This module walks the history and repairs each violation according to
 * the best-available strategy, keeping the session alive without requiring
 * the user to start over.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export type RepairAction =
  | {
      kind: 'synthesized_missing_tool_result';
      toolUseId: string;
      reason: string;
    }
  | {
      kind: 'removed_orphan_tool_result';
      toolUseId: string;
      reason: string;
    }
  | {
      kind: 'removed_duplicate_tool_result';
      toolUseId: string;
      reason: string;
    };

export interface IntegrityReport {
  valid: boolean;
  repairs: RepairAction[];
}

/**
 * Validate the conversation history and mutate in place to repair any
 * violations of Anthropic's tool_use / tool_result invariants. Returns
 * a report describing what was valid or what was repaired. Empty
 * repairs list = history was already valid.
 */
export function validateAndRepairHistory(history: any[]): IntegrityReport {
  const repairs: RepairAction[] = [];

  for (let i = 0; i < history.length; i++) {
    const msg = history[i];

    // Assistant messages may contain tool_use blocks
    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      const toolUseIds = collectToolUseIds(msg.content);
      if (toolUseIds.length === 0) continue;

      // Locate the very next user message. That's where the tool_results belong.
      const nextUserIdx = findNextUserMessage(history, i);
      const nextUser = nextUserIdx >= 0 ? history[nextUserIdx] : null;

      // Apply Invariant 1: every tool_use needs a tool_result in the next user msg
      const resultIds = nextUser ? collectToolResultIds(nextUser.content) : new Set<string>();
      const missing = toolUseIds.filter((id) => !resultIds.has(id));

      if (missing.length > 0) {
        const synthetic = missing.map((id) => ({
          type: 'tool_result' as const,
          tool_use_id: id,
          content:
            'The user did not respond to this action via the expected channel. Treat this step as abandoned and continue with the conversation; do not re-ask if the user has already moved on.',
        }));

        if (nextUser && Array.isArray(nextUser.content)) {
          nextUser.content = [...synthetic, ...nextUser.content];
        } else if (nextUser && typeof nextUser.content === 'string') {
          nextUser.content = [...synthetic, { type: 'text', text: nextUser.content }];
        } else {
          history.splice(i + 1, 0, { role: 'user', content: synthetic });
        }

        for (const id of missing) {
          repairs.push({
            kind: 'synthesized_missing_tool_result',
            toolUseId: id,
            reason: 'User did not click the approval; treating step as abandoned.',
          });
        }
      }
    }

    // User messages may contain tool_result blocks
    if (msg.role === 'user' && Array.isArray(msg.content)) {
      // Locate the immediately-preceding assistant message. Tool_results
      // must reference tool_uses that appeared there.
      const prevAssistantIdx = findPrevAssistantMessage(history, i);
      const prevAssistant = prevAssistantIdx >= 0 ? history[prevAssistantIdx] : null;
      const expectedIds = new Set(
        prevAssistant ? collectToolUseIds(prevAssistant.content) : []
      );

      // Invariant 2: every tool_result must reference a tool_use in the previous assistant message
      // Invariant 3: no duplicate tool_results for the same tool_use_id
      const seen = new Set<string>();
      const repairedContent: any[] = [];

      for (const block of msg.content) {
        if (!block || typeof block !== 'object' || block.type !== 'tool_result') {
          repairedContent.push(block);
          continue;
        }

        const id = block.tool_use_id;

        // Orphan tool_result (no matching tool_use in prev assistant msg)
        if (!expectedIds.has(id as string)) {
          repairs.push({
            kind: 'removed_orphan_tool_result',
            toolUseId: id as string,
            reason: 'tool_result referenced a tool_use that does not exist in the previous assistant message (likely a re-click on an already-answered approval).',
          });
          continue; // drop the block
        }

        // Duplicate tool_result for same tool_use_id
        if (seen.has(id as string)) {
          repairs.push({
            kind: 'removed_duplicate_tool_result',
            toolUseId: id as string,
            reason: 'Duplicate tool_result for the same tool_use_id. Keeping the first occurrence only.',
          });
          continue; // drop the duplicate
        }

        seen.add(id as string);
        repairedContent.push(block);
      }

      // Only mutate if we actually made changes
      if (repairedContent.length !== msg.content.length) {
        // If we removed everything and there's nothing left, drop this user message entirely
        // so we don't send an empty message to Anthropic.
        if (repairedContent.length === 0) {
          history.splice(i, 1);
          i--; // re-check at this index
        } else {
          msg.content = repairedContent;
        }
      }
    }
  }

  return {
    valid: repairs.length === 0,
    repairs,
  };
}

// ---------------- helpers ----------------

/**
 * Collect tool_use IDs from an assistant message content (array or string).
 */
function collectToolUseIds(content: any): string[] {
  if (!Array.isArray(content)) return [];
  const ids: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      block.type === 'tool_use' &&
      typeof block.id === 'string'
    ) {
      ids.push(block.id);
    }
  }
  return ids;
}

/**
 * Collect tool_result IDs from a user message content (array or string).
 * Returns a Set for O(1) lookup.
 */
function collectToolResultIds(content: any): Set<string> {
  const ids = new Set<string>();
  if (!Array.isArray(content)) return ids;
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      block.type === 'tool_result' &&
      typeof block.tool_use_id === 'string'
    ) {
      ids.add(block.tool_use_id);
    }
  }
  return ids;
}

function findNextUserMessage(history: any[], afterIdx: number): number {
  for (let i = afterIdx + 1; i < history.length; i++) {
    if (history[i].role === 'user') return i;
  }
  return -1;
}

function findPrevAssistantMessage(history: any[], beforeIdx: number): number {
  for (let i = beforeIdx - 1; i >= 0; i--) {
    if (history[i].role === 'assistant') return i;
  }
  return -1;
}
