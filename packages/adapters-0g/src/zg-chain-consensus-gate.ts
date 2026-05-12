import { Contract, type Signer, type ContractRunner } from 'ethers';
import type {
  ChainEvent,
  ChainEventName,
  ConsensusGate,
} from '@agentraft/core';
import { SWARM_CONSENSUS_ABI } from './abi.js';

export interface ZgChainConsensusGateOptions {
  contractAddress: string;
  runner: ContractRunner;
  signersById: Map<string, Signer>;
}

export class ZgChainConsensusGate implements ConsensusGate {
  private readonly contract: Contract;
  private readonly signersById: Map<string, Signer>;

  constructor(opts: ZgChainConsensusGateOptions) {
    this.contract = new Contract(opts.contractAddress, [...SWARM_CONSENSUS_ABI], opts.runner);
    this.signersById = opts.signersById;
  }

  private connect(voter: string): Contract {
    const s = this.signersById.get(voter);
    if (!s) throw new Error(`no signer registered for agent id ${voter}`);
    return this.contract.connect(s) as Contract;
  }

  async propose(actionHash: string, logRef: string): Promise<void> {
    const leader = await this.currentLeader();
    const c = this.connect(leader);
    const tx = await c.proposeAction(actionHash, logRef);
    await tx.wait();
  }

  async voteApprove(actionHash: string, voter: string): Promise<void> {
    const c = this.connect(voter);
    const tx = await c.voteApprove(actionHash);
    await tx.wait();
  }

  async triggerLeaderElection(reasonRef: string, voter: string): Promise<void> {
    const c = this.connect(voter);
    const tx = await c.triggerLeaderElection(reasonRef);
    await tx.wait();
  }

  async execute(actionHash: string): Promise<void> {
    const leader = await this.currentLeader();
    const c = this.connect(leader);
    const tx = await c.executeAction(actionHash);
    await tx.wait();
  }

  async sealLogBatch(epoch: number, ref: string): Promise<void> {
    const leader = await this.currentLeader();
    const c = this.connect(leader);
    const tx = await c.sealLogBatch(epoch, ref);
    await tx.wait();
  }

  on(event: ChainEventName, cb: (e: ChainEvent) => void): () => void {
    const handler = (...args: unknown[]) => {
      const log = args[args.length - 1] as { args?: readonly unknown[]; transactionHash?: string; blockNumber?: number };
      const evt: ChainEvent = {
        name: event,
        data: { args: log.args ?? [] },
        ...(log.transactionHash !== undefined && { txHash: log.transactionHash }),
        ...(log.blockNumber !== undefined && { blockNumber: log.blockNumber }),
      };
      cb(evt);
    };
    void this.contract.on(event, handler);
    return () => {
      void this.contract.off(event, handler);
    };
  }

  async currentLeader(): Promise<string> {
    return (await this.contract.currentLeader()) as string;
  }

  async rotateLeader(): Promise<string> {
    return await this.currentLeader();
  }
}
