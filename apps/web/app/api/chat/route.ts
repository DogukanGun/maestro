import { readFileSync, appendFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { NextResponse } from 'next/server';
import OpenAI from 'openai';

export const dynamic = 'force-dynamic';

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

function findLatestRunDir(): string | null {
  const runsDir = findRunsDir();
  if (!runsDir) return null;
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
  return latest ? join(runsDir, latest) : null;
}

function readJsonl(path: string): unknown[] {
  try {
    const text = readFileSync(path, 'utf8');
    return text
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

function resolveCurrentLeader(runDir: string | null): string {
  if (!runDir) return 'leader';
  const events = readJsonl(join(runDir, 'events.jsonl')) as Array<{ name: string; data: any }>;
  let leader = 'leader';
  for (const e of events) {
    if (e.name === 'Proposed' && e.data?.leader) leader = e.data.leader;
    else if (e.name === 'LeaderDeposed' && e.data?.newLeader) leader = e.data.newLeader;
  }
  return leader;
}

const AGENT_PERSONAS: Record<string, string> = {
  leader: `You are the Coordinator agent of an AgentRaft swarm — a fault-tolerant multi-agent system using Raft-like consensus. You orchestrate discussion and propose solutions to any kind of task. Respond decisively and transparently. Reference the swarm history if relevant. Keep your reply under 3 sentences.`,
  risk: `You are the Critic agent of an AgentRaft swarm. You challenge assumptions and find problems others miss. Be precise and specific about what could go wrong. Reference the swarm history if relevant. Keep your reply under 3 sentences.`,
  compliance: `You are the Strategist agent of an AgentRaft swarm. You assess feasibility, tradeoffs, and long-term fit of any proposal. Reference practical constraints and key tradeoffs. Reference the swarm history if relevant. Keep your reply under 3 sentences.`,
  market: `You are the Analyst agent of an AgentRaft swarm. You provide data-driven, research-informed perspective on any topic. Ground your replies in context and evidence. Reference the swarm history if relevant. Keep your reply under 3 sentences.`,
};

interface ChatBody {
  message?: string;
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!process.env.OPENAI_API_KEY) {
    return NextResponse.json({ ok: false, error: 'OPENAI_API_KEY is not set' }, { status: 400 });
  }

  let body: ChatBody = {};
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const message = (body.message ?? '').trim();
  if (!message) {
    return NextResponse.json({ ok: false, error: 'message is required' }, { status: 400 });
  }

  const runDir = findLatestRunDir();
  const swarmHistory = runDir ? readJsonl(join(runDir, 'messages.jsonl')) : [];
  const historyContext =
    swarmHistory.length > 0
      ? `\n\nRecent swarm history (${swarmHistory.length} messages total, showing last 6):\n${JSON.stringify(swarmHistory.slice(-6), null, 2)}`
      : '\n\nNo swarm run has completed yet.';

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const now = Date.now();
  // Use epoch 99999 so chat messages always sort after swarm messages in the timeline
  const chatEpoch = 99999;

  const userMsg = {
    agent_id: 'user',
    timestamp: now,
    epoch: chatEpoch,
    nonce: now,
    message_type: 'CHAT' as const,
    payload: { text: message },
  };

  const currentLeader = resolveCurrentLeader(runDir);
  const systemPrompt = AGENT_PERSONAS[currentLeader] ?? AGENT_PERSONAS.leader!;
  const agentMsgs: typeof userMsg[] = [];
  try {
    const res = await openai.chat.completions.create({
      model: process.env.AGENTRAFT_MODEL ?? 'gpt-4o-mini',
      max_tokens: 220,
      messages: [
        { role: 'system', content: systemPrompt + historyContext },
        { role: 'user', content: message },
      ],
    });
    const text = res.choices[0]?.message?.content?.trim() ?? '(no response)';
    agentMsgs.push({
      agent_id: currentLeader,
      timestamp: now + 1,
      epoch: chatEpoch,
      nonce: now + 1,
      message_type: 'CHAT' as const,
      payload: { text },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: `chat failed: ${String(err)}` }, { status: 500 });
  }

  if (runDir) {
    const chatPath = join(runDir, 'chat.jsonl');
    try {
      appendFileSync(chatPath, JSON.stringify(userMsg) + '\n');
      for (const m of agentMsgs) appendFileSync(chatPath, JSON.stringify(m) + '\n');
    } catch {
      // ignore write errors
    }
  }

  return NextResponse.json({ ok: true, messages: [userMsg, ...agentMsgs] });
}
