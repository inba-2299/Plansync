/**
 * test-end-to-end.ts — First real end-to-end run against deployed stack.
 *
 * Flow:
 *  1. Store TEST_ROCKETLANE_API_KEY on a new session via POST /session/:id/apikey
 *  2. Upload a tiny 4-row CSV via POST /upload
 *  3. Kick off the agent via POST /agent with a user message that tells it
 *     what to do end-to-end
 *  4. Read SSE events as the agent streams, print them nicely
 *  5. When the agent calls request_user_approval, auto-select the
 *     "approve / proceed / confirm" option and POST back as uiAction
 *  6. Loop until done or error
 *
 * Verify: after this script exits, check inbarajb.rocketlane.com for a new
 * project called "Plansync E2E Test" with 1 phase, 2 tasks, 1 milestone,
 * and 1 dependency.
 */

import 'dotenv/config';

const AGENT_URL = process.env.AGENT_URL ?? 'https://plansync-production.up.railway.app';
const RL_KEY = process.env.TEST_ROCKETLANE_API_KEY;

if (!RL_KEY || RL_KEY.startsWith('REPLACE_ME')) {
  console.error('❌ TEST_ROCKETLANE_API_KEY not set in agent/.env');
  process.exit(1);
}

const SESSION_ID = `e2e-${Date.now()}`;
const MAX_RESUMES = 5;

interface AgentEvent {
  type: string;
  [k: string]: unknown;
}

async function main() {
  console.log('');
  console.log('================================================================');
  console.log('  Plansync — First End-to-End Test (deployed stack)');
  console.log('================================================================');
  console.log(`  Agent URL: ${AGENT_URL}`);
  console.log(`  Session:   ${SESSION_ID}`);
  console.log('================================================================');

  // ---------- Step 1: store API key ----------
  console.log('');
  console.log('[1/3] Storing Rocketlane API key on session...');
  const keyRes = await fetch(`${AGENT_URL}/session/${SESSION_ID}/apikey`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ apiKey: RL_KEY }),
  });
  if (!keyRes.ok) {
    console.error('  ✗ Failed:', keyRes.status, await keyRes.text());
    process.exit(1);
  }
  console.log('  ✓', await keyRes.json());

  // ---------- Step 2: upload CSV ----------
  const csv = `Name,Type,StartDate,DueDate,Parent,Dependencies
Discovery,phase,2026-04-20,2026-04-22,,
Kickoff meeting,task,2026-04-20,2026-04-20,Discovery,
Requirements doc,task,2026-04-21,2026-04-22,Discovery,Kickoff meeting
Sign-off,milestone,2026-04-22,2026-04-22,Discovery,Requirements doc
`;

  console.log('');
  console.log('[2/3] Uploading test CSV (4 rows: 1 phase + 2 tasks + 1 milestone + 1 dependency)...');
  const uploadRes = await fetch(
    `${AGENT_URL}/upload?sessionId=${SESSION_ID}&filename=test-plan.csv`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: csv,
    }
  );
  if (!uploadRes.ok) {
    console.error('  ✗ Failed:', uploadRes.status, await uploadRes.text());
    process.exit(1);
  }
  const uploadData = (await uploadRes.json()) as {
    artifactId: string;
    rowCount: number;
    columns: string[];
    preview: string;
  };
  console.log(`  ✓ artifactId: ${uploadData.artifactId}, rows: ${uploadData.rowCount}, columns: ${uploadData.columns.join(', ')}`);

  // ---------- Step 3: kick off the agent ----------
  console.log('');
  console.log('[3/3] Starting agent loop...');

  const userMessage =
    `I uploaded a tiny test project plan as artifactId "${uploadData.artifactId}". ` +
    `Parse it, validate it, then create it in Rocketlane. ` +
    `Project details: name="Plansync E2E Test", customer="Plansync Test Corp", ` +
    `owner email="inbarajb91@gmail.com", start 2026-04-20, due 2026-04-22. ` +
    `I pre-approve the plan — proceed straight through when you reach the final approval step by selecting Approve.`;

  let resumesUsed = 0;
  await runAgentTurn({ sessionId: SESSION_ID, userMessage }, () => resumesUsed++);

  console.log('');
  console.log('================================================================');
  console.log(`  Test complete. Resumes used: ${resumesUsed}`);
  console.log(`  Check https://inbarajb.rocketlane.com for the new project.`);
  console.log('================================================================');
}

interface RunAgentTurnPayload {
  sessionId: string;
  userMessage?: string;
  uiAction?: { toolUseId: string; data: string; label: string };
}

async function runAgentTurn(
  payload: RunAgentTurnPayload,
  onResume: () => void,
  depth = 0
): Promise<void> {
  if (depth > MAX_RESUMES) {
    console.log(`  ⛔ MAX_RESUMES (${MAX_RESUMES}) reached — stopping`);
    return;
  }

  console.log('');
  if (payload.userMessage) {
    console.log('  → sending user message:', payload.userMessage.slice(0, 120) + '...');
  } else if (payload.uiAction) {
    console.log(`  → resuming with uiAction: "${payload.uiAction.label}" (value: ${payload.uiAction.data})`);
  }
  console.log('');

  const res = await fetch(`${AGENT_URL}/agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok || !res.body) {
    console.error('  ✗ Agent POST failed:', res.status, await res.text());
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let awaitingUser: { toolUseId: string; payload: unknown } | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split('\n\n');
    buffer = parts.pop() ?? '';

    for (const part of parts) {
      if (!part.startsWith('data: ')) continue;
      let event: AgentEvent;
      try {
        event = JSON.parse(part.slice(6));
      } catch {
        continue;
      }

      const anyEvent = event as Record<string, unknown>;

      if (event.type === 'text_delta') {
        process.stdout.write(String(anyEvent.text ?? ''));
      } else if (event.type === 'tool_use_start') {
        process.stdout.write(`\n    🔧 ${anyEvent.name}(...) `);
      } else if (event.type === 'tool_use_end') {
        // silent
      } else if (event.type === 'tool_input_delta') {
        // silent
      } else if (event.type === 'tool_result') {
        const summary = String(anyEvent.summary ?? '').split('\n')[0].slice(0, 160);
        process.stdout.write(`\n      → ${summary}\n`);
      } else if (event.type === 'display_component') {
        process.stdout.write(`\n    📺 display_component: ${anyEvent.component}\n`);
      } else if (event.type === 'journey_update') {
        const steps = (anyEvent.steps as Array<{ label: string; status: string }>) ?? [];
        const trail = steps
          .map((s) => {
            const icon = s.status === 'done' ? '✓' : s.status === 'in_progress' ? '●' : s.status === 'error' ? '✗' : '○';
            return `${icon}${s.label}`;
          })
          .join(' → ');
        process.stdout.write(`\n    🧭 journey: ${trail}\n`);
      } else if (event.type === 'memory_write') {
        process.stdout.write(`\n    💾 remembered: ${anyEvent.key}\n`);
      } else if (event.type === 'awaiting_user') {
        awaitingUser = {
          toolUseId: String(anyEvent.toolUseId ?? ''),
          payload: anyEvent.payload,
        };
        const payloadObj = anyEvent.payload as Record<string, unknown>;
        process.stdout.write(
          `\n    ⏸ AWAITING USER\n    question: ${payloadObj?.question}\n    options: ${JSON.stringify(payloadObj?.options).slice(0, 300)}\n`
        );
      } else if (event.type === 'done') {
        process.stdout.write(`\n    ✓ done (${anyEvent.stopReason ?? 'unknown'})\n`);
      } else if (event.type === 'error') {
        process.stdout.write(`\n    ✗ ERROR: ${anyEvent.message}\n`);
      }
    }
  }

  if (awaitingUser) {
    const options = ((awaitingUser.payload as Record<string, unknown>)?.options ?? []) as Array<{
      label: string;
      value: string;
      description?: string;
    }>;

    const approvalRegex = /approve|proceed|yes|confirm|execute|continue|go\s*ahead|ok|start/i;
    const selected = options.find((o) => approvalRegex.test(o.label)) ?? options[0];

    if (!selected) {
      console.log('\n  ⚠️  No options to choose from — stopping');
      return;
    }

    onResume();
    await runAgentTurn(
      {
        sessionId: payload.sessionId,
        uiAction: {
          toolUseId: awaitingUser.toolUseId,
          data: selected.value,
          label: selected.label,
        },
      },
      onResume,
      depth + 1
    );
  }
}

main().catch((err) => {
  console.error('');
  console.error('Unexpected error:', err);
  process.exit(1);
});
