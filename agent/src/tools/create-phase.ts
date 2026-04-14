import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import type { RocketlaneClient } from '../rocketlane/client';
import { RocketlaneError } from '../rocketlane/client';

/**
 * create_phase(tempId, phaseName, startDate, dueDate, description?) — Group E.
 *
 * Creates one phase in Rocketlane. The project must already exist in this
 * session (session.meta.rlProjectId set). Both dates are REQUIRED by
 * Rocketlane — if the agent doesn't have them, it must derive them from
 * children or ask the user BEFORE calling this.
 *
 * Stores the resulting phaseId in session.idmap keyed by the agent-provided
 * tempId (usually a plan item id like "phase_1").
 */

export interface CreatePhaseInput {
  tempId: string;
  phaseName: string;
  startDate: string;
  dueDate: string;
  description?: string;
}

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export async function createPhaseTool(
  input: CreatePhaseInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.tempId || typeof input.tempId !== 'string') {
    return { summary: 'ERROR: create_phase requires `tempId` (the agent-assigned plan item id)' };
  }
  if (!input?.phaseName || typeof input.phaseName !== 'string') {
    return { summary: 'ERROR: create_phase requires `phaseName`' };
  }
  if (!input?.startDate || !DATE_REGEX.test(input.startDate)) {
    return {
      summary: `ERROR: create_phase requires "startDate" in YYYY-MM-DD format, got: ${input?.startDate}`,
    };
  }
  if (!input?.dueDate || !DATE_REGEX.test(input.dueDate)) {
    return {
      summary: `ERROR: create_phase requires "dueDate" in YYYY-MM-DD format, got: ${input?.dueDate}`,
    };
  }
  if (input.startDate > input.dueDate) {
    return { summary: `ERROR: startDate (${input.startDate}) is after dueDate (${input.dueDate})` };
  }

  const projectId = ctx.session.meta.rlProjectId;
  if (!projectId) {
    return {
      summary:
        'ERROR: no project created yet in this session. Call create_rocketlane_project first.',
    };
  }

  // Idempotency: if we already mapped this tempId, skip
  const existing = ctx.session.idmap[input.tempId];
  if (existing && existing.type === 'phase') {
    return {
      summary: `Phase "${input.tempId}" already created (phaseId=${existing.rlId}). Skipping.`,
    };
  }

  const client = ctx.getRlClient() as RocketlaneClient;

  try {
    const phase = await client.createPhase({
      phaseName: input.phaseName,
      project: { projectId },
      startDate: input.startDate,
      dueDate: input.dueDate,
      description: input.description,
    });

    const raw = phase as Record<string, unknown>;
    const phaseId = typeof raw.phaseId === 'number' ? raw.phaseId : undefined;

    if (!phaseId) {
      return {
        summary: `ERROR: Rocketlane did not return a phaseId. Response: ${JSON.stringify(phase).slice(0, 500)}`,
      };
    }

    ctx.session.idmap[input.tempId] = {
      type: 'phase',
      rlId: phaseId,
      tempId: input.tempId,
      parentTempId: null,
      createdAt: Date.now(),
    };

    return {
      summary: `✓ Created phase "${input.phaseName}" (${input.startDate} → ${input.dueDate}) tempId=${input.tempId} phaseId=${phaseId}`,
    };
  } catch (err) {
    if (err instanceof RocketlaneError) {
      return {
        summary: `Rocketlane error creating phase "${input.phaseName}": ${err.status} ${err.message}. Body: ${JSON.stringify(err.responseBody).slice(0, 400)}`,
      };
    }
    return {
      summary: `Unexpected error creating phase: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
