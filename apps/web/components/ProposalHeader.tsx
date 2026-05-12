'use client';
import { styleFor } from '@/lib/agents';
import type { ProposalState } from '@/lib/timeline';

interface Props {
  active: ProposalState | null;
  proposals: ProposalState[];
  followerCount: number;
  quorumSize: number;
}

function formatAction(action: any): string {
  if (!action) return '';
  if (action.summary) return action.summary;
  return JSON.stringify(action);
}

export default function ProposalHeader({ active, proposals, followerCount, quorumSize }: Props): JSX.Element {
  const last = proposals[proposals.length - 1] ?? null;
  const display = active ?? last;

  if (!display) {
    return (
      <div className="border-b border-white/5 bg-panel/60 px-5 py-3 text-sm text-muted">
        Awaiting first proposal…
      </div>
    );
  }

  const tally = display.approvals.length;
  const reject = display.rejects.length;
  const pct = Math.min(100, (tally / Math.max(1, quorumSize)) * 100);
  const leaderStyle = styleFor(display.leader);
  const stateLabel =
    display.status === 'executed'
      ? '✅ Executed'
      : display.status === 'blocked'
      ? '⛔ Blocked'
      : '⏳ Awaiting votes';
  const stateColor =
    display.status === 'executed'
      ? 'text-good'
      : display.status === 'blocked'
      ? 'text-bad'
      : 'text-warn';

  return (
    <div className="border-b border-white/5 bg-panel/60 px-5 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs">
            <span className="uppercase tracking-wider text-muted">Active proposal</span>
            <span className="text-white/40">·</span>
            <span className={leaderStyle.color}>👑 {leaderStyle.displayName}</span>
            <span className="text-white/40">·</span>
            <span className="text-white/60">epoch {display.epoch}</span>
          </div>
          <div className="mt-1 text-sm text-white/90 truncate">
            {formatAction(display.action) || display.proposalId}
          </div>
          {display.actionHash && (
            <div className="mt-0.5 text-[11px] text-white/40 font-mono truncate">
              {display.actionHash}
            </div>
          )}
        </div>
        <div className={`text-xs font-semibold whitespace-nowrap ${stateColor}`}>{stateLabel}</div>
      </div>
      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-white/60 mb-1">
          <span>
            {tally}/{quorumSize} approvals needed
            {reject > 0 && <span className="text-bad ml-2">{reject} reject{reject > 1 ? 's' : ''}</span>}
          </span>
          <span className="text-white/40">{followerCount} followers</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
          <div
            className={`h-full transition-all ${
              display.status === 'blocked' ? 'bg-bad' : tally >= quorumSize ? 'bg-good' : 'bg-warn'
            }`}
            style={{ width: `${display.status === 'blocked' ? 100 : pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
