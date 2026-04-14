import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import { queryArtifact } from '../memory/artifacts';

/**
 * query_artifact(artifactId, path) — Group A tool.
 *
 * Dereferences a stored artifact blob to a specific slice. This is how the
 * agent reads big data (parsed CSV rows, RL context, validator reports,
 * plan trees) without inlining the whole blob in every turn's history.
 *
 * Supported path syntax (see memory/artifacts.ts for the parser):
 *   - ""            → whole content
 *   - "rows"        → content.rows
 *   - "rows[0]"     → first row
 *   - "rows[0:10]"  → first 10 rows as slice
 *   - "rows.length" → array length
 *   - "teamMembers[0].email" → nested access
 */

export interface QueryArtifactInput {
  artifactId: string;
  path?: string;
}

/** Max chars returned to Claude per call — keeps context bounded */
const MAX_RESPONSE_CHARS = 8192;

export async function queryArtifactTool(
  input: QueryArtifactInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.artifactId || typeof input.artifactId !== 'string') {
    return { summary: 'ERROR: query_artifact requires `artifactId` (string)' };
  }

  const path = typeof input.path === 'string' ? input.path : '';
  const result = await queryArtifact(ctx.sessionId, input.artifactId, path);

  if (!result.found) {
    return {
      summary: `Path "${path}" not found in artifact "${input.artifactId}". Check the artifact exists and the path is valid.`,
    };
  }

  let stringified: string;
  try {
    stringified = JSON.stringify(result.value, null, 2);
  } catch {
    stringified = String(result.value);
  }

  let truncated = false;
  if (stringified.length > MAX_RESPONSE_CHARS) {
    stringified =
      stringified.slice(0, MAX_RESPONSE_CHARS) +
      `\n\n... (TRUNCATED: full length ${stringified.length} chars. Use a narrower path to read less.)`;
    truncated = true;
  }

  const header = `Artifact "${input.artifactId}" at path "${path || '(root)'}" — type: ${result.type}${
    truncated ? ' (truncated)' : ''
  }\n`;

  return {
    summary: header + stringified,
  };
}
