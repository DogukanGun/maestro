'use client';
import { useEffect, useRef } from 'react';
import { styleFor } from '@/lib/agents';
import type { TimelineItem } from '@/lib/timeline';

interface Props {
  items: TimelineItem[];
  thinkingAgent?: string | null;
}

const TYPE_ICON: Record<string, string> = {
  PROPOSAL: '📝',
  VOTE: '🗳️',
  VOTE_NEW_LEADER: '🚨',
  CHAT: '💬',
  NOMINATION: '🗣️',
};

function formatPayload(type: string, payload: any): string {
  if (!payload) return '';
  if (type === 'PROPOSAL') {
    const action = payload.action;
    let head: string;
    if (action?.kind === 'recommendation') {
      const pct = Math.round((action.confidence ?? 0) * 100);
      head = `Proposes: ${action.summary} (confidence: ${pct}%)`;
    } else if (action?.summary) {
      head = `Proposes: ${action.summary}`;
    } else {
      head = `Proposes: ${JSON.stringify(action ?? {})}`;
    }
    const body = action?.details ?? payload.rationale;
    return body ? `${head}\n${body}` : head;
  }
  if (type === 'VOTE') {
    const decision = payload.decision === 'APPROVE' ? '✅ Approves' : '❌ Rejects';
    return payload.reason ? `${decision} — ${payload.reason}` : decision;
  }
  if (type === 'VOTE_NEW_LEADER') {
    return payload.reason
      ? `Calls for leader election — ${payload.reason}`
      : 'Calls for leader election';
  }
  if (type === 'CHAT') {
    return payload.text ?? '';
  }
  if (type === 'NOMINATION') {
    const nominee = payload.nominee ?? '?';
    const reasoning = payload.reasoning ?? '';
    return reasoning ? `Nominates ${nominee} — ${reasoning}` : `Nominates ${nominee}`;
  }
  return JSON.stringify(payload);
}

function timeFmt(ts: number): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return '';
  }
}

export default function Conversation({ items, thinkingAgent }: Props): JSX.Element {
  const endRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [items.length, thinkingAgent]);
  const ts = thinkingAgent ? styleFor(thinkingAgent) : null;

  return (
    <div className="flex-1 overflow-auto px-5 py-4 space-y-3 bg-bg/50">
      {items.length === 0 && (
        <div className="text-center text-muted text-sm pt-12">
          Swarm is idle. Submit a task to begin.
        </div>
      )}
      {items.map((item) => {
        if (item.kind === 'system') {
          const tone =
            item.tone === 'good' ? 'text-good border-good/30 bg-good/5' :
            item.tone === 'bad' ? 'text-bad border-bad/30 bg-bad/5' :
            'text-muted border-white/10 bg-white/[0.02]';
          return (
            <div key={item.key} className="flex justify-center">
              <div className={`text-[11px] px-3 py-1 rounded-full border ${tone}`}>
                {item.label}
              </div>
            </div>
          );
        }
        const m = item.msg;
        const s = styleFor(m.agent_id);
        const decision = m.message_type === 'VOTE' ? m.payload?.decision : null;
        const accent =
          decision === 'APPROVE'
            ? 'border-good/40'
            : decision === 'REJECT' || m.message_type === 'VOTE_NEW_LEADER'
            ? 'border-bad/40'
            : s.bubbleBorder;

        return (
          <div key={item.key} className="flex items-start gap-3">
            <div
              className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${s.bubbleBg} ${s.color}`}
              title={m.agent_id}
            >
              {s.initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`text-sm font-semibold ${s.color}`}>{s.displayName}</span>
                <span className="text-[10px] text-white/40 uppercase tracking-wider">
                  {TYPE_ICON[m.message_type] ?? ''} {m.message_type.replace('_', ' ')}
                </span>
                <span className="text-[10px] text-white/30 ml-auto">
                  e{m.epoch}.{m.nonce} · {timeFmt(m.timestamp)}
                </span>
              </div>
              <div
                className={`rounded-2xl rounded-tl-sm border px-3.5 py-2.5 text-sm leading-relaxed text-white/90 whitespace-pre-wrap ${accent} ${s.bubbleBg}`}
              >
                {formatPayload(m.message_type, m.payload)}
              </div>
            </div>
          </div>
        );
      })}
      {ts && thinkingAgent && (
        <div className="flex items-start gap-3">
          <div
            className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold ${ts.bubbleBg} ${ts.color}`}
          >
            {ts.initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2 mb-1">
              <span className={`text-sm font-semibold ${ts.color}`}>{ts.displayName}</span>
              <span className="text-[10px] text-white/40 uppercase tracking-wider">thinking</span>
            </div>
            <div className={`inline-flex gap-1 px-3.5 py-3 rounded-2xl rounded-tl-sm border ${ts.bubbleBorder} ${ts.bubbleBg}`}>
              <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse [animation-delay:140ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/60 animate-pulse [animation-delay:280ms]" />
            </div>
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}
