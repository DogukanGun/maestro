export interface QuorumRule {
  minApprovals(totalFollowers: number): number;
}

export const TwoThirdsQuorum: QuorumRule = {
  minApprovals: (n: number): number => Math.ceil((2 * n) / 3),
};

export const SimpleMajority: QuorumRule = {
  minApprovals: (n: number): number => Math.floor(n / 2) + 1,
};
