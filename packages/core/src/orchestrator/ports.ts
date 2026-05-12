import type { Message, ProposalPayload, VotePayload } from '../protocol/message.js';
import type { AgentIdentity } from '../protocol/identity.js';

export type SwarmOutcome =
  | { status: 'executed'; epoch: number; actionHash: string; logRef: string }
  | { status: 'halted'; epoch: number; reason: 'max_epochs_exhausted' | 'no_leader_can_propose' }
  | { status: 'greeted'; epoch: number; leader: string };

export interface SwarmContext {
  epoch: number;
  leader: string;
  followers: AgentIdentity[];
  history: Message[];
  task: unknown;
}

export type ChainEventName =
  | 'Proposed'
  | 'Voted'
  | 'LeaderDeposed'
  | 'Executed'
  | 'LogBatchSealed';

export interface ChainEvent {
  name: ChainEventName;
  data: Record<string, unknown>;
  txHash?: string;
  blockNumber?: number;
}

export interface NominationResult {
  nominee: string;
  reasoning: string;
}

export interface Agent {
  id: string;
  role: 'leader' | 'follower';
  nominate?(ctx: SwarmContext): Promise<NominationResult>;
  greet?(ctx: SwarmContext): Promise<{ text: string }>;
  propose?(ctx: SwarmContext): Promise<{ payload: ProposalPayload; chat?: string }>;
  summarize?(ctx: SwarmContext, outcome: SwarmOutcome): Promise<{ text: string }>;
  vote(
    proposal: Message & { payload: ProposalPayload },
    ctx: SwarmContext
  ): Promise<{ payload: VotePayload; chat?: string }>;
}

export interface LogStore {
  append(msg: Message): Promise<void>;
  seal(epoch: number): Promise<{ ref: string }>;
  read(ref: string): Promise<Message[]>;
}

export interface ConsensusGate {
  propose(actionHash: string, logRef: string): Promise<void>;
  voteApprove(actionHash: string, voter: string): Promise<void>;
  triggerLeaderElection(reasonRef: string, voter: string): Promise<void>;
  execute(actionHash: string): Promise<void>;
  sealLogBatch?(epoch: number, ref: string): Promise<void>;
  setLeader?(id: string): Promise<void>;
  on(event: ChainEventName, cb: (e: ChainEvent) => void): () => void;
  currentLeader(): Promise<string>;
  rotateLeader(): Promise<string>;
}

export type Unsubscribe = () => void;

export interface MessageBus {
  publish(msg: Message): void;
  subscribe(cb: (msg: Message) => void): Unsubscribe;
}
