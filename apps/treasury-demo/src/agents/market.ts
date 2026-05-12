import type { Agent, Message, NominationResult, ProposalPayload, SwarmContext, SwarmOutcome, VotePayload } from '@agentraft/core';
import { createHash } from 'node:crypto';
import { callTool, callText } from './llm';
import { NOMINATE_TOOL, buildAgentList } from './nomination';
import { buildSummaryUser } from './leader';

export interface MarketAgentOptions {
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
  description: 'Submit your research-informed vote on the proposal.',
  inputSchema: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['APPROVE', 'REJECT'] },
      reason: {
        type: 'string',
        description: 'One-sentence rationale grounded in data, context, or domain knowledge.',
      },
    },
    required: ['decision', 'reason'],
  },
};

const PROPOSE_TOOL = {
  name: 'submit_proposal',
  description: 'You have been promoted to lead. Submit a well-researched recommendation grounded in context.',
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

export class MarketAgent implements Agent {
  readonly id: string;
  readonly role = 'follower' as const;
  private readonly task: string;
  private readonly model?: string;
  private proposalCounter = 0;

  constructor(opts: MarketAgentOptions) {
    this.id = opts.id;
    this.task = opts.task;
    if (opts.model) this.model = opts.model;
  }

  async nominate(ctx: SwarmContext): Promise<NominationResult> {
    const task = (ctx.task as any)?.text ?? String(ctx.task);
    const system = `You are the Analyst in a multi-agent decision swarm — you provide research, data-driven context, and domain knowledge for any topic. A Raft-style leader election is starting. Nominate the most suitable agent to lead. You MUST return the exact agent ID string.`;
    const user = `Task: "${task}"\n\nAvailable agents:\n${buildAgentList(ctx)}\n\nNominate a leader by their exact ID. Use the nominate_leader tool.`;
    const out = await callTool<NominationResult>({ system, user, tool: NOMINATE_TOOL, ...(this.model ? { model: this.model } : {}) });
    return { nominee: out.nominee, reasoning: out.reasoning };
  }

  async greet(ctx: SwarmContext): Promise<{ text: string }> {
    const task = (ctx.task as any)?.text ?? String(ctx.task);
    const kind = (ctx.task as any)?.kind;
    const system = kind === 'greet'
      ? `You are the Analyst, just elected to lead a multi-agent decision swarm. The user has just greeted you — no task yet. Greet them back, introduce yourself briefly as the Analyst, and invite them to share the task they want the swarm to work on. 2 sentences max.`
      : `You are the Analyst, just elected to lead a multi-agent decision swarm. Greet the user, acknowledge their task, and briefly state your research-driven approach. Be direct and professional. 2 sentences max.`;
    const text = await callText({ system, user: `User input: "${task}"`, ...(this.model ? { model: this.model } : {}) });
    return { text };
  }

  async vote(
    proposal: Message & { payload: ProposalPayload }
  ): Promise<{ payload: VotePayload }> {
    const system = [
      'You are the Analyst in a multi-agent decision swarm. Evaluate this proposal from a research and context perspective.',
      'Is the proposal well-informed? Does it reflect relevant facts, data, or domain knowledge?',
      'REJECT if it relies on faulty assumptions or ignores critical context. APPROVE if it is grounded and well-reasoned.',
    ].join(' ');

    const user = `Original user task: """${this.task}"""\n\nProposal:\n${JSON.stringify(proposal.payload, null, 2)}\n\nVote from a research perspective.`;

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
      'You are the Analyst-turned-leader of a multi-agent decision swarm — now the elected voice that speaks to the user.',
      'A deliberation cycle just concluded. Write a direct, user-facing reply (3–4 sentences) addressed to the user as "you".',
      'Synthesize with a research-driven, evidence-grounded tone — reference what the data or context indicates. End with a clear answer.',
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
      'You were promoted from Analyst to lead the swarm after the previous leader was deposed.',
      'Submit a well-researched, evidence-grounded solution that addresses the user task.',
    ].join(' ');
    const user = `Original user task: """${this.task}"""\n\nSwarm history:\n${recent}\n\nPropose a research-informed solution now.`;
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
