'use client';
import { useEffect, useMemo, useState } from 'react';
import AgentRoster from '@/components/AgentRoster';
import ProposalHeader from '@/components/ProposalHeader';
import Conversation from '@/components/Conversation';
import CommandBar from '@/components/CommandBar';
import { deriveView, type AgentMessage, type ChainEvent } from '@/lib/timeline';

interface AgentStatus {
  active: string | null;
  label: string;
  updatedAt: number;
}

interface RunPayload {
  runId: string | null;
  runDir: string | null;
  events: ChainEvent[];
  messages: AgentMessage[];
  chatMessages: AgentMessage[];
  outcome: { status: string; epoch: number; actionHash?: string; reason?: string } | null;
  running: boolean;
  status: AgentStatus | null;
  task: string | null;
  agentSources?: Record<string, string>;
}

export default function Page() {
  const [data, setData] = useState<RunPayload>({
    runId: null,
    runDir: null,
    events: [],
    messages: [],
    chatMessages: [],
    outcome: null,
    running: false,
    status: null,
    task: null,
  });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch('/api/run', { cache: 'no-store' });
        if (!res.ok) return;
        const json = (await res.json()) as RunPayload;
        if (!cancelled) setData(json);
      } catch {
        // ignore
      }
    };
    void tick();
    const id = setInterval(tick, 600);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const view = useMemo(
    () => deriveView(data.messages, data.events, data.outcome, data.chatMessages),
    [data.messages, data.events, data.outcome, data.chatMessages]
  );
  const initialLeader = view.proposals[0]?.leader ?? null;
  const hasRun = data.runId !== null;

  const submitTask = async (task: string): Promise<void> => {
    const res = await fetch('/api/run/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `start failed (${res.status})`);
    }
  };

  const sendChat = async (message: string): Promise<void> => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? `chat failed (${res.status})`);
    }
  };

  return (
    <main className="h-screen w-full flex flex-col">
      <header className="flex items-center justify-between px-5 py-3 border-b border-white/5 bg-panel/40">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="text-lg font-bold tracking-tight">AgentRaft</h1>
          <span className="text-xs text-muted whitespace-nowrap">Decision Swarm</span>
          {data.task && (
            <span className="text-xs text-white/60 truncate max-w-[40vw]" title={data.task}>
              · {data.task}
            </span>
          )}
          {data.running && (
            <span className="flex items-center gap-1.5 text-xs text-warn ml-2 whitespace-nowrap">
              <span className="w-2 h-2 rounded-full bg-warn animate-pulse" />
              live
            </span>
          )}
        </div>
        <div className="text-[11px] text-white/50 whitespace-nowrap">
          quorum {view.quorumSize}/{view.followerCount} · {view.proposals.length} proposal{view.proposals.length === 1 ? '' : 's'}
        </div>
      </header>
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[280px_1fr] min-h-0">
        <div className="hidden lg:block p-3">
          <AgentRoster
            agentIds={view.agentIds}
            currentLeader={view.currentLeader}
            initialLeader={initialLeader}
            stats={view.agentStats}
            runId={data.runId}
            outcome={view.outcome}
            activeAgent={data.status?.active ?? null}
            agentSources={data.agentSources}
          />
        </div>
        <section className="flex flex-col min-h-0 border-l border-white/5">
          <ProposalHeader
            active={view.active}
            proposals={view.proposals}
            followerCount={view.followerCount}
            quorumSize={view.quorumSize}
          />
          <Conversation items={view.timeline} thinkingAgent={data.running ? data.status?.active ?? null : null} />
          <CommandBar
            running={data.running}
            status={data.status}
            onSubmit={submitTask}
            onChat={sendChat}
            hasRun={hasRun}
          />
        </section>
      </div>
    </main>
  );
}
