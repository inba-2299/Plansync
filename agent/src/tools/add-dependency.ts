import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import type { RocketlaneClient } from '../rocketlane/client';
import { RocketlaneError } from '../rocketlane/client';

/**
 * add_dependency(fromTempId, toTempId, type?, lagDays?) — Group E tool.
 *
 * PASS 2 of two-pass creation. Both tempIds must already exist in the
 * session idmap (i.e. their entities were created in pass 1). Resolves
 * tempIds → real taskIds and calls Rocketlane's add-dependencies endpoint.
 *
 * IMPORTANT: Rocketlane's /tasks/{id}/add-dependencies endpoint only accepts
 * `{ dependencies: [{ taskId: <id> }] }`. Type (FS/SS/FF/SF) and lag are
 * NOT supported at the API level — we accept them as parameters for
 * completeness but log a warning if provided (future-proofing in case
 * Rocketlane adds support).
 *
 * `fromTempId` is the task that depends on the other. Rocketlane's call:
 * POST /tasks/{fromRlId}/add-dependencies  with [{ taskId: toRlId }]
 * This means "fromRlId depends on toRlId" — fromRlId can't start until toRlId finishes.
 */

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

export interface AddDependencyInput {
  fromTempId: string;
  toTempId: string;
  type?: DependencyType;
  lagDays?: number;
}

export async function addDependencyTool(
  input: AddDependencyInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.fromTempId || typeof input.fromTempId !== 'string') {
    return { summary: 'ERROR: add_dependency requires `fromTempId`' };
  }
  if (!input?.toTempId || typeof input.toTempId !== 'string') {
    return { summary: 'ERROR: add_dependency requires `toTempId`' };
  }
  if (input.fromTempId === input.toTempId) {
    return { summary: `ERROR: a task cannot depend on itself (tempId=${input.fromTempId})` };
  }

  const from = ctx.session.idmap[input.fromTempId];
  const to = ctx.session.idmap[input.toTempId];

  if (!from || from.type !== 'task') {
    return {
      summary: `ERROR: fromTempId "${input.fromTempId}" not found in idmap. The dependent task must be created in pass 1 before its dependencies.`,
    };
  }
  if (!to || to.type !== 'task') {
    return {
      summary: `ERROR: toTempId "${input.toTempId}" not found in idmap. The predecessor task must be created in pass 1 before setting dependencies.`,
    };
  }

  const warnings: string[] = [];
  if (input.type && input.type !== 'FS') {
    warnings.push(
      `Rocketlane does not support dependency type "${input.type}" via API — treating as FS.`
    );
  }
  if (typeof input.lagDays === 'number' && input.lagDays !== 0) {
    warnings.push(
      `Rocketlane does not support lag days via API — ignoring lagDays=${input.lagDays}.`
    );
  }

  const client = ctx.getRlClient() as RocketlaneClient;

  try {
    await client.addDependencies(from.rlId, {
      dependencies: [{ taskId: to.rlId }],
    });

    const lines = [
      `✓ Added dependency: "${input.fromTempId}" depends on "${input.toTempId}" (rlIds ${from.rlId} → ${to.rlId})`,
    ];
    if (warnings.length > 0) {
      lines.push('');
      lines.push('Warnings:');
      for (const w of warnings) lines.push(`  - ${w}`);
    }

    return { summary: lines.join('\n') };
  } catch (err) {
    if (err instanceof RocketlaneError) {
      return {
        summary: `Rocketlane error adding dependency: ${err.status} ${err.message}. Body: ${JSON.stringify(err.responseBody).slice(0, 400)}`,
      };
    }
    return {
      summary: `Unexpected error adding dependency: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
