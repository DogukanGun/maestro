import type { Agent, Message, ProposalPayload, SwarmContext } from '@agentraft/core';

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface PacingProfile {
  proposeMs: number;
  voteMs: number;
}

export const DEFAULT_PACING: PacingProfile = { proposeMs: 700, voteMs: 900 };

export function paced(agent: Agent, profile: PacingProfile, voteOffsetMs = 0): Agent {
  const wrapped: Agent = {
    id: agent.id,
    role: agent.role,
    async vote(proposal: Message & { payload: ProposalPayload }, ctx: SwarmContext) {
      await sleep(profile.voteMs + voteOffsetMs);
      return agent.vote(proposal, ctx);
    },
  };
  if (agent.propose) {
    wrapped.propose = async (ctx: SwarmContext) => {
      await sleep(profile.proposeMs);
      return agent.propose!(ctx);
    };
  }
  return wrapped;
}
