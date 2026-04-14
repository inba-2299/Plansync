/**
 * test-rl.ts — Comprehensive Rocketlane API verification
 *
 * Runs 12 scenarios against a real Rocketlane workspace to prove every
 * endpoint the 21-tool agent depends on actually works as the PRD claims.
 *
 * Captures actual request/response shapes in rl-api-contract.json so the
 * system prompt and tool implementations can reference the ground truth.
 *
 * Usage:
 *   cd agent
 *   npm run test-rl
 *
 * Requires TEST_ROCKETLANE_API_KEY in agent/.env (NEVER committed).
 *
 * Cleanup: archives or deletes the test project at the end so your workspace
 * isn't polluted. If cleanup fails, the project id is printed for manual removal.
 */

import 'dotenv/config';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RocketlaneClient,
  RocketlaneError,
  type RocketlaneLogEntry,
} from '../src/rocketlane/client';

// ---------- setup ----------

const apiKey = process.env.TEST_ROCKETLANE_API_KEY;
if (!apiKey || apiKey.startsWith('REPLACE_ME')) {
  console.error(
    '❌ TEST_ROCKETLANE_API_KEY not set in agent/.env. Fill it in and try again.'
  );
  process.exit(1);
}

const ownerEmail = process.env.TEST_ROCKETLANE_OWNER_EMAIL ?? 'inbarajb91@gmail.com';
const testPrefix = `plansync-test-${Date.now()}`;
const customerName = `${testPrefix}-customer`;
const projectName = `${testPrefix}-project`;

const log: RocketlaneLogEntry[] = [];
const client = new RocketlaneClient({
  apiKey,
  maxRetries: 2,
  logger: (entry) => {
    log.push(entry);
  },
});

// ---------- runner ----------

interface Scenario {
  num: number;
  name: string;
  run: () => Promise<void>;
  /** Whether failure here should abort subsequent scenarios (e.g. auth) */
  fatal?: boolean;
}

const results: Array<{
  num: number;
  name: string;
  status: 'pass' | 'fail' | 'skip';
  error?: string;
  notes?: string;
}> = [];

// Shared state across scenarios
interface State {
  projectId?: number;
  phase1Id?: number;
  phase2Id?: number;
  task1Id?: number;
  task2Id?: number;
  task3Id?: number;
  subtaskId?: number;
  subSubtaskId?: number;
  milestoneId?: number;
  authOk?: boolean;
}
const state: State = {};

async function runScenarios(scenarios: Scenario[]) {
  for (const s of scenarios) {
    process.stdout.write(`[${s.num.toString().padStart(2, '0')}] ${s.name} ... `);
    try {
      await s.run();
      results.push({ num: s.num, name: s.name, status: 'pass' });
      console.log('✓');
    } catch (err) {
      const message =
        err instanceof RocketlaneError
          ? `${err.status} ${err.message} :: ${JSON.stringify(err.responseBody).slice(0, 300)}`
          : err instanceof Error
            ? err.message
            : String(err);
      results.push({ num: s.num, name: s.name, status: 'fail', error: message });
      console.log('✗');
      console.log(`     → ${message}`);
      if (s.fatal) {
        console.log('     ⛔ fatal scenario failed, aborting remaining tests');
        break;
      }
    }
  }
}

// ---------- scenarios ----------

const scenarios: Scenario[] = [
  {
    num: 1,
    name: 'Auth check: GET /projects?pageSize=1',
    fatal: true,
    run: async () => {
      const res = await client.authCheck();
      state.authOk = true;
      if (!res || typeof res !== 'object') {
        throw new Error(`Expected object response, got: ${JSON.stringify(res)}`);
      }
      const data = (res as Record<string, unknown>).data;
      if (!Array.isArray(data)) {
        throw new Error(`Expected response.data to be an array, got: ${typeof data}`);
      }
    },
  },

  {
    num: 2,
    name: 'GET /companies (list customer/vendor companies for context)',
    run: async () => {
      const res = await client.listCompanies();
      if (!res || typeof res !== 'object') {
        throw new Error('Expected object response');
      }
      const data = (res as Record<string, unknown>).data;
      if (!Array.isArray(data)) {
        throw new Error(`Expected data array, got: ${typeof data}`);
      }
    },
  },

  {
    num: 3,
    name: 'GET /users (list team members + customers)',
    run: async () => {
      const res = await client.listUsers();
      if (!res || typeof res !== 'object') {
        throw new Error('Expected object response');
      }
      const data = (res as Record<string, unknown>).data;
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error('Expected non-empty users array');
      }
      // Verify the expected owner email is in the team member list
      const found = data.some(
        (u) =>
          u &&
          typeof u === 'object' &&
          (u as Record<string, unknown>).email === ownerEmail
      );
      if (!found) {
        throw new Error(
          `Expected owner email ${ownerEmail} in /users response — this user must exist as a TEAM_MEMBER before creating projects owned by them`
        );
      }
    },
  },

  {
    num: 4,
    name: 'POST /projects (create project with autoCreateCompany)',
    fatal: true,
    run: async () => {
      const project = await client.createProject({
        projectName,
        owner: { emailId: ownerEmail },
        customer: { companyName: customerName },
        startDate: '2026-04-20',
        dueDate: '2026-05-20',
        autoCreateCompany: true,
        description: 'Plansync test-rl.ts — safe to delete',
      });
      const projectId = (project as Record<string, unknown>).projectId;
      if (typeof projectId !== 'number') {
        throw new Error(
          `Expected projectId (number) in response, got: ${JSON.stringify(project).slice(0, 500)}`
        );
      }
      state.projectId = projectId;
    },
  },

  {
    num: 5,
    name: 'POST /phases x2 (Discovery, Build)',
    fatal: true,
    run: async () => {
      if (!state.projectId) throw new Error('no projectId from scenario 4');
      const p1 = await client.createPhase({
        phaseName: 'Discovery',
        project: { projectId: state.projectId },
        startDate: '2026-04-20',
        dueDate: '2026-04-27',
      });
      const p2 = await client.createPhase({
        phaseName: 'Build',
        project: { projectId: state.projectId },
        startDate: '2026-04-28',
        dueDate: '2026-05-20',
      });
      state.phase1Id = (p1 as Record<string, unknown>).phaseId as number;
      state.phase2Id = (p2 as Record<string, unknown>).phaseId as number;
      if (typeof state.phase1Id !== 'number' || typeof state.phase2Id !== 'number') {
        throw new Error(`Expected phaseId (number) in both phases, got p1=${JSON.stringify(p1)} p2=${JSON.stringify(p2)}`);
      }
    },
  },

  {
    num: 6,
    name: 'POST /tasks x3 (regular tasks in both phases)',
    run: async () => {
      if (!state.projectId || !state.phase1Id || !state.phase2Id) {
        throw new Error('missing project/phase ids');
      }
      const t1 = await client.createTask({
        taskName: 'Kick-off meeting',
        project: { projectId: state.projectId },
        phase: { phaseId: state.phase1Id },
        startDate: '2026-04-20',
        dueDate: '2026-04-21',
        type: 'TASK',
      });
      const t2 = await client.createTask({
        taskName: 'Stakeholder interviews',
        project: { projectId: state.projectId },
        phase: { phaseId: state.phase1Id },
        startDate: '2026-04-22',
        dueDate: '2026-04-27',
        type: 'TASK',
      });
      const t3 = await client.createTask({
        taskName: 'Configure application',
        project: { projectId: state.projectId },
        phase: { phaseId: state.phase2Id },
        startDate: '2026-04-28',
        dueDate: '2026-05-15',
        type: 'TASK',
      });
      state.task1Id = (t1 as Record<string, unknown>).taskId as number;
      state.task2Id = (t2 as Record<string, unknown>).taskId as number;
      state.task3Id = (t3 as Record<string, unknown>).taskId as number;
      if (
        typeof state.task1Id !== 'number' ||
        typeof state.task2Id !== 'number' ||
        typeof state.task3Id !== 'number'
      ) {
        throw new Error('one or more tasks did not return a taskId');
      }
    },
  },

  {
    num: 7,
    name: 'POST /tasks (subtask with parent.taskId)',
    run: async () => {
      if (!state.projectId || !state.phase1Id || !state.task2Id) {
        throw new Error('missing ids from earlier scenarios');
      }
      const subtask = await client.createTask({
        taskName: 'Prepare interview questions',
        project: { projectId: state.projectId },
        phase: { phaseId: state.phase1Id },
        parent: { taskId: state.task2Id },
        startDate: '2026-04-22',
        dueDate: '2026-04-23',
        type: 'TASK',
      });
      state.subtaskId = (subtask as Record<string, unknown>).taskId as number;
      if (typeof state.subtaskId !== 'number') {
        throw new Error(`subtask did not return taskId: ${JSON.stringify(subtask)}`);
      }
    },
  },

  {
    num: 8,
    name: 'POST /tasks (sub-subtask — depth 3, verify unlimited nesting)',
    run: async () => {
      if (!state.projectId || !state.phase1Id || !state.subtaskId) {
        throw new Error('missing ids');
      }
      const subSubtask = await client.createTask({
        taskName: 'Draft interview guide',
        project: { projectId: state.projectId },
        phase: { phaseId: state.phase1Id },
        parent: { taskId: state.subtaskId },
        startDate: '2026-04-22',
        dueDate: '2026-04-22',
        type: 'TASK',
      });
      state.subSubtaskId = (subSubtask as Record<string, unknown>).taskId as number;
      if (typeof state.subSubtaskId !== 'number') {
        throw new Error(
          `sub-subtask did not return taskId (depth 3 may not be supported?): ${JSON.stringify(subSubtask)}`
        );
      }
    },
  },

  {
    num: 9,
    name: 'POST /tasks (milestone — type: MILESTONE)',
    run: async () => {
      if (!state.projectId || !state.phase1Id) throw new Error('missing ids');
      const milestone = await client.createTask({
        taskName: 'Discovery Sign-off',
        project: { projectId: state.projectId },
        phase: { phaseId: state.phase1Id },
        startDate: '2026-04-27',
        dueDate: '2026-04-27',
        type: 'MILESTONE',
      });
      state.milestoneId = (milestone as Record<string, unknown>).taskId as number;
      if (typeof state.milestoneId !== 'number') {
        throw new Error(`milestone did not return taskId: ${JSON.stringify(milestone)}`);
      }
    },
  },

  {
    num: 10,
    name: 'GET /tasks/{id} (read-back verification)',
    run: async () => {
      if (!state.task1Id || !state.subtaskId || !state.milestoneId) {
        throw new Error('missing ids');
      }
      for (const id of [state.task1Id, state.subtaskId, state.milestoneId]) {
        const task = await client.getTask(id);
        const returnedId = (task as Record<string, unknown>).taskId;
        if (returnedId !== id) {
          throw new Error(
            `GET /tasks/${id} returned different id: ${returnedId} (full: ${JSON.stringify(task).slice(0, 300)})`
          );
        }
      }
    },
  },

  {
    num: 11,
    name: 'POST /tasks/{id}/add-dependencies (two-pass dependency)',
    run: async () => {
      if (!state.task2Id || !state.task1Id) throw new Error('missing ids');
      await client.addDependencies(state.task2Id, {
        dependencies: [{ taskId: state.task1Id }],
      });
    },
  },

  {
    num: 12,
    name: 'Negative case: POST /phases without dueDate (expect 400)',
    run: async () => {
      if (!state.projectId) throw new Error('no projectId');
      try {
        // @ts-expect-error deliberately omitting dueDate to probe validation
        await client.createPhase({
          phaseName: 'Should fail',
          project: { projectId: state.projectId },
          startDate: '2026-04-20',
        });
        throw new Error('Expected 400 but request succeeded — phase dueDate may not actually be required!');
      } catch (err) {
        if (err instanceof RocketlaneError && err.status === 400) {
          return; // expected
        }
        throw err;
      }
    },
  },
];

// ---------- cleanup ----------

async function cleanup(): Promise<void> {
  if (!state.projectId) return;
  console.log('');
  console.log(`Cleanup: archiving test project ${state.projectId}...`);
  try {
    await client.archiveProject(state.projectId);
    console.log('  ✓ archived');
  } catch (err) {
    console.log(`  ✗ archive failed: ${err instanceof Error ? err.message : err}`);
    console.log(`  Trying delete as fallback...`);
    try {
      await client.deleteProject(state.projectId);
      console.log('  ✓ deleted');
    } catch (err2) {
      console.log(`  ✗ delete failed: ${err2 instanceof Error ? err2.message : err2}`);
      console.log('');
      console.log(
        `⚠️  MANUAL CLEANUP NEEDED: project id ${state.projectId} (name: ${projectName}) could not be removed automatically. Remove it via the Rocketlane UI.`
      );
    }
  }
}

// ---------- main ----------

async function main() {
  console.log('');
  console.log('================================================================');
  console.log('  Plansync — Rocketlane API verification (test-rl.ts)');
  console.log('================================================================');
  console.log(`  Base URL:  https://api.rocketlane.com/api/1.0`);
  console.log(`  Owner:     ${ownerEmail}`);
  console.log(`  Test prefix: ${testPrefix}`);
  console.log('================================================================');
  console.log('');

  await runScenarios(scenarios);
  await cleanup();

  // Write the api contract for reference
  const contractPath = join(process.cwd(), 'rl-api-contract.json');
  writeFileSync(
    contractPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        baseUrl: 'https://api.rocketlane.com/api/1.0',
        results,
        log,
      },
      null,
      2
    )
  );

  console.log('');
  console.log('================================================================');
  console.log('  Results');
  console.log('================================================================');
  const pass = results.filter((r) => r.status === 'pass').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  for (const r of results) {
    const icon = r.status === 'pass' ? '✓' : r.status === 'fail' ? '✗' : '-';
    console.log(`  ${icon} [${r.num.toString().padStart(2, '0')}] ${r.name}`);
    if (r.error) console.log(`       ${r.error}`);
  }
  console.log('');
  console.log(`  ${pass} passed, ${fail} failed, ${results.length} total`);
  console.log(`  Contract saved to ${contractPath}`);
  console.log('');

  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('');
  console.error('Unexpected error in test-rl:', err);
  process.exit(2);
});
