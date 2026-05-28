import { Contract, keccak256, toUtf8Bytes, type Signer, type ContractRunner } from 'ethers';
import type { LogStore, Message } from '@agentraft/core';
import { SWARM_CONSENSUS_ABI } from './abi.js';

export interface SomniaEventLogStoreOptions {
  contractAddress: string;
  runner: ContractRunner;
  leaderSigner: Signer;
}

/**
 * Anchors each sealed log batch on Somnia via SwarmConsensus.sealLogBatch(epoch, ref).
 * The full message body stays in local JSONL files; only the keccak256 root of the
 * batch's JSONL bytes is committed on-chain (as the LogBatchSealed event ref).
 *
 * Replay by ref is intentionally not supported — messages are content-addressed
 * by the on-chain root but not retrievable from the chain. Use the local
 * messages.jsonl for replay.
 */
export class SomniaEventLogStore implements LogStore {
  private readonly buffer: Message[] = [];
  private readonly contract: Contract;
  private readonly leaderSigner: Signer;

  constructor(opts: SomniaEventLogStoreOptions) {
    this.contract = new Contract(opts.contractAddress, [...SWARM_CONSENSUS_ABI], opts.runner);
    this.leaderSigner = opts.leaderSigner;
  }

  async append(msg: Message): Promise<void> {
    this.buffer.push(msg);
  }

  async seal(epoch: number): Promise<{ ref: string }> {
    const jsonl = this.buffer.map((m) => JSON.stringify(m)).join('\n');
    const ref = keccak256(toUtf8Bytes(jsonl));
    const c = this.contract.connect(this.leaderSigner) as Contract;
    const tx = await c.sealLogBatch(epoch, ref);
    await tx.wait();
    this.buffer.length = 0;
    return { ref };
  }

  async read(_ref: string): Promise<Message[]> {
    throw new Error('SomniaEventLogStore: read by ref not supported — replay from local messages.jsonl');
  }
}
