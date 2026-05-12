import type { Agent, Message, ProposalPayload, SwarmContext, SwarmOutcome, VotePayload } from '@agentraft/core';
import { ZgComputeAgent, type ZgComputeBrokerLike } from '@agentraft/adapters-0g';
import { ComplianceAgent } from './compliance';

export interface ZgComplianceAgentOptions {
  id: string;
  task: string;
  broker: ZgComputeBrokerLike;
  provider: string;
  model?: string;
}

export class ZgComplianceAgent implements Agent {
  readonly id: string;
  readonly role = 'follower' as const;
  private readonly zgAgent: ZgComputeAgent;
  private readonly fallback: ComplianceAgent;

  constructor(opts: ZgComplianceAgentOptions) {
    this.id = opts.id;
    this.fallback = new ComplianceAgent({ id: opts.id, task: opts.task, model: opts.model });
    this.zgAgent = new ZgComputeAgent({
      id: opts.id,
      role: 'follower',
      broker: opts.broker,
      provider: opts.provider,
      systemPrompt: [
        'You are the Strategist in a multi-agent decision swarm. Evaluate ONLY feasibility and strategic fit.',
        'REJECT if the proposal is impractical, misaligned with the task, or ignores critical tradeoffs.',
        'APPROVE if the approach is actionable and well-aligned. Reply with APPROVE or REJECT followed by one sentence.',
      ].join(' '),
      decide: (proposal, _ctx) =>
        `Proposal to evaluate for strategic feasibility:\n${JSON.stringify(proposal.payload, null, 2)}\n\nIs it pragmatic and aligned? Reply APPROVE or REJECT with reasoning.`,
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
