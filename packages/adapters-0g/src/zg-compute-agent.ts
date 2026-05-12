import type { Agent, Message, ProposalPayload, SwarmContext, VotePayload } from '@agentraft/core';

export interface ZgComputeBrokerLike {
  inference: {
    listService(): Promise<Array<{ provider: string; serviceType: string; model?: string }>>;
    getServiceMetadata(provider: string): Promise<{ endpoint: string; model: string }>;
    getRequestHeaders(provider: string): Promise<Record<string, string>>;
    processResponse(provider: string, chatID: string): Promise<boolean>;
  };
}

export interface ZgComputeAgentOptions {
  id: string;
  role: 'leader' | 'follower';
  broker: ZgComputeBrokerLike;
  provider: string;
  systemPrompt: string;
  decide: (proposal: Message & { payload: ProposalPayload }, ctx: SwarmContext) => string;
}

export class ZgComputeAgent implements Agent {
  readonly id: string;
  readonly role: 'leader' | 'follower';
  private readonly broker: ZgComputeBrokerLike;
  private readonly provider: string;
  private readonly systemPrompt: string;
  private readonly decide: ZgComputeAgentOptions['decide'];

  constructor(opts: ZgComputeAgentOptions) {
    this.id = opts.id;
    this.role = opts.role;
    this.broker = opts.broker;
    this.provider = opts.provider;
    this.systemPrompt = opts.systemPrompt;
    this.decide = opts.decide;
  }

  async vote(
    proposal: Message & { payload: ProposalPayload },
    ctx: SwarmContext
  ): Promise<{ payload: VotePayload; chat?: string }> {
    const userPrompt = this.decide(proposal, ctx);
    const { endpoint, model } = await this.broker.inference.getServiceMetadata(this.provider);
    const headers = await this.broker.inference.getRequestHeaders(this.provider);

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    if (!res.ok) {
      return {
        payload: {
          proposalId: proposal.payload.proposalId,
          decision: 'REJECT',
          reason: `0G Compute call failed: ${res.status}`,
          evidence: { status: res.status, teeValid: false },
        },
      };
    }

    const data = (await res.json()) as { id?: string; choices?: Array<{ message?: { content?: string } }> };
    const chatID = res.headers.get('ZG-Res-Key') ?? data.id ?? '';
    const teeValid = chatID
      ? await this.broker.inference.processResponse(this.provider, chatID).catch(() => false)
      : false;

    const content = data.choices?.[0]?.message?.content ?? '';
    const decision: VotePayload['decision'] =
      teeValid && /APPROVE/i.test(content) ? 'APPROVE' : 'REJECT';

    const reason =
      content.trim().slice(0, 280) ||
      (teeValid ? 'no rationale returned' : 'TEE signature did not validate');

    return {
      payload: {
        proposalId: proposal.payload.proposalId,
        decision,
        reason,
        evidence: { teeValid, chatID, model },
      },
    };
  }
}
