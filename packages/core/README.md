# @agentraft/core

Levels 1 and 2 of AgentRaft — the protocol schema and the orchestration engine.
**No Web3 dependencies.** This package depends only on `zod`.

## What it gives you

- A wire-format `Message` schema (Level 1).
- Four pluggable interfaces (`Agent`, `LogStore`, `ConsensusGate`, `MessageBus`) that together describe a fault-tolerant agent swarm.
- A `runSwarm()` state machine that drives those interfaces through a Raft-like consensus loop: propose → audit → tally → commit, or depose-and-rotate on dissent.
- In-memory implementations of every port so you can run a complete swarm without a chain or a database.

If you have your own LLMs, your own framework (LangGraph, AutoGen, raw OpenAI calls), and your own storage/consensus backend, you implement the interfaces — `runSwarm` does the rest.

## Bring-your-own-agent example

```ts
import {
  runSwarm,
  InMemoryLogStore,
  InMemoryConsensusGate,
  InMemoryMessageBus,
  InMemoryIdentityProvider,
  type Agent,
} from '@agentraft/core';

const leader: Agent = {
  id: 'leader',
  role: 'leader',
  async propose() {
    return {
      payload: {
        proposalId: 'p1',
        actionHash: '0xabc',
        action: { kind: 'ship_it' },
      },
    };
  },
  async vote() { throw new Error('leader does not vote'); },
};

const reviewer = (id: string): Agent => ({
  id, role: 'follower',
  async vote(p) {
    return { payload: { proposalId: p.payload.proposalId, decision: 'APPROVE' } };
  },
});

const agents = [leader, reviewer('r1'), reviewer('r2')];

const outcome = await runSwarm({
  agents,
  identityProvider: new InMemoryIdentityProvider(
    agents.map(a => ({ id: a.id, role: a.role }))
  ),
  logStore: new InMemoryLogStore(),
  consensusGate: new InMemoryConsensusGate({
    agents: agents.map(a => a.id),
    initialLeader: 'leader',
  }),
  messageBus: new InMemoryMessageBus(),
  task: 'ship release v1',
});

console.log(outcome); // { status: 'executed', epoch: 0, actionHash: '0xabc', logRef: '0x...' }
```

That's the whole library — no chain, no LLM keys, no Web3 install.

## Wiring AgentRaft to a real backend

To run AgentRaft on-chain, swap the in-memory ports for real adapters. The
[`@agentraft/adapters-somnia`](../adapters-somnia) package implements `LogStore`,
`ConsensusGate`, and `IdentityProvider` against Somnia's Shannon testnet — but
core has no idea any of that exists.
