import type { ToolDispatchContext, ToolDispatchResult } from '../types';
import type { Session } from '../memory/session';
import { getArtifact } from '../memory/artifacts';

/**
 * parse_csv(fileId) — Group A input tool.
 *
 * The actual CSV/XLSX parsing happens at /upload time (SheetJS runs there
 * and stores the result as an artifact). This tool is the agent's read
 * interface into that artifact: returns column headers, row count, sheet
 * names (for multi-sheet Excel), and the first N rows as a sample.
 *
 * For more rows or specific slices, the agent calls query_artifact with
 * a path like "rows[10:30]".
 */

export interface ParseCsvInput {
  fileId: string;
}

/** Shape of what /upload stores in the artifact */
export interface CsvArtifactContent {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  sheetNames?: string[];
  /** Whitespace-preserved task name column values (for Smartsheet indentation detection) */
  indentationHints?: Array<{ row: number; column: string; leadingSpaces: number }>;
  sourceFileName?: string;
}

const SAMPLE_ROWS = 10;

export async function parseCsvTool(
  input: ParseCsvInput,
  ctx: ToolDispatchContext<Session>
): Promise<ToolDispatchResult> {
  if (!input?.fileId || typeof input.fileId !== 'string') {
    return {
      summary:
        'ERROR: parse_csv requires `fileId` (the artifactId returned by the upload endpoint).',
    };
  }

  const artifact = await getArtifact<CsvArtifactContent>(ctx.sessionId, input.fileId);
  if (!artifact) {
    return {
      summary: `ERROR: no artifact found with id "${input.fileId}". Either the upload failed or the artifact was purged.`,
    };
  }

  const content = artifact.content;
  if (
    !content ||
    !Array.isArray(content.rows) ||
    !Array.isArray(content.columns)
  ) {
    return {
      summary: `ERROR: artifact "${input.fileId}" is not a parsed CSV — kind is "${artifact.kind}". The upload endpoint should have stored a CsvArtifactContent shape.`,
    };
  }

  const rowCount = content.rowCount ?? content.rows.length;
  const sample = content.rows.slice(0, SAMPLE_ROWS);
  const sheets = content.sheetNames ?? [];

  const lines: string[] = [];
  lines.push(`Parsed ${content.sourceFileName ?? 'uploaded file'}:`);
  lines.push(`  rows: ${rowCount}`);
  lines.push(`  columns (${content.columns.length}): ${content.columns.join(', ')}`);
  if (sheets.length > 1) {
    lines.push(`  sheets: ${sheets.join(', ')} (multi-sheet — agent may need to pick one)`);
  }
  if (content.indentationHints && content.indentationHints.length > 0) {
    const maxIndent = Math.max(...content.indentationHints.map((h) => h.leadingSpaces));
    lines.push(
      `  indentation hints present (Smartsheet-style hierarchy): max leading spaces = ${maxIndent}`
    );
  }
  lines.push('');
  lines.push(`First ${Math.min(SAMPLE_ROWS, rowCount)} rows (sample):`);
  lines.push(JSON.stringify(sample, null, 2));
  lines.push('');
  lines.push(
    `Full data is in artifact "${input.fileId}". Use query_artifact to retrieve specific slices, e.g.:`
  );
  lines.push(`  query_artifact("${input.fileId}", "rows[10:30]")`);
  lines.push(`  query_artifact("${input.fileId}", "rows[42]")`);
  lines.push(`  query_artifact("${input.fileId}", "rows.length")`);

  return {
    summary: lines.join('\n'),
    artifactId: input.fileId,
  };
}
