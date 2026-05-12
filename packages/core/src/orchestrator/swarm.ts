import type { AgentIdentity, IdentityProvider } from '../protocol/identity.js';
import type { Message, ProposalPayload, VotePayload } from '../protocol/message.js';
import type { QuorumRule } from '../protocol/consensus.js';
import { TwoThirdsQuorum } from '../protocol/consensus.js';
import type { Agent, ConsensusGate, LogStore, MessageBus, SwarmContext, SwarmOutcome } from './ports.js';

export type { SwarmOutcome } from './ports.js';

export interface RunSwarmOptions {
  agents: Agent[];
  identityProvider: IdentityProvider;
  logStore: LogStore;
  consensusGate: ConsensusGate;
  messageBus: MessageBus;
  task: unknown;
  quorum?: QuorumRule;
  maxEpochs?: number;
  now?: () => number;
  mode?: 'task' | 'greet';
  /** If true, skip the leader election + greet phase and use whatever leader the consensusGate already has. Used for subsequent runs in a session where a leader is already established. */
  skipElection?: boolean;
}

export async function runSwarm(opts: RunSwarmOptions): Promise<SwarmOutcome> {
  const {
    agents,
    identityProvider,
    logStore,
    consensusGate,
    messageBus,
    task,
    quorum = TwoThirdsQuorum,
    maxEpochs = 5,
    now = () => Date.now(),
    mode = 'task',
    skipElection = false,
  } = opts;

  if (agents.length < 2) throw new Error('runSwarm requires at least 2 agents');

  const identities = await identityProvider.list();
  const idById = new Map(identities.map((i) => [i.id, i]));
  const agentById = new Map(agents.map((a) => [a.id, a]));

  let epoch = 0;
  const history: Message[] = [];
  let nonce = 0;

  const publish = async (msg: Message): Promise<void> => {
    history.push(msg);
    await logStore.append(msg);
    messageBus.publish(msg);
  };

  const publishLeaderSummary = async (
    currentEpoch: number,
    outcome: SwarmOutcome
  ): Promise<void> => {
    try {
      const leaderId = await consensusGate.currentLeader();
      const leaderAgent = agentById.get(leaderId);
      if (!leaderAgent?.summarize) return;
      const summaryCtx: SwarmContext = {
        epoch: currentEpoch,
        leader: leaderId,
        followers: identities.filter((i) => i.id !== leaderId),
        history: [...history],
        task,
      };
      const summary = await leaderAgent.summarize(summaryCtx, outcome);
      await publish({
        agent_id: leaderId,
        timestamp: now(),
        epoch: currentEpoch,
        nonce: nonce++,
        message_type: 'CHAT',
        payload: { text: summary.text },
      });
    } catch (err) {
      console.warn('leader.summarize failed:', err);
    }
  };

  // ── Leader Election Phase ──────────────────────────────────────────────────
  // If at least 2 agents implement nominate(), run an election before any proposals.
  // Skipped when skipElection is set — reuse the leader already on the consensusGate.
  const nominators = agents.filter((a) => a.nominate);
  if (skipElection && nominators.length >= 2) {
    // Persisted-leader path: no nomination, no greet (unless this is greet mode).
    const persistedLeaderId = await consensusGate.currentLeader();
    if (mode === 'greet') {
      const electedAgent = agentById.get(persistedLeaderId);
      if (electedAgent?.greet) {
        const greetCtx: SwarmContext = {
          epoch: 0,
          leader: persistedLeaderId,
          followers: identities.filter((i) => i.id !== persistedLeaderId),
          history: [],
          task,
        };
        const greeting = await electedAgent.greet(greetCtx);
        await publish({
          agent_id: persistedLeaderId,
          timestamp: now(),
          epoch: 0,
          nonce: nonce++,
          message_type: 'CHAT',
          payload: { text: greeting.text },
        });
      }
      await logStore.seal(0);
      return { status: 'greeted', epoch: 0, leader: persistedLeaderId };
    }
    // task mode + skipElection: jump straight to proposal loop
    epoch = 1;
  } else if (nominators.length >= 2) {
    const electionCtx: SwarmContext = {
      epoch: 0,
      leader: await consensusGate.currentLeader(),
      followers: identities,
      history: [],
      task,
    };

    const votes = new Map<string, number>();

    const validIds = new Set(agents.map((a) => a.id));

    for (const agent of agents) {
      if (!agent.nominate) continue;
      const nom = await agent.nominate(electionCtx);

      // Normalize nominee: LLM sometimes returns display name instead of agent ID
      let nominee = nom.nominee;
      if (!validIds.has(nominee)) {
        const lower = nominee.toLowerCase().replace(/\s+/g, '');
        const match = agents.find((a) =>
          a.id.toLowerCase() === lower ||
          lower.includes(a.id.toLowerCase()) ||
          a.id.toLowerCase().includes(lower)
        );
        nominee = match?.id ?? agent.id; // fallback to self-nomination
      }

      const nomMsg: Message = {
        agent_id: agent.id,
        timestamp: now(),
        epoch: 0,
        nonce: nonce++,
        message_type: 'NOMINATION',
        payload: { nominee, reasoning: nom.reasoning },
      };
      await publish(nomMsg);
      votes.set(nominee, (votes.get(nominee) ?? 0) + 1);
    }

    // Agent with most nominations wins; tie-breaks by agent list order
    let winner = agents[0]!.id;
    let maxVotes = 0;
    for (const agent of agents) {
      const v = votes.get(agent.id) ?? 0;
      if (v > maxVotes) { maxVotes = v; winner = agent.id; }
    }

    if (consensusGate.setLeader) {
      await consensusGate.setLeader(winner);
    }

    // Elected leader greets the user before any proposals
    const electedAgent = agentById.get(winner);
    if (electedAgent?.greet) {
      const greeting = await electedAgent.greet({ ...electionCtx, leader: winner });
      await publish({
        agent_id: winner,
        timestamp: now(),
        epoch: 0,
        nonce: nonce++,
        message_type: 'CHAT',
        payload: { text: greeting.text },
      });
    }

    await logStore.seal(0);
    epoch = 1; // election was epoch 0; main loop starts at epoch 1

    // Greet-only mode: election + leader greet, then exit (no proposal phase).
    if (mode === 'greet') {
      return { status: 'greeted', epoch: 0, leader: winner };
    }
  }
  // ──────────────────────────────────────────────────────────────────────────

  while (epoch < maxEpochs) {
    const leaderId = await consensusGate.currentLeader();
    const leader = agentById.get(leaderId);
    if (!leader || !leader.propose) {
      return { status: 'halted', epoch, reason: 'no_leader_can_propose' };
    }

    const followers: AgentIdentity[] = identities.filter((i) => i.id !== leaderId);
    const ctx: SwarmContext = { epoch, leader: leaderId, followers, history: [...history], task };

    const proposed = await leader.propose(ctx);
    const proposalMsg: Message = {
      agent_id: leaderId,
      timestamp: now(),
      epoch,
      nonce: nonce++,
      message_type: 'PROPOSAL',
      payload: proposed.payload,
    };
    await publish(proposalMsg);

    const sealedBefore = await logStore.seal(epoch);
    await consensusGate.propose(proposed.payload.actionHash, sealedBefore.ref);
    if (consensusGate.sealLogBatch) {
      await consensusGate.sealLogBatch(epoch, sealedBefore.ref);
    }

    const followerAgents = agents.filter((a) => a.id !== leaderId);
    const voteResults = await Promise.all(
      followerAgents.map(async (a) => {
        const r = await a.vote(proposalMsg as Message & { payload: ProposalPayload }, ctx);
        const voteMsg: Message = {
          agent_id: a.id,
          timestamp: now(),
          epoch,
          nonce: nonce++,
          message_type: 'VOTE',
          payload: r.payload,
        };
        await publish(voteMsg);
        return { agent: a, vote: r.payload as VotePayload };
      })
    );

    const approvals = voteResults.filter((v) => v.vote.decision === 'APPROVE');
    const rejections = voteResults.filter((v) => v.vote.decision === 'REJECT');

    const required = quorum.minApprovals(followerAgents.length);

    if (approvals.length >= required) {
      for (const a of approvals) {
        await consensusGate.voteApprove(proposed.payload.actionHash, a.agent.id);
      }
      await consensusGate.execute(proposed.payload.actionHash);
      const sealedAfter = await logStore.seal(epoch);
      if (consensusGate.sealLogBatch) {
        await consensusGate.sealLogBatch(epoch, sealedAfter.ref);
      }
      const executedOutcome: SwarmOutcome = {
        status: 'executed',
        epoch,
        actionHash: proposed.payload.actionHash,
        logRef: sealedAfter.ref,
      };
      await publishLeaderSummary(epoch, executedOutcome);
      return executedOutcome;
    }

    const electionRequired = quorum.minApprovals(followerAgents.length);
    if (rejections.length >= electionRequired) {
      const reasonRef = sealedBefore.ref;
      for (const r of rejections) {
        const electionMsg: Message = {
          agent_id: r.agent.id,
          timestamp: now(),
          epoch,
          nonce: nonce++,
          message_type: 'VOTE_NEW_LEADER',
          payload: { proposalId: r.vote.proposalId, decision: 'REJECT', reason: r.vote.reason },
        };
        await publish(electionMsg);
        await consensusGate.triggerLeaderElection(reasonRef, r.agent.id);
      }
      const _newLeader = await consensusGate.currentLeader();
      epoch += 1;
      const sealedDepose = await logStore.seal(epoch);
      if (consensusGate.sealLogBatch) {
        await consensusGate.sealLogBatch(epoch, sealedDepose.ref);
      }
      void idById;
      continue;
    }

    epoch += 1;
  }

  const haltedOutcome: SwarmOutcome = { status: 'halted', epoch, reason: 'max_epochs_exhausted' };
  await publishLeaderSummary(epoch, haltedOutcome);
  return haltedOutcome;
}
