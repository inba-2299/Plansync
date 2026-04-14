import type {
  CreateProjectArgs,
  CreatePhaseArgs,
  CreateTaskArgs,
  AddDependenciesArgs,
  RlProject,
  RlPhase,
  RlTask,
  RlListProjectsResponse,
  RlListCompaniesResponse,
  RlListUsersResponse,
} from './types';

/**
 * Rocketlane REST API client.
 *
 * Handles:
 *  - Bearer-style api-key header
 *  - JSON request/response bodies
 *  - 429 rate-limit backoff with Retry-After
 *  - 5xx retries with exponential backoff (up to maxRetries)
 *  - Structured RocketlaneError on failure (preserves status, body, x-request-id)
 *  - Optional request logger for building execlog / the rl-api-contract.json
 *
 * Base URL defaults to https://api.rocketlane.com/api/1.0 per PRD §9.
 */

export const DEFAULT_BASE_URL = 'https://api.rocketlane.com/api/1.0';

export interface RocketlaneClientOptions {
  apiKey: string;
  baseUrl?: string;
  /** Max retries on 429 and 5xx (not on 4xx client errors). Default 3. */
  maxRetries?: number;
  /** Optional logger — called for every request with the outcome. */
  logger?: (entry: RocketlaneLogEntry) => void | Promise<void>;
  /** Request timeout in ms. Default 30000. */
  timeoutMs?: number;
}

export interface RocketlaneLogEntry {
  method: string;
  path: string;
  requestBody?: unknown;
  status: number;
  responseBody: unknown;
  latencyMs: number;
  xRequestId?: string;
  attempt: number;
  error?: string;
}

export class RocketlaneError extends Error {
  public readonly status: number;
  public readonly responseBody: unknown;
  public readonly xRequestId?: string;
  public readonly rlCode?: string;
  public readonly rlFieldMessage?: string;

  constructor(
    message: string,
    status: number,
    responseBody: unknown,
    xRequestId?: string
  ) {
    super(message);
    this.name = 'RocketlaneError';
    this.status = status;
    this.responseBody = responseBody;
    this.xRequestId = xRequestId;

    // Try to extract structured error info from Rocketlane's response
    if (responseBody && typeof responseBody === 'object') {
      const body = responseBody as Record<string, unknown>;
      if (typeof body.code === 'string') this.rlCode = body.code;
      if (typeof body.message === 'string') this.rlFieldMessage = body.message;
      if (typeof body.errorMessage === 'string' && !this.rlFieldMessage) {
        this.rlFieldMessage = body.errorMessage;
      }
    }
  }

  /** True if retrying could help (5xx or 429) */
  get isRetryable(): boolean {
    return this.status === 429 || (this.status >= 500 && this.status < 600);
  }
}

export class RocketlaneClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly logger?: (entry: RocketlaneLogEntry) => void | Promise<void>;
  private readonly timeoutMs: number;

  constructor(opts: RocketlaneClientOptions) {
    if (!opts.apiKey) throw new Error('RocketlaneClient: apiKey is required');
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.maxRetries = opts.maxRetries ?? 3;
    this.logger = opts.logger;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  // ---------- core request ----------

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : '/' + path}`;
    let attempt = 0;
    let lastError: RocketlaneError | undefined;

    while (attempt <= this.maxRetries) {
      attempt++;
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const res = await fetch(url, {
          method,
          headers: {
            'api-key': this.apiKey,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });

        const latencyMs = Date.now() - startedAt;
        const xRequestId = res.headers.get('x-request-id') ?? undefined;

        // Parse body (may not be JSON on error)
        const text = await res.text();
        let parsedBody: unknown;
        try {
          parsedBody = text.length > 0 ? JSON.parse(text) : null;
        } catch {
          parsedBody = text;
        }

        const logEntry: RocketlaneLogEntry = {
          method,
          path,
          requestBody: body,
          status: res.status,
          responseBody: parsedBody,
          latencyMs,
          xRequestId,
          attempt,
        };

        if (res.ok) {
          try {
            await this.logger?.(logEntry);
          } catch {
            /* never let logger errors crash the client */
          }
          return parsedBody as T;
        }

        const err = new RocketlaneError(
          `Rocketlane ${method} ${path} failed: ${res.status} ${res.statusText}`,
          res.status,
          parsedBody,
          xRequestId
        );
        logEntry.error = err.message;
        try {
          await this.logger?.(logEntry);
        } catch {
          /* ignore */
        }

        lastError = err;

        if (!err.isRetryable || attempt > this.maxRetries) {
          throw err;
        }

        // 429: respect Retry-After if present
        if (res.status === 429) {
          const retryAfter = res.headers.get('retry-after');
          const waitMs =
            retryAfter && !Number.isNaN(Number(retryAfter))
              ? Number(retryAfter) * 1000
              : backoffMs(attempt);
          await sleep(waitMs);
          continue;
        }

        // 5xx: exponential backoff
        await sleep(backoffMs(attempt));
        continue;
      } catch (err) {
        clearTimeout(timeout);
        if (err instanceof RocketlaneError) throw err;

        // Network / abort / parse error
        const message = err instanceof Error ? err.message : String(err);
        const latencyMs = Date.now() - startedAt;
        const logEntry: RocketlaneLogEntry = {
          method,
          path,
          requestBody: body,
          status: 0,
          responseBody: null,
          latencyMs,
          attempt,
          error: message,
        };
        try {
          await this.logger?.(logEntry);
        } catch {
          /* ignore */
        }

        // Retry network errors up to maxRetries
        if (attempt > this.maxRetries) {
          throw new RocketlaneError(
            `Rocketlane ${method} ${path} network error: ${message}`,
            0,
            null
          );
        }
        await sleep(backoffMs(attempt));
        continue;
      } finally {
        clearTimeout(timeout);
      }
    }

    // Exhausted retries
    throw (
      lastError ??
      new RocketlaneError(
        `Rocketlane ${method} ${path} failed after ${this.maxRetries} retries`,
        0,
        null
      )
    );
  }

  // ---------- endpoints ----------

  /**
   * Lightweight auth check — GET /projects?pageSize=1.
   * Note: Rocketlane uses `pageSize` (not `limit`) for pagination.
   * Using `limit` triggers a 500 because Rocketlane parses query params
   * as filter expressions (e.g. `name.eq=foo`) and `limit 1` is malformed.
   */
  async authCheck(): Promise<RlListProjectsResponse> {
    return this.request<RlListProjectsResponse>('GET', '/projects?pageSize=1');
  }

  /** List all projects (paginated via pageSize + nextPageToken) */
  async listProjects(pageSize = 50): Promise<RlListProjectsResponse> {
    return this.request<RlListProjectsResponse>(
      'GET',
      `/projects?pageSize=${pageSize}`
    );
  }

  /** List companies — returns both CUSTOMER and VENDOR company types */
  async listCompanies(): Promise<RlListCompaniesResponse> {
    return this.request<RlListCompaniesResponse>('GET', '/companies');
  }

  /**
   * List all users in the workspace (both TEAM_MEMBER and CUSTOMER types).
   *
   * Rocketlane does not expose a /users/me style endpoint — instead we list
   * users and the agent can pick the appropriate owner (a TEAM_MEMBER) for
   * project creation, or match by email if the user has told us theirs.
   */
  async listUsers(pageSize = 100): Promise<RlListUsersResponse> {
    return this.request<RlListUsersResponse>(
      'GET',
      `/users?pageSize=${pageSize}`
    );
  }

  /** Create a new project. `autoCreateCompany` creates the customer if not present. */
  async createProject(args: CreateProjectArgs): Promise<RlProject> {
    return this.request<RlProject>('POST', '/projects', args);
  }

  /** Get a project by id */
  async getProject(projectId: number): Promise<RlProject> {
    return this.request<RlProject>('GET', `/projects/${projectId}`);
  }

  /** Create a phase — startDate and dueDate are REQUIRED by Rocketlane */
  async createPhase(args: CreatePhaseArgs): Promise<RlPhase> {
    return this.request<RlPhase>('POST', '/phases', args);
  }

  /** Create a task, subtask (via parent.taskId), or milestone (via type: 'MILESTONE') */
  async createTask(args: CreateTaskArgs): Promise<RlTask> {
    return this.request<RlTask>('POST', '/tasks', args);
  }

  /** Get a task by id */
  async getTask(taskId: number): Promise<RlTask> {
    return this.request<RlTask>('GET', `/tasks/${taskId}`);
  }

  /** Add dependencies to a task (pass 2 of two-pass creation) */
  async addDependencies(
    taskId: number,
    args: AddDependenciesArgs
  ): Promise<unknown> {
    return this.request<unknown>(
      'POST',
      `/tasks/${taskId}/add-dependencies`,
      args
    );
  }

  /** Attempt to archive a project. Used by test cleanup. */
  async archiveProject(projectId: number): Promise<unknown> {
    return this.request<unknown>('POST', `/projects/${projectId}/archive`);
  }

  /** Attempt to delete a project. Fallback used by test cleanup. */
  async deleteProject(projectId: number): Promise<unknown> {
    return this.request<unknown>('DELETE', `/projects/${projectId}`);
  }
}

// ---------- helpers ----------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  // Exponential with jitter: 500ms, 1s, 2s, 4s, ... up to 16s
  const base = Math.min(16_000, 500 * 2 ** (attempt - 1));
  const jitter = Math.floor(Math.random() * 250);
  return base + jitter;
}
