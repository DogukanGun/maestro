import type { SwarmContext } from '@agentraft/core';

export const NOMINATE_TOOL = {
  name: 'nominate_leader',
  description: 'Nominate an agent to lead this task. You MUST use the exact agent ID string shown in the list.',
  inputSchema: {
    type: 'object',
    properties: {
      nominee: {
        type: 'string',
        description:
          'The EXACT agent ID to nominate — e.g. "leader", "risk", "compliance", or "market". Do NOT use display names like "Coordinator" or "Critic".',
      },
      reasoning: {
        type: 'string',
        description: 'One sentence explaining why this agent is best suited to lead this task.',
      },
    },
    required: ['nominee', 'reasoning'],
  },
};

const AGENT_DESCRIPTIONS: Record<string, string> = {
  leader: 'Coordinator — orchestrates discussion, proposes solutions to any task',
  risk: 'Critic — challenges assumptions, identifies risks and blindspots',
  compliance: 'Strategist — evaluates feasibility, tradeoffs, and long-term fit',
  market: 'Analyst — provides research and data-driven perspective',
};

export function buildAgentList(ctx: SwarmContext): string {
  const ids = [...new Set([
    ...(ctx.leader ? [ctx.leader] : []),
    ...ctx.followers.map((f) => f.id),
  ])].filter(Boolean);
  return ids
    .map((id) => `- id="${id}"  role: ${AGENT_DESCRIPTIONS[id] ?? id}`)
    .join('\n');
}
