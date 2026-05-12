export interface AgentMessage {
  agent_id: string;
  timestamp: number;
  epoch: number;
  nonce: number;
  message_type: 'PROPOSAL' | 'VOTE' | 'VOTE_NEW_LEADER' | 'CHAT' | 'NOMINATION';
  payload: any;
}

export interface ChainEvent {
  name:
    | 'Proposed'
    | 'Voted'
    | 'LeaderElectionTriggered'
    | 'LeaderDeposed'
    | 'Executed'
    | 'LogBatchSealed';
  data: Record<string, any>;
  txHash?: string;
}

export type TimelineItem =
  | { kind: 'msg'; key: string; msg: AgentMessage }
  | { kind: 'system'; key: string; epoch: number; label: string; tone: 'info' | 'good' | 'bad' };

export interface ProposalState {
  proposalId: string;
  actionHash?: string;
  epoch: number;
  leader: string;
  rationale?: string;
  action?: any;
  approvals: { agent: string; reason?: string }[];
  rejects: { agent: string; reason?: string }[];
  status: 'open' | 'executed' | 'blocked';
}

export interface AgentStats {
  id: string;
  proposals: number;
  approves: number;
  rejects: number;
  electionVotes: number;
}

export interface DerivedView {
  timeline: TimelineItem[];
  proposals: ProposalState[];
  active: ProposalState | null;
  currentLeader: string | null;
  totalAgents: number;
  agentIds: string[];
  agentStats: Record<string, AgentStats>;
  followerCount: number;
  quorumSize: number;
  outcome: { status: string; epoch: number } | null;
}

const ceilDiv = (a: number, b: number): number => Math.ceil(a / b);

export function deriveView(
  messages: AgentMessage[],
  events: ChainEvent[],
  outcome: { status: string; epoch: number } | null,
  chatMessages?: AgentMessage[],
): DerivedView {
  const allMessages = chatMessages?.length ? [...messages, ...chatMessages] : messages;
  const sortedMsgs = [...allMessages].sort((a, b) => a.epoch - b.epoch || a.nonce - b.nonce);
  const proposals: ProposalState[] = [];
  const agentSet = new Set<string>();
  const stats: Record<string, AgentStats> = {};

  const ensureStats = (id: string): AgentStats => {
    if (id !== 'user') agentSet.add(id);
    if (!stats[id]) stats[id] = { id, proposals: 0, approves: 0, rejects: 0, electionVotes: 0 };
    return stats[id]!;
  };

  for (const m of sortedMsgs) {
    ensureStats(m.agent_id);
    if (m.message_type === 'PROPOSAL') {
      stats[m.agent_id]!.proposals += 1;
      const p = m.payload ?? {};
      proposals.push({
        proposalId: p.proposalId ?? `p-${m.epoch}-${m.nonce}`,
        actionHash: p.actionHash,
        epoch: m.epoch,
        leader: m.agent_id,
        rationale: p.rationale,
        action: p.action,
        approvals: [],
        rejects: [],
        status: 'open',
      });
    } else if (m.message_type === 'VOTE' && proposals.length > 0) {
      const last = proposals[proposals.length - 1]!;
      const decision = m.payload?.decision;
      const reason = m.payload?.reason;
      if (decision === 'APPROVE') {
        last.approvals.push({ agent: m.agent_id, ...(reason ? { reason } : {}) });
        stats[m.agent_id]!.approves += 1;
      } else if (decision === 'REJECT') {
        last.rejects.push({ agent: m.agent_id, ...(reason ? { reason } : {}) });
        stats[m.agent_id]!.rejects += 1;
      }
    } else if (m.message_type === 'VOTE_NEW_LEADER') {
      stats[m.agent_id]!.electionVotes += 1;
    }
  }

  // Apply on-chain events to proposal status & leader changes.
  let currentLeader: string | null = null;
  for (const e of events) {
    if (e.name === 'Proposed') {
      currentLeader = e.data?.leader ?? currentLeader;
    } else if (e.name === 'Executed') {
      const target = e.data?.actionHash;
      const p = proposals.find((p) => p.actionHash === target);
      if (p) p.status = 'executed';
    } else if (e.name === 'LeaderDeposed') {
      currentLeader = e.data?.newLeader ?? currentLeader;
      const target = e.data?.actionHash;
      const p = proposals.find((p) => p.actionHash === target);
      if (p) p.status = 'blocked';
    }
  }

  const active = [...proposals].reverse().find((p) => p.status === 'open') ?? null;

  const agentIds = [...agentSet];
  const totalAgents = agentIds.length || 3;
  const followerCount = Math.max(1, totalAgents - 1);
  const quorumSize = ceilDiv(2 * followerCount, 3);

  // Build election phase markers
  const nominationMsgs = sortedMsgs.filter((m) => m.message_type === 'NOMINATION');
  const electionMarkers: TimelineItem[] = [];
  if (nominationMsgs.length > 0) {
    electionMarkers.push({
      kind: 'system',
      key: 'sys-election-start',
      epoch: 0,
      label: '🗳️ Leader election — agents are nominating…',
      tone: 'info',
    });
    // Derive winner from nomination vote count
    const votes = new Map<string, number>();
    for (const m of nominationMsgs) {
      const nom = (m.payload as any)?.nominee;
      if (nom) votes.set(nom, (votes.get(nom) ?? 0) + 1);
    }
    let winner = '';
    let maxV = 0;
    for (const [id, v] of votes) {
      if (v > maxV) { maxV = v; winner = id; }
    }
    if (winner) {
      const allTied = maxV === 1 && votes.size >= nominationMsgs.length;
      electionMarkers.push({
        kind: 'system',
        key: 'sys-election-result',
        epoch: 0,
        label: allTied
          ? `👑 ${winner} elected as leader — tiebreak`
          : `👑 ${winner} elected as leader (${maxV}/${nominationMsgs.length} nominations)`,
        tone: 'good',
      });
    }
  }

  const electionHappened = nominationMsgs.length > 0;
  const timeline: TimelineItem[] = [];
  let addedElectionMarkers = false;
  let proposalIdx = 0;
  for (const m of sortedMsgs) {
    // Insert election start marker before first nomination
    if (!addedElectionMarkers && m.message_type === 'NOMINATION') {
      timeline.push(electionMarkers[0]!);
      addedElectionMarkers = true;
    }
    if (m.message_type === 'PROPOSAL') {
      const p = proposals[proposalIdx++];
      // Suppress the first "Epoch N · X is leader" pill when election already established the leader
      const isFirstProposal = proposalIdx === 1;
      if (p && !(electionHappened && isFirstProposal)) {
        timeline.push({
          kind: 'system',
          key: `sys-prop-${p.proposalId}`,
          epoch: p.epoch,
          label: `Epoch ${p.epoch} · ${p.leader} is leader`,
          tone: 'info',
        });
      }
    }
    timeline.push({ kind: 'msg', key: `m-${m.epoch}-${m.nonce}-${m.agent_id}`, msg: m });
    // Insert election result marker after last nomination
    if (m.message_type === 'NOMINATION' && electionMarkers[1]) {
      const lastNom = nominationMsgs[nominationMsgs.length - 1];
      if (lastNom && m.nonce === lastNom.nonce && m.agent_id === lastNom.agent_id) {
        timeline.push(electionMarkers[1]);
      }
    }
    if (
      m.message_type === 'VOTE_NEW_LEADER' &&
      proposals[proposalIdx - 1] &&
      proposals[proposalIdx - 1]!.rejects.length >=
        ceilDiv(2 * followerCount, 3)
    ) {
      // depose marker is appended once when threshold crossed; dedupe via key
      const key = `sys-depose-${proposals[proposalIdx - 1]!.proposalId}`;
      if (!timeline.some((t) => t.key === key)) {
        timeline.push({
          kind: 'system',
          key,
          epoch: m.epoch,
          label: `Leader deposed — quorum reached (${proposals[proposalIdx - 1]!.rejects.length}/${followerCount})`,
          tone: 'bad',
        });
      }
    }
  }
  for (const p of proposals) {
    if (p.status === 'executed') {
      timeline.push({
        kind: 'system',
        key: `sys-exec-${p.proposalId}`,
        epoch: p.epoch,
        label: `Executed · ${p.approvals.length}/${followerCount} approvals`,
        tone: 'good',
      });
    } else if (p.status === 'blocked') {
      timeline.push({
        kind: 'system',
        key: `sys-block-${p.proposalId}`,
        epoch: p.epoch,
        label: `Blocked on-chain — proposal halted`,
        tone: 'bad',
      });
    }
  }

  return {
    timeline,
    proposals,
    active,
    currentLeader,
    totalAgents,
    agentIds,
    agentStats: stats,
    followerCount,
    quorumSize,
    outcome,
  };
}
