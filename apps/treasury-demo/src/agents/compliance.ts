import type { Agent, Message, NominationResult, ProposalPayload, SwarmContext, SwarmOutcome, VotePayload } from '@agentraft/core';
import { createHash } from 'node:crypto';
import { callTool, callText } from './llm';
import { NOMINATE_TOOL, buildAgentList } from './nomination';
import { buildSummaryUser } from './leader';

export interface ComplianceAgentOptions {
  id: string;
  task: string;
  model?: string;
}

interface VoteToolInput {
  decision: 'APPROVE' | 'REJECT';
  reason: string;
}

interface ProposeToolInput {
  summary: string;
  details: string;
  confidence: number;
}

const VOTE_TOOL = {
  name: 'submit_vote',
  description: 'Submit your strategic feasibility vote.',
  inputSchema: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['APPROVE', 'REJECT'] },
      reason: {
        type: 'string',
        description: 'One-sentence rationale focused on feasibility, tradeoffs, or strategic fit.',
      },
    },
    required: ['decision', 'reason'],
  },
};

const PROPOSE_TOOL = {
  name: 'submit_proposal',
  description: 'You have been promoted to lead. Submit a more pragmatic and feasible recommendation.',
  inputSchema: {
    type: 'object',
    properties: {
      summary: { type: 'string', description: 'One-line action item — the core recommendation.' },
      details: { type: 'string', description: 'Explanation, supporting reasoning, and key caveats.' },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        description: 'Your 0–1 confidence in this recommendation.',
      },
    },
    required: ['summary', 'details', 'confidence'],
  },
};

export class ComplianceAgent implements Agent {
  readonly id: string;
  readonly role = 'follower' as const;
  private readonly task: string;
  private readonly model?: string;
  private proposalCounter = 0;

  constructor(opts: ComplianceAgentOptions) {
    this.id = opts.id;
    this.task = opts.task;
    if (opts.model) this.model = opts.model;
  }

  async nominate(ctx: SwarmContext): Promise<NominationResult> {
    const task = (ctx.task as any)?.text ?? String(ctx.task);
    const system = `You are the Strategist in a multi-agent decision swarm — you evaluate feasibility, tradeoffs, and long-term fit of any proposal. A Raft-style leader election is starting. Nominate the most suitable agent to lead. You MUST return the exact agent ID string.`;
    const user = `Task: "${task}"\n\nAvailable agents:\n${buildAgentList(ctx)}\n\nNominate a leader by their exact ID. Use the nominate_leader tool.`;
    const out = await callTool<NominationResult>({ system, user, tool: NOMINATE_TOOL, ...(this.model ? { model: this.model } : {}) });
    return { nominee: out.nominee, reasoning: out.reasoning };
  }

  async greet(ctx: SwarmContext): Promise<{ text: string }> {
    const task = (ctx.task as any)?.text ?? String(ctx.task);
    const kind = (ctx.task as any)?.kind;
    const system = kind === 'greet'
      ? `You are the Strategist, just elected to lead a multi-agent decision swarm. The user has just greeted you — no task yet. Greet them back, introduce yourself briefly as the Strategist, and invite them to share the task they want the swarm to work on. 2 sentences max.`
      : `You are the Strategist, just elected to lead a multi-agent decision swarm. Greet the user, acknowledge their task, and briefly state your strategic approach. Be direct and professional. 2 sentences max.`;
    const text = await callText({ system, user: `User input: "${task}"`, ...(this.model ? { model: this.model } : {}) });
    return { text };
  }

  async vote(
    proposal: Message & { payload: ProposalPayload }
  ): Promise<{ payload: VotePayload }> {
    const system = [
      'You are the Strategist in a multi-agent decision swarm. Evaluate ONLY feasibility and strategic fit.',
      'REJECT if the proposal is impractical, misaligned with the stated task, or ignores critical tradeoffs.',
      'APPROVE if the approach is actionable and well-aligned.',
    ].join(' ');

    const user = `Original user task: """${this.task}"""\n\nProposal:\n${JSON.stringify(proposal.payload, null, 2)}\n\nVote on strategic feasibility.`;

    const opts = this.model ? { system, user, tool: VOTE_TOOL, model: this.model } : { system, user, tool: VOTE_TOOL };
    const out = await callTool<VoteToolInput>(opts);
    return {
      payload: {
        proposalId: proposal.payload.proposalId,
        decision: out.decision,
        reason: out.reason,
      },
    };
  }

  async summarize(ctx: SwarmContext, outcome: SwarmOutcome): Promise<{ text: string }> {
    const system = [
      'You are the Strategist-turned-leader of a multi-agent decision swarm — now the elected voice that speaks to the user.',
      'A deliberation cycle just concluded. Write a direct, user-facing reply (3–4 sentences) addressed to the user as "you".',
      'Synthesize with a strategic, feasibility-focused tone — name the tradeoffs and the final call. End with a clear answer or next step.',
      'Do NOT speak in third-person — speak as the leader presenting the team conclusion.',
    ].join(' ');
    const user = buildSummaryUser(this.task, ctx, outcome);
    const text = await callText({ system, user, ...(this.model ? { model: this.model } : {}) });
    return { text };
  }

  async propose(ctx: SwarmContext): Promise<{ payload: ProposalPayload }> {
    this.proposalCounter += 1;
    const recent = ctx.history.slice(-8)
      .map((m) => `- ${m.message_type} from ${m.agent_id}: ${truncate(JSON.stringify(m.payload), 200)}`)
      .join('\n');
    const system = [
      'You were promoted from Strategist to lead the swarm after the previous leader was deposed.',
      'Submit a more pragmatic and feasible alternative that still serves the user task. Focus on what is actually achievable.',
    ].join(' ');
    const user = `Original user task: """${this.task}"""\n\nSwarm history:\n${recent}\n\nPropose a pragmatic alternative now.`;
    const opts = this.model ? { system, user, tool: PROPOSE_TOOL, model: this.model } : { system, user, tool: PROPOSE_TOOL };
    const out = await callTool<ProposeToolInput>(opts);
    const action = {
      kind: 'recommendation' as const,
      summary: out.summary,
      details: out.details,
      confidence: out.confidence,
    };
    const proposalId = `task-${this.id}-${this.proposalCounter}`;
    const actionHash = '0x' + createHash('sha256').update(JSON.stringify(action)).digest('hex');
    return {
      payload: { proposalId, actionHash, action, rationale: out.details },
    };
  }
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}
