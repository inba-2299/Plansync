import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import type { RocketlaneClient } from '../rocketlane/client';
import { RocketlaneError } from '../rocketlane/client';

/**
 * create_rocketlane_project(args) — Group E creation tool.
 *
 * Creates the project SHELL in Rocketlane (first call of pass 1). Stores
 * the real projectId in session.meta.rlProjectId so subsequent create_phase
 * calls can reference it.
 *
 * Auto-creates the customer company if it doesn't exist (autoCreateCompany: true).
 */

export interface CreateProjectInput {
  projectName: string;
  ownerEmail: string;
  customerName: string;
  startDate?: string; // YYYY-MM-DD
  dueDate?: string;
  description?: string;
}

export async function createRocketlaneProjectTool(
  input: CreateProjectInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.projectName || typeof input.projectName !== 'string') {
    return { summary: 'ERROR: create_rocketlane_project requires `projectName`' };
  }
  if (!input?.ownerEmail || typeof input.ownerEmail !== 'string') {
    return {
      summary:
        'ERROR: create_rocketlane_project requires `ownerEmail` (a TEAM_MEMBER email from get_rocketlane_context)',
    };
  }
  if (!input?.customerName || typeof input.customerName !== 'string') {
    return { summary: 'ERROR: create_rocketlane_project requires `customerName`' };
  }

  if (ctx.session.meta.rlProjectId) {
    return {
      summary: `Project already created for this session (projectId=${ctx.session.meta.rlProjectId}). Cannot create another.`,
    };
  }

  const client = ctx.getRlClient() as RocketlaneClient;

  try {
    const project = await client.createProject({
      projectName: input.projectName,
      owner: { emailId: input.ownerEmail },
      customer: { companyName: input.customerName },
      startDate: input.startDate,
      dueDate: input.dueDate,
      autoCreateCompany: true,
      description: input.description,
    });

    const raw = project as Record<string, unknown>;
    const projectId = typeof raw.projectId === 'number' ? raw.projectId : undefined;

    if (!projectId) {
      return {
        summary: `ERROR: Rocketlane did not return a projectId. Response: ${JSON.stringify(project).slice(0, 500)}`,
      };
    }

    // Store in session meta for downstream tools
    ctx.session.meta.rlProjectId = projectId;

    // Build the project URL (assumes inbarajb.rocketlane.com format — agent should not hardcode)
    const projectUrl = typeof raw.projectUrl === 'string' ? raw.projectUrl : undefined;

    return {
      summary: `✓ Created project "${input.projectName}" (projectId=${projectId}) for customer "${input.customerName}". Use this projectId for subsequent create_phase calls.${projectUrl ? ` URL: ${projectUrl}` : ''}`,
    };
  } catch (err) {
    if (err instanceof RocketlaneError) {
      return {
        summary: `Rocketlane error creating project: ${err.status} ${err.message}. Response body: ${JSON.stringify(err.responseBody).slice(0, 400)}`,
      };
    }
    return {
      summary: `Unexpected error creating project: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
