import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import { RocketlaneClient } from '../rocketlane/client';
import { putArtifact } from '../memory/artifacts';
import { decrypt } from '../lib/crypto';

/**
 * get_rocketlane_context() — Group A input tool.
 *
 * Fetches three read-only lists from the user's Rocketlane workspace:
 *   1. Existing projects (for duplicate detection + owner defaults)
 *   2. Companies (CUSTOMER + VENDOR — for the customer dropdown)
 *   3. Team members (for owner email selection)
 *
 * All three are stored in a single artifact; the tool returns a short
 * summary + the artifactId. The agent can query specific slices with
 * query_artifact("art_xxx", "teamMembers[0].email") etc.
 *
 * Requires session.meta.rlApiKeyEnc to be set (user must have provided
 * their API key via request_user_approval earlier in the conversation).
 */

export interface RlContextArtifactContent {
  projects: Array<{
    projectId: number;
    projectName?: string;
    startDate?: string;
    dueDate?: string;
    customer?: string;
    owner?: string;
    status?: string;
    archived?: boolean;
  }>;
  companies: Array<{
    companyId: number;
    companyName: string;
    companyType: 'CUSTOMER' | 'VENDOR' | string;
  }>;
  teamMembers: Array<{
    userId: number;
    email: string;
    firstName?: string;
    lastName?: string;
    status?: string;
  }>;
  customers: Array<{
    userId: number;
    email: string;
    firstName?: string;
    lastName?: string;
  }>;
}

export async function getRocketlaneContextTool(
  _input: Record<string, unknown>,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!ctx.session.meta.rlApiKeyEnc) {
    return {
      summary:
        'ERROR: no Rocketlane API key in session. Use request_user_approval to ask the user for one first, then store it via a backend helper.',
    };
  }

  let apiKey: string;
  try {
    apiKey = decrypt(ctx.session.meta.rlApiKeyEnc);
  } catch (err) {
    return {
      summary: `ERROR: failed to decrypt stored Rocketlane API key: ${
        err instanceof Error ? err.message : String(err)
      }. The user may need to re-enter it.`,
    };
  }

  const client = new RocketlaneClient({ apiKey });

  try {
    const [projectsRes, companiesRes, usersRes] = await Promise.all([
      client.listProjects(100),
      client.listCompanies(),
      client.listUsers(100),
    ]);

    const projects = (projectsRes.data ?? []).map((p) => {
      const pr = p as Record<string, unknown>;
      const customer = pr.customer as Record<string, unknown> | undefined;
      const owner = pr.owner as Record<string, unknown> | undefined;
      const status = pr.status as Record<string, unknown> | undefined;
      return {
        projectId: Number(pr.projectId),
        projectName: typeof pr.projectName === 'string' ? pr.projectName : undefined,
        startDate: typeof pr.startDate === 'string' ? pr.startDate : undefined,
        dueDate: typeof pr.dueDate === 'string' ? pr.dueDate : undefined,
        customer: customer && typeof customer.companyName === 'string'
          ? customer.companyName
          : undefined,
        owner: owner && typeof owner.emailId === 'string' ? owner.emailId : undefined,
        status: status && typeof status.label === 'string' ? status.label : undefined,
        archived: pr.archived === true,
      };
    });

    const companies = (companiesRes.data ?? []).map((c) => ({
      companyId: Number(c.companyId),
      companyName: String(c.companyName),
      companyType: (c.companyType as string) ?? 'UNKNOWN',
    }));

    const allUsers = usersRes.data ?? [];
    const teamMembers = allUsers
      .filter((u) => u.type === 'TEAM_MEMBER')
      .map((u) => ({
        userId: Number(u.userId),
        email: String(u.email ?? ''),
        firstName: u.firstName,
        lastName: u.lastName,
        status: u.status,
      }));
    const customers = allUsers
      .filter((u) => u.type === 'CUSTOMER')
      .map((u) => ({
        userId: Number(u.userId),
        email: String(u.email ?? ''),
        firstName: u.firstName,
        lastName: u.lastName,
      }));

    const content: RlContextArtifactContent = {
      projects,
      companies,
      teamMembers,
      customers,
    };

    const activeProjects = projects.filter((p) => !p.archived).length;
    const customerCompanies = companies.filter((c) => c.companyType === 'CUSTOMER').length;

    const previewLines = [
      `Rocketlane workspace context loaded:`,
      `  ${projects.length} projects (${activeProjects} active)`,
      `  ${companies.length} companies (${customerCompanies} customers)`,
      `  ${teamMembers.length} team members`,
    ];

    if (teamMembers.length > 0 && teamMembers.length <= 5) {
      previewLines.push(`  team member emails: ${teamMembers.map((u) => u.email).join(', ')}`);
    }
    if (customerCompanies > 0 && customerCompanies <= 10) {
      const names = companies
        .filter((c) => c.companyType === 'CUSTOMER')
        .map((c) => c.companyName)
        .join(', ');
      previewLines.push(`  customer companies: ${names}`);
    }

    const artifact = await putArtifact({
      sessionId: ctx.sessionId,
      kind: 'rl-context',
      preview: previewLines.join('\n'),
      content,
    });

    return {
      summary:
        `${previewLines.join('\n')}\n\nFull context in artifact "${artifact.id}". Use query_artifact for specific slices, e.g.:\n` +
        `  query_artifact("${artifact.id}", "projects[0:5]")\n` +
        `  query_artifact("${artifact.id}", "teamMembers")\n` +
        `  query_artifact("${artifact.id}", "companies")`,
      artifactId: artifact.id,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      summary: `ERROR fetching Rocketlane context: ${msg}`,
    };
  }
}
