// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

contract AgentRegistry {
    struct Agent {
        string role;
        uint256 stake;
        bool active;
    }

    uint256 public immutable minStake;
    mapping(address => Agent) public agents;
    address[] public registered;

    event AgentRegistered(address indexed agent, string role, uint256 stake);
    event AgentDeactivated(address indexed agent);
    event AgentReactivated(address indexed agent);

    error InsufficientStake(uint256 sent, uint256 required);
    error AlreadyRegistered(address agent);
    error NotRegistered(address agent);

    constructor(uint256 minStake_) {
        minStake = minStake_;
    }

    function registerAgent(string calldata role) external payable {
        if (msg.value < minStake) revert InsufficientStake(msg.value, minStake);
        Agent storage a = agents[msg.sender];
        if (bytes(a.role).length != 0) revert AlreadyRegistered(msg.sender);
        a.role = role;
        a.stake = msg.value;
        a.active = true;
        registered.push(msg.sender);
        emit AgentRegistered(msg.sender, role, msg.value);
    }

    function setActive(bool active) external {
        Agent storage a = agents[msg.sender];
        if (bytes(a.role).length == 0) revert NotRegistered(msg.sender);
        a.active = active;
        if (active) emit AgentReactivated(msg.sender);
        else emit AgentDeactivated(msg.sender);
    }

    function isActive(address who) external view returns (bool) {
        return agents[who].active;
    }

    function registeredCount() external view returns (uint256) {
        return registered.length;
    }

    function activeAgents() external view returns (address[] memory out) {
        uint256 n = registered.length;
        uint256 activeN;
        for (uint256 i = 0; i < n; i++) {
            if (agents[registered[i]].active) activeN++;
        }
        out = new address[](activeN);
        uint256 j;
        for (uint256 i = 0; i < n; i++) {
            address addr = registered[i];
            if (agents[addr].active) {
                out[j++] = addr;
            }
        }
    }
}
