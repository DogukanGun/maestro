#!/usr/bin/env node
import { config as loadEnv } from 'dotenv';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

loadEnv();
loadEnv({ path: resolve(__dirname, '../../../.env'), override: false });
loadEnv({ path: resolve(__dirname, '../../../.env.local'), override: false });
import {
  runSwarm,
  InMemoryConsensusGate,
  InMemoryIdentityProvider,
  InMemoryLogStore,
  InMemoryMessageBus,
  type Agent,
  type ChainEvent,
} from '@agentraft/core';
import { LeaderAgent } from './agents/leader';
import { RiskAgent } from './agents/risk';
import { ComplianceAgent } from './agents/compliance';
import { MarketAgent } from './agents/market';

interface CliFlags {
  task: string;
  out: string;
  model?: string;
}

function parseArgs(argv: string[]): CliFlags {
  let task = '';
  let out = 'runs';
  let model: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--task') {
      const next = argv[++i];
      if (next) task = next;
    } else if (a === '--out') {
      const next = argv[++i];
      if (next) out = next;
    } else if (a === '--model') {
      const next = argv[++i];
      if (next) model = next;
    }
  }
  if (!task) {
    console.error(
      'usage: treasury-demo --task "<your treasury request>" [--model gpt-4o-mini]'
    );
    process.exit(1);
  }
  const result: CliFlags = { task, out };
  if (model !== undefined) result.model = model;
  return result;
}

async function classifyInput(task: string, model?: string): Promise<{ mode: 'task' | 'greet' }> {
  const trimmed = task.trim();
  if (!trimmed) return { mode: 'greet' };
  const { default: OpenAI } = await import('openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  try {
    const res = await openai.chat.completions.create({
      model: model ?? 'gpt-4o-mini',
      max_tokens: 30,
      messages: [
        {
          role: 'system',
          content:
            'Classify the user input for a multi-agent decision swarm. Reply JSON {"mode":"greet"} if it is a greeting, salutation, idle chitchat, or has no actionable request (e.g. "hi", "hello", "how are you", "test"). Reply {"mode":"task"} if it is an actionable task, question, decision, or problem to deliberate on. When unsure, prefer "task".',
        },
        { role: 'user', content: `Input: "${task}"` },
      ],
      response_format: { type: 'json_object' },
    });
    const parsed = JSON.parse(res.choices[0]?.message?.content ?? '{}');
    return { mode: parsed.mode === 'greet' ? 'greet' : 'task' };
  } catch {
    return { mode: 'task' }; // fail open
  }
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY is not set. Live agents require a real OpenAI API key.');
    process.exit(2);
  }

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(flags.out, runId);
  mkdirSync(runDir, { recursive: true });

  const messagesPath = join(runDir, 'messages.jsonl');
  const eventsPath = join(runDir, 'events.jsonl');
  const eventsJsonPath = join(runDir, 'events.json');
  const outcomePath = join(runDir, 'outcome.json');
  const runningPath = join(runDir, 'running.json');
  const statusPath = join(runDir, 'status.json');
  const taskPath = join(runDir, 'task.json');

  // Persistent leader across runs — election happens only on first run.
  // After that, every task reuses the same leader (until a depose mid-task elects a new one).
  const leaderStatePath = join(flags.out, '_leader.json');
  let persistedLeader: string | null = null;
  if (existsSync(leaderStatePath)) {
    try {
      const parsed = JSON.parse(readFileSync(leaderStatePath, 'utf8'));
      if (typeof parsed?.leader === 'string') persistedLeader = parsed.leader;
    } catch { /* ignore */ }
  }

  writeFileSync(messagesPath, '');
  writeFileSync(eventsPath, '');
  writeFileSync(
    taskPath,
    JSON.stringify({ task: flags.task, model: flags.model }, null, 2)
  );
  writeFileSync(
    runningPath,
    JSON.stringify({ startedAt: new Date().toISOString(), task: flags.task }, null, 2)
  );

  const writeStatus = (active: string | null, label: string): void => {
    writeFileSync(
      statusPath,
      JSON.stringify({ active, label, updatedAt: Date.now() }, null, 2)
    );
  };

  console.log(`AgentRaft Decision Swarm`);
  console.log(`  task:    ${flags.task}`);
  console.log(`  model:   ${flags.model ?? 'gpt-4o-mini'}`);
  console.log(`  run dir: ${runDir}\n`);

  writeStatus(null, 'classifying input…');

  const { mode } = await classifyInput(flags.task, flags.model);
  console.log(`[gate]  Input classified as: ${mode}`);

  writeStatus(null, mode === 'greet' ? 'registering swarm' : 'preparing swarm');

  const agentIds = ['leader', 'risk', 'compliance', 'market'];
  const agents: Agent[] = [
    new LeaderAgent({
      id: 'leader',
      task: flags.task,
      ...(flags.model ? { model: flags.model } : {}),
    }),
    new RiskAgent({
      id: 'risk',
      task: flags.task,
      ...(flags.model ? { model: flags.model } : {}),
    }),
    new ComplianceAgent({
      id: 'compliance',
      task: flags.task,
      ...(flags.model ? { model: flags.model } : {}),
    }),
    new MarketAgent({
      id: 'market',
      task: flags.task,
      ...(flags.model ? { model: flags.model } : {}),
    }),
  ];

  // Wrap each agent so we can publish a 'thinking' status before its turn.
  const instrumented: Agent[] = agents.map((a) => {
    const wrapped: Agent = {
      id: a.id,
      role: a.role,
      vote: async (proposal, ctx) => {
        writeStatus(a.id, `${a.id} is reviewing the proposal…`);
        const out = await a.vote(proposal, ctx);
        writeStatus(null, `${a.id} replied`);
        return out;
      },
    };
    if (a.nominate) {
      wrapped.nominate = async (ctx) => {
        writeStatus(a.id, `${a.id} is deciding who should lead…`);
        const out = await a.nominate!(ctx);
        writeStatus(null, `${a.id} nominated ${out.nominee}`);
        return out;
      };
    }
    if (a.greet) {
      wrapped.greet = async (ctx) => {
        writeStatus(a.id, `${a.id} is addressing the swarm…`);
        const out = await a.greet!(ctx);
        writeStatus(null, `${a.id} greeted`);
        return out;
      };
    }
    if (a.propose) {
      wrapped.propose = async (ctx) => {
        writeStatus(a.id, `${a.id} is drafting a proposal…`);
        const out = await a.propose!(ctx);
        writeStatus(null, `${a.id} proposed`);
        return out;
      };
    }
    if (a.summarize) {
      wrapped.summarize = async (ctx, outcome) => {
        writeStatus(a.id, `${a.id} is finalizing the answer…`);
        const out = await a.summarize!(ctx, outcome);
        writeStatus(null, `${a.id} finalized`);
        return out;
      };
    }
    return wrapped;
  });

  const logStore = new InMemoryLogStore();
  const consensusGate = new InMemoryConsensusGate({
    agents: agentIds,
    initialLeader: persistedLeader ?? 'leader',
  });
  const messageBus = new InMemoryMessageBus();
  const identityProvider = new InMemoryIdentityProvider(
    agentIds.map((id) => ({ id, role: 'follower' as const }))
  );

  const events: ChainEvent[] = [];
  for (const name of [
    'Proposed',
    'Voted',
    'LeaderElectionTriggered',
    'LeaderDeposed',
    'Executed',
    'LogBatchSealed',
  ] as const) {
    consensusGate.on(name as any, (e) => {
      events.push(e);
      appendFileSync(eventsPath, JSON.stringify({ name: e.name, data: e.data }) + '\n');
      console.log(`[chain] ${e.name} ${JSON.stringify(e.data)}`);
    });
  }

  messageBus.subscribe((m) => {
    appendFileSync(messagesPath, JSON.stringify(m) + '\n');
    console.log(`[msg]   ${m.message_type.padEnd(18)} from=${m.agent_id.padEnd(12)} epoch=${m.epoch}`);
  });

  try {
    const outcome = await runSwarm({
      agents: instrumented,
      identityProvider,
      logStore,
      consensusGate,
      messageBus,
      task: { kind: mode, text: flags.task },
      maxEpochs: 3,
      mode,
      // First run elects the leader; every subsequent run reuses it.
      skipElection: persistedLeader !== null,
    });

    // Persist whoever is leader at the end of this run (may have changed via depose).
    try {
      const finalLeader = await consensusGate.currentLeader();
      writeFileSync(
        leaderStatePath,
        JSON.stringify({ leader: finalLeader, electedAt: Date.now() }, null, 2)
      );
    } catch (e) {
      console.warn('[state] failed to persist leader:', e);
    }

    writeFileSync(
      eventsJsonPath,
      JSON.stringify(events.map((e) => ({ name: e.name, data: e.data })), null, 2)
    );
    writeFileSync(outcomePath, JSON.stringify(outcome, null, 2));
    writeStatus(null, outcome.status === 'executed' ? 'executed' : 'halted');
    console.log(`\nOutcome: ${JSON.stringify(outcome, null, 2)}`);
    console.log(`\nartifacts written to ${runDir}/`);
  } catch (err) {
    writeFileSync(
      outcomePath,
      JSON.stringify({ status: 'error', error: String(err) }, null, 2)
    );
    writeStatus(null, 'errored');
    throw err;
  } finally {
    if (existsSync(runningPath)) unlinkSync(runningPath);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
