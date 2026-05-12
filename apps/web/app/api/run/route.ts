import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface AgentStatus {
  active: string | null;
  label: string;
  updatedAt: number;
}

interface RunPayload {
  runId: string | null;
  runDir: string | null;
  events: unknown[];
  messages: unknown[];
  chatMessages: unknown[];
  outcome: unknown | null;
  running: boolean;
  status: AgentStatus | null;
  task: string | null;
  agentSources?: Record<string, string>;
}

function findRunsDir(): string | null {
  const fromEnv = process.env.AGENTRAFT_RUNS_DIR;
  if (fromEnv && existsSync(fromEnv)) return resolve(fromEnv);
  const candidates = [
    resolve(process.cwd(), '../treasury-demo/runs'),
    resolve(process.cwd(), '../../apps/treasury-demo/runs'),
    resolve(process.cwd(), 'runs'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return null;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function readJsonl(path: string): unknown[] {
  try {
    const text = readFileSync(path, 'utf8');
    return text
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

export async function GET(): Promise<NextResponse<RunPayload>> {
  const runsDir = findRunsDir();
  const empty: RunPayload = {
    runId: null,
    runDir: null,
    events: [],
    messages: [],
    chatMessages: [],
    outcome: null,
    running: false,
    status: null,
    task: null,
  };
  if (!runsDir) return NextResponse.json(empty);
  const entries = readdirSync(runsDir)
    .filter((name) => {
      try {
        return statSync(join(runsDir, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
  const latest = entries[entries.length - 1];
  if (!latest) return NextResponse.json({ ...empty, runDir: runsDir });
  const runDir = join(runsDir, latest);
  const eventsJsonl = join(runDir, 'events.jsonl');
  const events = existsSync(eventsJsonl)
    ? readJsonl(eventsJsonl)
    : (readJson<unknown[]>(join(runDir, 'events.json')) ?? []);
  const messages = readJsonl(join(runDir, 'messages.jsonl'));
  const chatMessages = readJsonl(join(runDir, 'chat.jsonl'));
  const outcome = readJson<unknown>(join(runDir, 'outcome.json'));
  const running = existsSync(join(runDir, 'running.json'));
  const status = readJson<AgentStatus>(join(runDir, 'status.json'));
  const taskFile = readJson<{ task: string; agentSources?: Record<string, string> }>(join(runDir, 'task.json'));
  return NextResponse.json({
    runId: latest,
    runDir,
    events,
    messages,
    chatMessages,
    outcome,
    running,
    status,
    task: taskFile?.task ?? null,
    agentSources: taskFile?.agentSources,
  });
}
