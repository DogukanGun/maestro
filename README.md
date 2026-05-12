# AgentRaft

**RAID for AI agents.** A fault-tolerant multi-agent protocol that applies Raft-like
consensus to LLM swarms: a leader proposes, followers vote, and a quorum can depose
a leader whose proposal is unsafe. AgentRaft makes Byzantine faults — the silent
hallucinations that propagate unchecked through today's multi-agent systems — both
detectable and recoverable, with the entire decision trail anchored to verifiable
storage.

The protocol is deliberately split into two layers — **a framework-agnostic core
library**, and **drop-in adapters** for backends like 0G — so anyone can run
AgentRaft on their own agents without taking on a Web3 dependency.

This repo is the [0G APAC Hackathon](https://www.hackquest.io/hackathons/0G-APAC-Hackathon)
Track 3 submission. The hackathon scenario, "DeFi Treasury Guardian," lives in
`apps/treasury-demo` as one concrete instantiation of the protocol.

---

## The 3-Level Architecture

| Level | Concern | Lives in | Web3 deps |
|-------|---------|----------|-----------|
| **L1 — Protocol** | Message schema, identity interface, quorum rule | `packages/core/src/protocol/` | none |
| **L2 — Orchestration** | State machine, port interfaces, in-memory defaults | `packages/core/src/orchestrator/` | none |
| **L3 — Application (0G)** | Smart contracts, 0G Storage / Compute / Chain adapters, demo agents | `packages/adapters-0g/`, `apps/treasury-demo/`, `apps/web/` | yes |

The boundary is enforced at the package layer: `packages/core/package.json` declares
`zod` as its **only** runtime dependency. A CI guard (`scripts/check-core-deps.mjs`)
fails the build if anything else gets added.

```
       ┌──────────────────────────────────┐
       │           apps/                  │
       │  treasury-demo  •  web (Next.js) │
       └──────────────────────────────────┘
                    │ depends on
                    ▼
       ┌──────────────────────────────────┐
       │     @agentraft/adapters-0g       │  Solidity + 0G Storage + 0G Compute
       │   (LogStore, ConsensusGate,       │
       │    IdentityProvider, Agent helper)│
       └──────────────────────────────────┘
                    │ depends on
                    ▼
       ┌──────────────────────────────────┐
       │       @agentraft/core            │   no Web3, no LLM, no chain
       │  protocol + orchestrator + ports  │
       └──────────────────────────────────┘
```

---

## Quickstart — Bring-Your-Own-Agent (no Web3 required)

```bash
pnpm install
pnpm --filter @agentraft/core build
```

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
  id: 'leader', role: 'leader',
  async propose() {
    return { payload: { proposalId: 'p1', actionHash: '0xabc', action: { kind: 'ship_it' } } };
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
const ids = agents.map(a => ({ id: a.id, role: a.role }));

const outcome = await runSwarm({
  agents,
  identityProvider: new InMemoryIdentityProvider(ids),
  logStore: new InMemoryLogStore(),
  consensusGate: new InMemoryConsensusGate({ agents: agents.map(a => a.id), initialLeader: 'leader' }),
  messageBus: new InMemoryMessageBus(),
  task: 'ship release v1',
});

console.log(outcome); // { status: 'executed', epoch: 0, actionHash: '0xabc', logRef: '0x...' }
```

That's the whole library — no chain, no LLM keys, nothing else to install.

---

## Run the Hackathon Demo

The demo runs the **DeFi Treasury Guardian** scenario. A leader agent proposes a
poisoned 100k transfer to a low-reputation address. The risk and compliance
followers both reject and trigger a leader election. After the rotation, the new
leader proposes a compliant 5k transfer, the swarm approves, and the action
executes.

```bash
pnpm install
pnpm -r --filter './packages/*' build
pnpm --filter treasury-demo build
pnpm --filter treasury-demo swarm:built              # poisoned-leader scenario
pnpm --filter treasury-demo swarm:built -- --clean   # happy path
```

Each run drops three files into `apps/treasury-demo/runs/<timestamp>/`:
- `messages.jsonl` — the full Level-1 message stream
- `events.json` — the on-chain event log
- `outcome.json` — the final state

### Live Dashboard

```bash
pnpm --filter agentraft-web build
pnpm --filter agentraft-web start
# → http://localhost:3000
```

The dashboard polls the most recent `runs/` directory and live-renders the chat
stream, vote tally, and chain events. Run another swarm in a second terminal and
watch all three panels update.

---

## 0G Integration

| 0G Service | Where it appears | Adapter |
|-----------|------------------|---------|
| **0G Chain** | `SwarmConsensus.sol` and `AgentRegistry.sol` deployed via Hardhat | `ZgChainConsensusGate`, `ZgChainIdentityProvider` |
| **0G Storage** | Each batch of L1 messages is sealed to 0G Storage; `rootHash` is anchored on-chain | `ZgStorageLogStore` |
| **0G Compute** | The Compliance agent runs on 0G's TEE-verified inference; the TEE signature flag rides in the VOTE payload | `ZgComputeAgent` |

### Deploy the contracts

```bash
cp .env.example .env
# fill in DEPLOYER_PRIVATE_KEY (testnet faucet: https://faucet.0g.ai)
pnpm --filter @agentraft/adapters-0g hardhat:compile
pnpm --filter @agentraft/adapters-0g hardhat:test         # 7 tests, all paths
pnpm --filter @agentraft/adapters-0g deploy:testnet       # writes deployments.16602.json
pnpm --filter @agentraft/adapters-0g deploy:mainnet       # writes deployments.16661.json
```

The deploy script registers three signers as `leader`, `risk`, and `compliance`
agents (each posting `0.001 OG` stake), then deploys `SwarmConsensus` wired to
that registry. The script writes a `deployments.<chainId>.json` file so the demo
and dashboard can pick up the addresses.

---

## Project Layout

```
packages/
  core/              # @agentraft/core — L1 + L2, zero Web3 deps
  adapters-0g/       # @agentraft/adapters-0g — L3 0G adapters + Solidity contracts
apps/
  treasury-demo/     # CLI for the DeFi Treasury Guardian scenario
  web/               # Next.js dashboard
scripts/
  check-core-deps.mjs # CI guard: core may only depend on zod
```

---

## Verification

| Check | Command | Expected |
|-------|---------|----------|
| Core L1+L2 tests | `pnpm --filter @agentraft/core test` | 8 passing |
| Contract tests | `cd packages/adapters-0g && npx hardhat test` | 7 passing |
| Core dep guard | `node scripts/check-core-deps.mjs` | `packages/core deps OK` |
| End-to-end demo | `pnpm --filter treasury-demo swarm:built` | `status: executed`, epoch ≥ 1 |
| Clean-path demo | `pnpm --filter treasury-demo swarm:built -- --clean` | `status: executed`, epoch 0 |
| Dashboard | `pnpm --filter agentraft-web start && curl localhost:3000/api/run` | JSON with non-empty `events`/`messages` |

---

## What this is not (yet)

- **Crash-fault detection / heartbeats** — only Byzantine (hallucination) faults
  are demonstrated. A timed-out agent will hang the swarm.
- **Variable swarm size** — the demo is fixed at 3 agents. The library does not
  enforce a size, but the demo scenario does.
- **Slashing** — the registry tracks an `active` flag; deposed leaders are not
  financially penalized.
- **Production key management** — the demo derives all agent wallets from a
  single mnemonic in `.env`.

---

## License

MIT. Built for the 0G APAC Hackathon, May 2026.
