import { EventEmitter } from 'node:events';
import type { ChainEvent, ChainEventName, ConsensusGate } from '../ports.js';

interface ProposalState {
  actionHash: string;
  logRef: string;
  approvals: Set<string>;
  electionVotes: Set<string>;
  blocked: boolean;
  executed: boolean;
}

export interface InMemoryConsensusGateOptions {
  agents: string[];
  initialLeader?: string;
}

export class InMemoryConsensusGate implements ConsensusGate {
  private readonly emitter = new EventEmitter();
  private readonly agents: string[];
  private leaderIdx: number;
  private epoch = 0;
  private active: ProposalState | null = null;

  constructor(opts: InMemoryConsensusGateOptions) {
    if (opts.agents.length === 0) throw new Error('at least one agent required');
    this.agents = [...opts.agents];
    const initial = opts.initialLeader ?? this.agents[0]!;
    const idx = this.agents.indexOf(initial);
    if (idx < 0) throw new Error(`initialLeader ${initial} not in agents`);
    this.leaderIdx = idx;
  }

  async propose(actionHash: string, logRef: string): Promise<void> {
    if (this.active && !this.active.executed && !this.active.blocked) {
      throw new Error(`proposal ${this.active.actionHash} still active`);
    }
    this.active = {
      actionHash,
      logRef,
      approvals: new Set(),
      electionVotes: new Set(),
      blocked: false,
      executed: false,
    };
    this.emit('Proposed', { actionHash, logRef, leader: this.agents[this.leaderIdx]!, epoch: this.epoch });
  }

  async voteApprove(actionHash: string, voter: string): Promise<void> {
    const p = this.requireActive(actionHash);
    p.approvals.add(voter);
    this.emit('Voted', { actionHash, voter, approvals: p.approvals.size });
  }

  async triggerLeaderElection(reasonRef: string, voter: string): Promise<void> {
    if (!this.active) throw new Error('no active proposal to depose against');
    this.active.electionVotes.add(voter);
    const followers = this.agents.length - 1;
    const required = Math.ceil((2 * followers) / 3);
    if (this.active.electionVotes.size >= required) {
      this.active.blocked = true;
      const oldLeader = this.agents[this.leaderIdx]!;
      this.leaderIdx = (this.leaderIdx + 1) % this.agents.length;
      this.epoch += 1;
      this.emit('LeaderDeposed', {
        reasonRef,
        oldLeader,
        newLeader: this.agents[this.leaderIdx]!,
        epoch: this.epoch,
      });
    }
  }

  async execute(actionHash: string): Promise<void> {
    const p = this.requireActive(actionHash);
    if (p.blocked) throw new Error(`proposal ${actionHash} is blocked`);
    p.executed = true;
    this.emit('Executed', { actionHash, approvals: p.approvals.size });
  }

  async sealLogBatch(epoch: number, ref: string): Promise<void> {
    this.emit('LogBatchSealed', { epoch, ref });
  }

  on(event: ChainEventName, cb: (e: ChainEvent) => void): () => void {
    this.emitter.on(event, cb);
    return () => this.emitter.off(event, cb);
  }

  async currentLeader(): Promise<string> {
    return this.agents[this.leaderIdx]!;
  }

  async rotateLeader(): Promise<string> {
    this.leaderIdx = (this.leaderIdx + 1) % this.agents.length;
    this.epoch += 1;
    return this.agents[this.leaderIdx]!;
  }

  async setLeader(id: string): Promise<void> {
    const idx = this.agents.indexOf(id);
    if (idx === -1) throw new Error(`setLeader: unknown agent "${id}"`);
    this.leaderIdx = idx;
  }

  private requireActive(actionHash: string): ProposalState {
    if (!this.active) throw new Error('no active proposal');
    if (this.active.actionHash !== actionHash) {
      throw new Error(`actionHash mismatch: active ${this.active.actionHash}, got ${actionHash}`);
    }
    return this.active;
  }

  private emit(name: ChainEventName, data: Record<string, unknown>): void {
    const evt: ChainEvent = { name, data };
    this.emitter.emit(name, evt);
  }
}
