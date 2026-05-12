'use client';
import { styleFor } from '@/lib/agents';
import type { AgentStats } from '@/lib/timeline';

interface Props {
  agentIds: string[];
  currentLeader: string | null;
  initialLeader: string | null;
  stats: Record<string, AgentStats>;
  runId: string | null;
  outcome: { status: string; epoch: number } | null;
  activeAgent?: string | null;
  agentSources?: Record<string, string>;
}

export default function AgentRoster({
  agentIds,
  currentLeader,
  initialLeader,
  stats,
  runId,
  outcome,
  activeAgent,
  agentSources,
}: Props): JSX.Element {
  const ordered = agentIds.length
    ? agentIds
    : ['leader', 'risk', 'compliance', 'market']; // fallback before any messages

  return (
    <aside className="bg-panel rounded-lg border border-white/5 h-full flex flex-col">
      <div className="p-4 border-b border-white/5">
        <div className="text-sm uppercase tracking-wider text-muted">Swarm</div>
        <div className="text-xs text-white/50 mt-1">{ordered.length}-of-{ordered.length} agents · Raft consensus</div>
      </div>

      <div className="p-2 flex-1 overflow-auto">
        {ordered.map((id) => {
          const s = styleFor(id);
          const st = stats[id] ?? { id, proposals: 0, approves: 0, rejects: 0, electionVotes: 0 };
          const isLeader = currentLeader === id;
          const wasInitial = initialLeader === id && currentLeader && currentLeader !== id;
          const isActive = activeAgent === id;
          return (
            <div
              key={id}
              className={`flex items-start gap-3 p-3 rounded-md mb-1 ${
                isLeader ? 'bg-white/5 ring-1 ' + s.ring : ''
              } ${isActive ? 'ring-2 ' + s.ring + ' animate-pulse' : ''}`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center text-base font-bold ${s.bubbleBg} ${s.color}`}
              >
                {s.initials}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-semibold ${s.color}`}>{s.displayName}</span>
                  {isLeader && <span title="current leader">👑</span>}
                  {wasInitial && (
                    <span className="text-[10px] text-rose-300/80 uppercase tracking-wider" title="deposed leader">
                      deposed
                    </span>
                  )}
                  {agentSources?.[id] === '0g' && (
                    <span className="text-[10px] text-teal-300/90 border border-teal-400/30 rounded px-1 py-0.5 bg-teal-500/10" title="TEE-verified via 0G Compute">
                      🔒 TEE
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-white/40 truncate">{id}</div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-white/60 mt-1.5">
                  <span>📝 {st.proposals}</span>
                  <span className="text-good">✓ {st.approves}</span>
                  <span className="text-bad">✗ {st.rejects}</span>
                  {st.electionVotes > 0 && <span className="text-bad">🚨 {st.electionVotes}</span>}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-white/5 p-3 text-[11px] text-white/50">
        <div className="flex items-center justify-between">
          <span>run</span>
          <span className="text-white/70 truncate ml-2 max-w-[140px]">{runId ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between mt-1">
          <span>outcome</span>
          <span
            className={
              outcome?.status === 'executed'
                ? 'text-good'
                : outcome?.status === 'halted'
                ? 'text-bad'
                : 'text-white/70'
            }
          >
            {outcome?.status ?? 'pending'}
            {outcome ? ` · e${outcome.epoch}` : ''}
          </span>
        </div>
      </div>
    </aside>
  );
}
