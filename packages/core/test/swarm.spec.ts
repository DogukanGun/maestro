import { describe, it, expect } from 'vitest';
import {
  runSwarm,
  InMemoryLogStore,
  InMemoryConsensusGate,
  InMemoryMessageBus,
  InMemoryIdentityProvider,
  type Agent,
  type ChainEvent,
} from '../src/index.js';

const mkAgents = (cfg: { leader: 'good' | 'bad'; auditors: ('approve' | 'reject')[] }): Agent[] => {
  const leader: Agent = {
    id: 'leader',
    role: 'leader',
    async propose() {
      const action =
        cfg.leader === 'good'
          ? { kind: 'transfer', amount: 5_000, dest: '0xSafe' }
          : { kind: 'transfer', amount: 100_000, dest: '0xRecentlyFunded' };
      return {
        payload: {
          proposalId: `p-${Math.random().toString(36).slice(2, 8)}`,
          actionHash: `0x${cfg.leader === 'good' ? 'aaaa' : 'bbbb'}`,
          action,
        },
      };
    },
    async vote() {
      throw new Error('leader does not vote');
    },
  };
  const auditors = cfg.auditors.map<Agent>((decision, i) => ({
    id: `auditor-${i + 1}`,
    role: 'follower',
    async vote(proposal) {
      return {
        payload: {
          proposalId: proposal.payload.proposalId,
          decision: decision === 'approve' ? 'APPROVE' : 'REJECT',
          reason: decision === 'approve' ? 'looks safe' : 'policy violation',
        },
      };
    },
  }));
  return [leader, ...auditors];
};

const mkInfra = (agentIds: string[], initialLeader?: string) => {
  const logStore = new InMemoryLogStore();
  const consensusGate = new InMemoryConsensusGate({
    agents: agentIds,
    ...(initialLeader ? { initialLeader } : {}),
  });
  const messageBus = new InMemoryMessageBus();
  const identityProvider = new InMemoryIdentityProvider(
    agentIds.map((id) => ({ id, role: id === 'leader' ? 'leader' : 'follower' }))
  );
  const events: ChainEvent[] = [];
  for (const name of ['Proposed', 'Voted', 'LeaderDeposed', 'Executed', 'LogBatchSealed'] as const) {
    consensusGate.on(name, (e) => events.push(e));
  }
  return { logStore, consensusGate, messageBus, identityProvider, events };
};

describe('runSwarm', () => {
  it('executes a proposal when quorum approves', async () => {
    const agents = mkAgents({ leader: 'good', auditors: ['approve', 'approve'] });
    const infra = mkInfra(agents.map((a) => a.id), 'leader');

    const outcome = await runSwarm({
      agents,
      ...infra,
      task: 'transfer treasury funds',
    });

    expect(outcome.status).toBe('executed');
    if (outcome.status === 'executed') {
      expect(outcome.epoch).toBe(0);
      expect(outcome.actionHash).toBe('0xaaaa');
    }
    expect(infra.events.some((e) => e.name === 'Proposed')).toBe(true);
    expect(infra.events.some((e) => e.name === 'Executed')).toBe(true);
    expect(infra.events.filter((e) => e.name === 'Voted')).toHaveLength(2);
  });

  it('deposes a Byzantine leader and recovers via rotation', async () => {
    let proposalsByLeader = 0;
    const leaderGood: Agent = {
      id: 'auditor-1',
      role: 'leader',
      async propose() {
        proposalsByLeader += 1;
        return {
          payload: {
            proposalId: `recovery-${proposalsByLeader}`,
            actionHash: '0xc0de',
            action: { kind: 'transfer', amount: 5_000, dest: '0xSafe' },
          },
        };
      },
      async vote(proposal) {
        const action = proposal.payload.action as { amount?: number };
        return {
          payload: {
            proposalId: proposal.payload.proposalId,
            decision: (action.amount ?? 0) > 50_000 ? 'REJECT' : 'APPROVE',
          },
        };
      },
    };
    const leaderBad: Agent = {
      id: 'leader',
      role: 'leader',
      async propose() {
        return {
          payload: {
            proposalId: 'poisoned-1',
            actionHash: '0xdead',
            action: { kind: 'transfer', amount: 100_000, dest: '0xRecentlyFunded' },
          },
        };
      },
      async vote(proposal) {
        return {
          payload: { proposalId: proposal.payload.proposalId, decision: 'APPROVE' },
        };
      },
    };
    const auditor2: Agent = {
      id: 'auditor-2',
      role: 'follower',
      async vote(proposal) {
        const action = proposal.payload.action as { amount?: number };
        return {
          payload: {
            proposalId: proposal.payload.proposalId,
            decision: (action.amount ?? 0) > 50_000 ? 'REJECT' : 'APPROVE',
            reason: 'over policy limit',
          },
        };
      },
    };

    const agents = [leaderBad, leaderGood, auditor2];
    const infra = mkInfra(['leader', 'auditor-1', 'auditor-2'], 'leader');

    const outcome = await runSwarm({ agents, ...infra, task: 'treasury' });

    expect(outcome.status).toBe('executed');
    if (outcome.status === 'executed') {
      expect(outcome.actionHash).toBe('0xc0de');
      expect(outcome.epoch).toBeGreaterThan(0);
    }
    expect(infra.events.filter((e) => e.name === 'LeaderDeposed')).toHaveLength(1);
    expect(infra.events.filter((e) => e.name === 'Proposed').length).toBeGreaterThanOrEqual(2);
    expect(infra.events.filter((e) => e.name === 'Executed')).toHaveLength(1);
  });

  it('halts after maxEpochs when no recovery succeeds', async () => {
    const stubborn: Agent[] = [
      {
        id: 'a',
        role: 'leader',
        async propose() {
          return {
            payload: { proposalId: 'p', actionHash: '0x1', action: { bad: true } },
          };
        },
        async vote(p) {
          return { payload: { proposalId: p.payload.proposalId, decision: 'REJECT' } };
        },
      },
      {
        id: 'b',
        role: 'follower',
        async propose() {
          return {
            payload: { proposalId: 'p', actionHash: '0x1', action: { bad: true } },
          };
        },
        async vote(p) {
          return { payload: { proposalId: p.payload.proposalId, decision: 'REJECT' } };
        },
      },
      {
        id: 'c',
        role: 'follower',
        async propose() {
          return {
            payload: { proposalId: 'p', actionHash: '0x1', action: { bad: true } },
          };
        },
        async vote(p) {
          return { payload: { proposalId: p.payload.proposalId, decision: 'REJECT' } };
        },
      },
    ];
    const infra = mkInfra(['a', 'b', 'c']);
    const outcome = await runSwarm({ agents: stubborn, ...infra, task: 't', maxEpochs: 3 });
    expect(outcome.status).toBe('halted');
  });
});
