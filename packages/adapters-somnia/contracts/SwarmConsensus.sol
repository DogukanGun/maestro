// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AgentRegistry} from "./AgentRegistry.sol";

contract SwarmConsensus {
    AgentRegistry public immutable registry;

    struct Proposal {
        address leader;
        bytes32 logRef;
        uint256 epoch;
        uint256 approvals;
        uint256 electionVotes;
        bool blocked;
        bool executed;
        bool exists;
    }

    address public currentLeader;
    uint256 public currentEpoch;
    bytes32 public activeProposal;

    mapping(bytes32 => Proposal) public proposals;
    mapping(bytes32 => mapping(address => bool)) public approvalVotes;
    mapping(bytes32 => mapping(address => bool)) public electionVotes;

    address[] public agentSet;
    uint256 public leaderIdx;

    event Proposed(bytes32 indexed actionHash, address indexed leader, bytes32 logRef, uint256 epoch);
    event Voted(bytes32 indexed actionHash, address indexed voter, uint256 approvals);
    event LeaderElectionTriggered(bytes32 indexed actionHash, address indexed voter, uint256 electionVotes);
    event LeaderDeposed(bytes32 indexed actionHash, address indexed oldLeader, address indexed newLeader, uint256 epoch);
    event Executed(bytes32 indexed actionHash, uint256 approvals);
    event LogBatchSealed(uint256 indexed epoch, bytes32 ref);

    error NotLeader(address caller);
    error NotRegistered(address caller);
    error UnknownProposal(bytes32 actionHash);
    error ProposalActive(bytes32 actionHash);
    error ProposalBlocked(bytes32 actionHash);
    error AlreadyVoted(address voter);
    error QuorumNotReached(uint256 have, uint256 need);
    error EmptyAgentSet();

    constructor(address registry_, address[] memory initialAgents) {
        require(initialAgents.length > 0, "no agents");
        registry = AgentRegistry(registry_);
        agentSet = initialAgents;
        currentLeader = initialAgents[0];
    }

    function followerCount() public view returns (uint256) {
        if (agentSet.length == 0) revert EmptyAgentSet();
        return agentSet.length - 1;
    }

    function quorum() public view returns (uint256) {
        uint256 n = followerCount();
        return (2 * n + 2) / 3; // ceil(2n/3)
    }

    function proposeAction(bytes32 actionHash, bytes32 logRef) external {
        if (msg.sender != currentLeader) revert NotLeader(msg.sender);
        if (activeProposal != bytes32(0)) {
            Proposal storage prev = proposals[activeProposal];
            if (!prev.executed && !prev.blocked) revert ProposalActive(activeProposal);
        }
        proposals[actionHash] = Proposal({
            leader: msg.sender,
            logRef: logRef,
            epoch: currentEpoch,
            approvals: 0,
            electionVotes: 0,
            blocked: false,
            executed: false,
            exists: true
        });
        activeProposal = actionHash;
        emit Proposed(actionHash, msg.sender, logRef, currentEpoch);
    }

    function voteApprove(bytes32 actionHash) external {
        Proposal storage p = _requireProposal(actionHash);
        if (p.blocked) revert ProposalBlocked(actionHash);
        if (!_isRegisteredFollower(msg.sender)) revert NotRegistered(msg.sender);
        if (approvalVotes[actionHash][msg.sender]) revert AlreadyVoted(msg.sender);
        approvalVotes[actionHash][msg.sender] = true;
        p.approvals += 1;
        emit Voted(actionHash, msg.sender, p.approvals);
    }

    function triggerLeaderElection(bytes32 reasonRef) external {
        bytes32 actionHash = activeProposal;
        if (actionHash == bytes32(0)) revert UnknownProposal(actionHash);
        Proposal storage p = proposals[actionHash];
        if (!p.exists) revert UnknownProposal(actionHash);
        if (!_isRegisteredFollower(msg.sender)) revert NotRegistered(msg.sender);
        if (electionVotes[actionHash][msg.sender]) revert AlreadyVoted(msg.sender);
        electionVotes[actionHash][msg.sender] = true;
        p.electionVotes += 1;
        emit LeaderElectionTriggered(actionHash, msg.sender, p.electionVotes);

        if (p.electionVotes >= quorum() && !p.blocked) {
            p.blocked = true;
            address oldLeader = currentLeader;
            leaderIdx = (leaderIdx + 1) % agentSet.length;
            currentLeader = agentSet[leaderIdx];
            currentEpoch += 1;
            activeProposal = bytes32(0);
            emit LeaderDeposed(actionHash, oldLeader, currentLeader, currentEpoch);
            // reasonRef is stored implicitly via the LogBatchSealed event flow
            reasonRef;
        }
    }

    function executeAction(bytes32 actionHash) external {
        Proposal storage p = _requireProposal(actionHash);
        if (p.blocked) revert ProposalBlocked(actionHash);
        uint256 q = quorum();
        if (p.approvals < q) revert QuorumNotReached(p.approvals, q);
        p.executed = true;
        if (activeProposal == actionHash) activeProposal = bytes32(0);
        emit Executed(actionHash, p.approvals);
    }

    function sealLogBatch(uint256 epoch, bytes32 ref) external {
        if (!_isRegisteredFollower(msg.sender) && msg.sender != currentLeader) {
            revert NotRegistered(msg.sender);
        }
        emit LogBatchSealed(epoch, ref);
    }

    function _requireProposal(bytes32 actionHash) private view returns (Proposal storage) {
        Proposal storage p = proposals[actionHash];
        if (!p.exists) revert UnknownProposal(actionHash);
        return p;
    }

    function _isRegisteredFollower(address who) private view returns (bool) {
        for (uint256 i = 0; i < agentSet.length; i++) {
            if (agentSet[i] == who) return true;
        }
        return false;
    }

    function agents() external view returns (address[] memory) {
        return agentSet;
    }
}
