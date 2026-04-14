import { nanoid } from 'nanoid';
import type { Artifact, ArtifactKind } from '../types';
import { getRedis, key } from './redis';

/**
 * Artifact store — content-addressed JSON blobs scoped to a session.
 *
 * Why: tool results (parsed CSV rows, RL context, validator reports, plan
 * trees) can be 10-100KB each. If we inline them in history, every turn
 * replays them to Claude, and the context window explodes by turn 10.
 *
 * Instead:
 *   1. Tool handler writes the full result to session:{id}:artifacts (HASH)
 *      under a generated artifactId.
 *   2. The tool_result block sent to Claude contains a short preview
 *      string + the artifactId.
 *   3. When Claude needs details, it calls query_artifact(artifactId, path)
 *      to retrieve a slice — only paying tokens for what it actually reads.
 *
 * Combined with prompt caching on the system prompt, this keeps per-turn
 * input costs ~constant even as the session grows.
 */

export interface PutArtifactInput<T = unknown> {
  sessionId: string;
  kind: ArtifactKind;
  preview: string;
  content: T;
}

export async function putArtifact<T = unknown>(
  input: PutArtifactInput<T>
): Promise<Artifact<T>> {
  const redis = getRedis();
  const artifact: Artifact<T> = {
    id: `art_${nanoid(12)}`,
    kind: input.kind,
    preview: input.preview,
    content: input.content,
    createdAt: Date.now(),
  };
  await redis.hset(key.artifacts(input.sessionId), {
    [artifact.id]: JSON.stringify(artifact),
  });
  return artifact;
}

export async function getArtifact<T = unknown>(
  sessionId: string,
  artifactId: string
): Promise<Artifact<T> | null> {
  const redis = getRedis();
  const raw = await redis.hget(key.artifacts(sessionId), artifactId);
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : (raw as Artifact<T>);
  } catch {
    return null;
  }
}

/**
 * Query an artifact — returns a specific slice of its content.
 *
 * Supported path formats (best-effort, agent-friendly):
 *   - ""            -> whole content
 *   - "items"       -> content.items
 *   - "items[0]"    -> content.items[0]
 *   - "items[0:5]"  -> content.items.slice(0, 5)
 *   - "items.length"-> items array length
 *   - "errors[0].code" -> content.errors[0].code
 *
 * This is a small purpose-built query evaluator, not a full JSONPath
 * implementation — it handles the patterns the agent actually uses.
 */
export async function queryArtifact(
  sessionId: string,
  artifactId: string,
  path: string
): Promise<{ found: boolean; value: unknown; type: string }> {
  const artifact = await getArtifact(sessionId, artifactId);
  if (!artifact) return { found: false, value: null, type: 'missing' };

  if (!path || path.trim() === '') {
    return { found: true, value: artifact.content, type: typeof artifact.content };
  }

  const segments = parsePath(path);
  let cursor: unknown = artifact.content;

  for (const seg of segments) {
    if (cursor === null || cursor === undefined) {
      return { found: false, value: null, type: 'missing' };
    }
    if (seg.kind === 'key') {
      if (seg.name === 'length' && Array.isArray(cursor)) {
        cursor = cursor.length;
        continue;
      }
      if (typeof cursor !== 'object') {
        return { found: false, value: null, type: 'missing' };
      }
      cursor = (cursor as Record<string, unknown>)[seg.name];
    } else if (seg.kind === 'index') {
      if (!Array.isArray(cursor)) {
        return { found: false, value: null, type: 'missing' };
      }
      cursor = cursor[seg.index];
    } else if (seg.kind === 'slice') {
      if (!Array.isArray(cursor)) {
        return { found: false, value: null, type: 'missing' };
      }
      cursor = cursor.slice(seg.start, seg.end);
    }
  }

  return {
    found: true,
    value: cursor,
    type: Array.isArray(cursor) ? 'array' : typeof cursor,
  };
}

type PathSegment =
  | { kind: 'key'; name: string }
  | { kind: 'index'; index: number }
  | { kind: 'slice'; start: number; end: number };

function parsePath(path: string): PathSegment[] {
  const out: PathSegment[] = [];
  // Split by dots but preserve [x] indexing
  const tokens = path.split('.').filter(Boolean);
  for (const tok of tokens) {
    // tok like "items[0:5]" or "items[0]" or "items"
    const bracketMatch = tok.match(/^([^\[]*)((?:\[[^\]]+\])*)$/);
    if (!bracketMatch) {
      out.push({ kind: 'key', name: tok });
      continue;
    }
    const [, name, brackets] = bracketMatch;
    if (name) out.push({ kind: 'key', name });
    if (brackets) {
      const inner = brackets.match(/\[([^\]]+)\]/g) ?? [];
      for (const b of inner) {
        const content = b.slice(1, -1);
        if (content.includes(':')) {
          const [s, e] = content.split(':').map((n) => Number(n));
          out.push({ kind: 'slice', start: isNaN(s) ? 0 : s, end: isNaN(e) ? Infinity : e });
        } else {
          out.push({ kind: 'index', index: Number(content) });
        }
      }
    }
  }
  return out;
}
