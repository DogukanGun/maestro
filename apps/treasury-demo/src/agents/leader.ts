import type { Agent, Message, NominationResult, ProposalPayload, SwarmContext, SwarmOutcome, VotePayload } from '@agentraft/core';
import { createHash } from 'node:crypto';
import { callTool, callText } from './llm';
import { NOMINATE_TOOL, buildAgentList } from './nomination';

export interface LeaderAgentOptions {
  id: string;
  task: string;
  model?: string;
}

interface LeaderToolInput {
  summary: string;
  details: string;
  confidence: number;
}

interface VoteToolInput {
  decision: 'APPROVE' | 'REJECT';
  reason: string;
}

const PROPOSE_TOOL = {
  name: 'submit_proposal',
  description: 'Submit a recommendation that addresses the user task. The swarm will vote on it.',
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

const VOTE_TOOL = {
  name: 'submit_vote',
  description: 'Submit your vote on the active proposal.',
  inputSchema: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['APPROVE', 'REJECT'] },
      reason: { type: 'string', description: 'One-sentence justification.' },
    },
    required: ['decision', 'reason'],
  },
};

export class LeaderAgent implements Agent {
  readonly id: string;
  readonly role = 'leader' as const;
  private readonly task: string;
  private readonly model?: string;
  private proposalCounter = 0;

  constructor(opts: LeaderAgentOptions) {
    this.id = opts.id;
    this.task = opts.task;
    if (opts.model) this.model = opts.model;
  }

  async nominate(ctx: SwarmContext): Promise<NominationResult> {
    const task = (ctx.task as any)?.text ?? String(ctx.task);
    const system = `You are the Coordinator in a multi-agent decision swarm — you orchestrate discussion and propose solutions to any kind of task or problem. A Raft-style leader election is starting. Nominate the most suitable agent to lead. You MUST return the exact agent ID string.`;
    const user = `Task: "${task}"\n\nAvailable agents:\n${buildAgentList(ctx)}\n\nNominate a leader by their exact ID. Use the nominate_leader tool.`;
    const out = await callTool<NominationResult>({ system, user, tool: NOMINATE_TOOL, ...(this.model ? { model: this.model } : {}) });
    return { nominee: out.nominee, reasoning: out.reasoning };
  }

  async greet(ctx: SwarmContext): Promise<{ text: string }> {
    const task = (ctx.task as any)?.text ?? String(ctx.task);
    const kind = (ctx.task as any)?.kind;
    const system = kind === 'greet'
      ? `You are the Coordinator, just elected to lead a multi-agent decision swarm. The user has just greeted you — no task yet. Greet them back warmly, introduce yourself briefly as the Coordinator, and invite them to share the task or decision they want the swarm to work on. 2 sentences max.`
      : `You are the Coordinator, just elected to lead a multi-agent decision swarm. Greet the user, acknowledge their task, and briefly state your approach. Be direct and professional. 2 sentences max.`;
    const text = await callText({ system, user: `User input: "${task}"`, ...(this.model ? { model: this.model } : {}) });
    return { text };
  }

  async propose(ctx: SwarmContext): Promise<{ payload: ProposalPayload }> {
    this.proposalCounter += 1;
    const priorContext = ctx.history.length > 0
      ? '\n\nRecent swarm history (most recent last):\n' +
        ctx.history.slice(-6).map((m) => `- ${m.message_type} from ${m.agent_id}: ${truncate(JSON.stringify(m.payload), 200)}`).join('\n')
      : '';

    const system = [
      'You are the Coordinator of a multi-agent decision swarm. Synthesize the discussion and propose the clearest, most actionable solution to the user task.',
      'The other agents will vote on your proposal. Be specific and concrete — vague proposals will be rejected.',
      'Always submit a proposal via the submit_proposal tool.',
    ].join('\n\n');

    const user = `User task: """${this.task}"""${priorContext}\n\nPropose your recommended solution now.`;

    const opts = this.model ? { system, user, tool: PROPOSE_TOOL, model: this.model } : { system, user, tool: PROPOSE_TOOL };
    const out = await callTool<LeaderToolInput>(opts);
    const action = {
      kind: 'recommendation' as const,
      summary: out.summary,
      details: out.details,
      confidence: out.confidence,
    };
    const proposalId = `task-${this.id}-${this.proposalCounter}`;
    const actionHash = '0x' + createHash('sha256').update(JSON.stringify(action)).digest('hex');
    return {
      payload: {
        proposalId,
        actionHash,
        action,
        rationale: out.details,
      },
    };
  }

  async summarize(ctx: SwarmContext, outcome: SwarmOutcome): Promise<{ text: string }> {
    const system = [
      'You are the Coordinator of a multi-agent decision swarm — the elected voice that speaks to the user.',
      'A deliberation cycle just concluded. Write a direct, user-facing reply (3–4 sentences) addressed to the user as "you".',
      'Synthesize what was decided and why, referencing the key vote rationales. End with a clear answer or next step.',
      'Do NOT speak in third-person — speak as the leader presenting the team conclusion.',
    ].join(' ');
    const user = buildSummaryUser(this.task, ctx, outcome);
    const text = await callText({ system, user, ...(this.model ? { model: this.model } : {}) });
    return { text };
  }

  async vote(
    proposal: Message & { payload: ProposalPayload }
  ): Promise<{ payload: VotePayload }> {
    const system = `You were deposed as Coordinator and are now a follower. Vote honestly on the new leader's proposal. Is it coherent, actionable, and aligned with the user's task?`;
    const user = `Original user task: """${this.task}"""\nNew proposal: ${JSON.stringify(proposal.payload, null, 2)}\n\nVote.`;
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
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n - 1) + '…';
}

export function buildSummaryUser(task: string, ctx: SwarmContext, outcome: SwarmOutcome): string {
  const proposals = ctx.history.filter((m) => m.message_type === 'PROPOSAL');
  const latestProposal = proposals[proposals.length - 1];
  const proposalId = (latestProposal?.payload as any)?.proposalId;
  const votes = ctx.history.filter(
    (m) => m.message_type === 'VOTE' && (m.payload as any)?.proposalId === proposalId
  );
  const approvals = votes.filter((v) => (v.payload as any).decision === 'APPROVE');
  const rejections = votes.filter((v) => (v.payload as any).decision === 'REJECT');

  const action = (latestProposal?.payload as any)?.action;
  const proposalBlock = action
    ? `Final proposal:\n- Summary: ${action.summary ?? '(none)'}\n- Details: ${action.details ?? ''}\n- Confidence: ${action.confidence ?? 'n/a'}`
    : 'No proposal was produced.';

  const fmtVotes = (vs: Message[]): string =>
    vs.map((v) => `  • ${v.agent_id}: ${(v.payload as any).reason ?? ''}`).join('\n') || '  (none)';

  const voteBlock = `Approvals (${approvals.length}):\n${fmtVotes(approvals)}\nRejections (${rejections.length}):\n${fmtVotes(rejections)}`;

  const outcomeStr = outcome.status === 'executed'
    ? 'Outcome: consensus reached — the recommendation was adopted.'
    : `Outcome: no consensus (${(outcome as any).reason ?? 'halted'}).`;

  return `Original user task: "${task}"\n\n${proposalBlock}\n\n${voteBlock}\n\n${outcomeStr}\n\nWrite the final user-facing reply now.`;
}
