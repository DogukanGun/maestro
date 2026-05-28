# @agentraft/adapters-somnia

Somnia EVM adapter for AgentRaft.

Ports the four core ports onto Somnia (Shannon testnet, chainId 50312):

| Port | Implementation | What it does |
|---|---|---|
| `ConsensusGate` | `SomniaChainConsensusGate` | Wraps `SwarmConsensus.sol` — propose, vote, depose, execute all become Somnia transactions. |
| `IdentityProvider` | `SomniaChainIdentityProvider` | Wraps `AgentRegistry.sol` — agent set + stakes + role tags. |
| `LogStore` | `SomniaEventLogStore` | Anchors each sealed batch's `keccak256` root via `LogBatchSealed(epoch, ref)`. Messages stay in local JSONL. |
| `Agent` | (use any from `@agentraft/core` or your own) | LLM agents are chain-agnostic. |

## Solidity contracts

- `contracts/SwarmConsensus.sol` — propose / vote / depose / execute state machine + `LogBatchSealed` event.
- `contracts/AgentRegistry.sol` — stake-gated agent registration with role tags.

Both compile under solc `0.8.24` with `evmVersion: cancun`.

## Quickstart

```bash
# in repo root
pnpm install

# compile + run tests (local Hardhat network, no funds needed)
pnpm --filter @agentraft/adapters-somnia hardhat:compile
pnpm --filter @agentraft/adapters-somnia hardhat:test

# deploy to Somnia Shannon testnet
# 1. fund a deployer wallet via https://testnet.somnia.network/
# 2. set DEPLOYER_PRIVATE_KEY + SOMNIA_TESTNET_RPC in .env
pnpm --filter @agentraft/adapters-somnia deploy:testnet
# → writes deployments.50312.json with AgentRegistry + SwarmConsensus addresses
```

## Why on-chain consensus for agent swarms

Every propose / vote / depose is a real on-chain action on Somnia, anchored alongside the swarm's log root. A hostile agent that pushes a poisoned proposal cannot execute it without quorum, and a deposed leader is rotated out by a verifiable on-chain event — auditable to anyone running a Somnia node.

## License

MIT.
