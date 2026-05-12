# @agentraft/adapters-0g

0G adapters for the AgentRaft protocol. Drop-in implementations of the
[`@agentraft/core`](../core) port interfaces against 0G Chain, 0G Storage, and
0G Compute.

| Adapter | Implements | What it talks to |
|---------|-----------|------------------|
| `ZgChainConsensusGate` | `ConsensusGate` | `SwarmConsensus.sol` over ethers v6 |
| `ZgChainIdentityProvider` | `IdentityProvider` | `AgentRegistry.sol` |
| `ZgStorageLogStore` | `LogStore` | 0G Storage (`Indexer` + `MemData`) |
| `ZgComputeAgent` | `Agent` (helper) | 0G Compute via `@0glabs/0g-serving-broker` |

The Solidity contracts live in `contracts/` and are deployed via Hardhat. See the
[root README](../../README.md) for the full deploy walk-through.

## Wiring example

```ts
import { JsonRpcProvider, Wallet } from 'ethers';
import { runSwarm } from '@agentraft/core';
import {
  ZgChainConsensusGate,
  ZgChainIdentityProvider,
  ZgStorageLogStore,
  makeZgUploader,
} from '@agentraft/adapters-0g';

const provider = new JsonRpcProvider(process.env.OG_TESTNET_RPC);
const leaderSigner = new Wallet(process.env.LEADER_PK!, provider);
const riskSigner = new Wallet(process.env.RISK_PK!, provider);
const complianceSigner = new Wallet(process.env.COMPLIANCE_PK!, provider);

const consensusGate = new ZgChainConsensusGate({
  contractAddress: process.env.SWARM_CONSENSUS_ADDRESS!,
  runner: provider,
  signersById: new Map([
    [leaderSigner.address, leaderSigner],
    [riskSigner.address, riskSigner],
    [complianceSigner.address, complianceSigner],
  ]),
});

const identityProvider = new ZgChainIdentityProvider({
  registryAddress: process.env.AGENT_REGISTRY_ADDRESS!,
  runner: provider,
});

const uploader = await makeZgUploader({
  indexerRpc: process.env.OG_INDEXER_RPC!,
  evmRpc: process.env.OG_TESTNET_RPC!,
  signer: leaderSigner,
});
const logStore = new ZgStorageLogStore({
  indexerRpc: process.env.OG_INDEXER_RPC!,
  evmRpc: process.env.OG_TESTNET_RPC!,
  signer: leaderSigner,
  uploader,
});

await runSwarm({
  agents: [/* your Agent[] */],
  identityProvider,
  logStore,
  consensusGate,
  messageBus: /* in-memory or your own */,
  task: { /* ... */ },
});
```

## Contract addresses

After running `deploy:testnet` or `deploy:mainnet`, the addresses are written to
`deployments.<chainId>.json` in this package's directory. The demo CLI reads
this file automatically when run with `--network testnet|mainnet`.
