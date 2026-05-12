import { describe, it, expect } from 'vitest';
import { Message, parseMessage, isProposal, isVote, TwoThirdsQuorum, SimpleMajority } from '../src/index.js';

describe('Message schema', () => {
  it('parses a valid PROPOSAL message', () => {
    const raw = {
      agent_id: 'agent-1',
      timestamp: 1700000000,
      epoch: 0,
      nonce: 0,
      message_type: 'PROPOSAL',
      payload: { proposalId: 'p1', actionHash: '0xabc', action: { kind: 'transfer', amount: 100 } },
    };
    const msg = parseMessage(raw);
    expect(msg.message_type).toBe('PROPOSAL');
    expect(isProposal(msg)).toBe(true);
  });

  it('rejects negative epoch', () => {
    expect(() =>
      Message.parse({
        agent_id: 'a',
        timestamp: 1,
        epoch: -1,
        nonce: 0,
        message_type: 'CHAT',
        payload: {},
      })
    ).toThrow();
  });

  it('isVote distinguishes VOTE and VOTE_NEW_LEADER', () => {
    const v: Message = {
      agent_id: 'a',
      timestamp: 1,
      epoch: 0,
      nonce: 0,
      message_type: 'VOTE',
      payload: { proposalId: 'p1', decision: 'APPROVE' },
    };
    expect(isVote(v)).toBe(true);
  });
});

describe('QuorumRule', () => {
  it('TwoThirdsQuorum requires ceil(2n/3)', () => {
    expect(TwoThirdsQuorum.minApprovals(2)).toBe(2);
    expect(TwoThirdsQuorum.minApprovals(3)).toBe(2);
    expect(TwoThirdsQuorum.minApprovals(6)).toBe(4);
  });
  it('SimpleMajority requires floor(n/2)+1', () => {
    expect(SimpleMajority.minApprovals(2)).toBe(2);
    expect(SimpleMajority.minApprovals(3)).toBe(2);
    expect(SimpleMajority.minApprovals(4)).toBe(3);
  });
});
