import { z } from 'zod';

export const MessageType = z.enum(['PROPOSAL', 'VOTE', 'CHAT', 'VOTE_NEW_LEADER', 'NOMINATION']);
export type MessageType = z.infer<typeof MessageType>;

export const VoteDecision = z.enum(['APPROVE', 'REJECT']);
export type VoteDecision = z.infer<typeof VoteDecision>;

export const VotePayload = z.object({
  proposalId: z.string(),
  decision: VoteDecision,
  reason: z.string().optional(),
  evidence: z.record(z.unknown()).optional(),
});
export type VotePayload = z.infer<typeof VotePayload>;

export const ProposalPayload = z.object({
  proposalId: z.string(),
  actionHash: z.string(),
  action: z.record(z.unknown()),
  rationale: z.string().optional(),
});
export type ProposalPayload = z.infer<typeof ProposalPayload>;

export const Message = z.object({
  agent_id: z.string(),
  timestamp: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative(),
  nonce: z.number().int().nonnegative(),
  message_type: MessageType,
  payload: z.unknown(),
  sig: z.string().optional(),
});
export type Message = z.infer<typeof Message>;

export function parseMessage(raw: unknown): Message {
  return Message.parse(raw);
}

export function isProposal(msg: Message): msg is Message & { payload: ProposalPayload } {
  if (msg.message_type !== 'PROPOSAL') return false;
  const result = ProposalPayload.safeParse(msg.payload);
  return result.success;
}

export function isVote(msg: Message): msg is Message & { payload: VotePayload } {
  if (msg.message_type !== 'VOTE' && msg.message_type !== 'VOTE_NEW_LEADER') return false;
  const result = VotePayload.safeParse(msg.payload);
  return result.success;
}
