import type { Agent, Message, ProposalPayload, SwarmContext, SwarmOutcome, VotePayload } from '@agentraft/core';
import { ZgComputeAgent, type ZgComputeBrokerLike } from '@agentraft/adapters-0g';
import { RiskAgent } from './risk';

export interface ZgRiskAgentOptions {
  id: string;
  task: string;
  broker: ZgComputeBrokerLike;
  provider: string;
  model?: string;
}

export class ZgRiskAgent implements Agent {
  readonly id: string;
  readonly role = 'follower' as const;
  private readonly zgAgent: ZgComputeAgent;
  private readonly fallback: RiskAgent;

  constructor(opts: ZgRiskAgentOptions) {
    this.id = opts.id;
    this.fallback = new RiskAgent({ id: opts.id, task: opts.task, model: opts.model });
    this.zgAgent = new ZgComputeAgent({
      id: opts.id,
      role: 'follower',
      broker: opts.broker,
      provider: opts.provider,
      systemPrompt: [
        'You are the Critic in a multi-agent decision swarm. Find flaws others miss.',
        'REJECT if the proposal is incomplete, risky, misaligned with the task, or makes unjustified assumptions.',
        'APPROVE only if you find it genuinely sound after scrutiny.',
        'Reply with APPROVE or REJECT followed by a one-sentence reason.',
      ].join(' '),
      decide: (proposal, _ctx) =>
        `Proposal to critique:\n${JSON.stringify(proposal.payload, null, 2)}\n\nFind flaws. Reply APPROVE or REJECT with specific reasoning.`,
    });
  }

  async vote(
    proposal: Message & { payload: ProposalPayload },
    ctx: SwarmContext
  ): Promise<{ payload: VotePayload }> {
    return this.zgAgent.vote(proposal, ctx);
  }

  async propose(ctx: SwarmContext) {
    return this.fallback.propose(ctx);
  }

  async summarize(ctx: SwarmContext, outcome: SwarmOutcome): Promise<{ text: string }> {
    return this.fallback.summarize(ctx, outcome);
  }
}
