import { expect } from 'chai';
import { ethers } from 'hardhat';
import type { Signer } from 'ethers';

const MIN_STAKE = ethers.parseEther('0.001');

async function deploy(): Promise<{
  registry: any;
  consensus: any;
  leader: Signer;
  risk: Signer;
  compliance: Signer;
  outsider: Signer;
}> {
  const [deployer, leader, risk, compliance, outsider] = await ethers.getSigners();
  const Registry = await ethers.getContractFactory('AgentRegistry');
  const registry = await Registry.deploy(MIN_STAKE);
  await registry.waitForDeployment();

  for (const [signer, role] of [
    [leader, 'leader'],
    [risk, 'risk'],
    [compliance, 'compliance'],
  ] as const) {
    await (await registry.connect(signer).registerAgent(role, { value: MIN_STAKE })).wait();
  }

  const Consensus = await ethers.getContractFactory('SwarmConsensus');
  const consensus = await Consensus.deploy(await registry.getAddress(), [
    await leader.getAddress(),
    await risk.getAddress(),
    await compliance.getAddress(),
  ]);
  await consensus.waitForDeployment();
  // suppress unused-warning of deployer
  void deployer;
  return { registry, consensus, leader, risk, compliance, outsider };
}

describe('AgentRegistry', () => {
  it('registers an agent and tracks active set', async () => {
    const { registry, leader } = await deploy();
    const a = await registry.agents(await leader.getAddress());
    expect(a.role).to.equal('leader');
    expect(a.active).to.equal(true);
    expect(await registry.registeredCount()).to.equal(3n);
  });

  it('reverts on insufficient stake', async () => {
    const [, , , , , stranger] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory('AgentRegistry');
    const registry = await Registry.deploy(MIN_STAKE);
    await registry.waitForDeployment();
    await expect(
      registry.connect(stranger).registerAgent('x', { value: 0n })
    ).to.be.revertedWithCustomError(registry, 'InsufficientStake');
  });
});

describe('SwarmConsensus — happy path', () => {
  it('proposes, collects 2/3 approvals, executes', async () => {
    const { consensus, leader, risk, compliance } = await deploy();
    const actionHash = ethers.id('safe-transfer');
    const logRef = ethers.id('log-batch-0');

    await expect(consensus.connect(leader).proposeAction(actionHash, logRef))
      .to.emit(consensus, 'Proposed');

    await expect(consensus.connect(risk).voteApprove(actionHash))
      .to.emit(consensus, 'Voted');
    await expect(consensus.connect(compliance).voteApprove(actionHash))
      .to.emit(consensus, 'Voted');

    await expect(consensus.executeAction(actionHash))
      .to.emit(consensus, 'Executed');
  });

  it('rejects vote from outsider', async () => {
    const { consensus, leader, outsider } = await deploy();
    const actionHash = ethers.id('safe-transfer');
    await consensus.connect(leader).proposeAction(actionHash, ethers.id('r'));
    await expect(
      consensus.connect(outsider).voteApprove(actionHash)
    ).to.be.revertedWithCustomError(consensus, 'NotRegistered');
  });
});

describe('SwarmConsensus — depose path', () => {
  it('deposes leader on 2/3 election votes and rotates', async () => {
    const { consensus, leader, risk, compliance } = await deploy();
    const actionHash = ethers.id('poisoned');
    await consensus.connect(leader).proposeAction(actionHash, ethers.id('r'));

    const initialLeader = await consensus.currentLeader();
    expect(initialLeader).to.equal(await leader.getAddress());

    await consensus.connect(risk).triggerLeaderElection(ethers.id('reason'));
    await expect(consensus.connect(compliance).triggerLeaderElection(ethers.id('reason')))
      .to.emit(consensus, 'LeaderDeposed');

    const newLeader = await consensus.currentLeader();
    expect(newLeader).to.not.equal(initialLeader);
    expect(await consensus.currentEpoch()).to.equal(1n);
  });

  it('blocks execution after depose', async () => {
    const { consensus, leader, risk, compliance } = await deploy();
    const actionHash = ethers.id('poisoned');
    await consensus.connect(leader).proposeAction(actionHash, ethers.id('r'));
    await consensus.connect(risk).triggerLeaderElection(ethers.id('reason'));
    await consensus.connect(compliance).triggerLeaderElection(ethers.id('reason'));
    await expect(consensus.executeAction(actionHash))
      .to.be.revertedWithCustomError(consensus, 'ProposalBlocked');
  });

  it('new leader can re-propose after depose', async () => {
    const { consensus, leader, risk, compliance } = await deploy();
    const bad = ethers.id('poisoned');
    await consensus.connect(leader).proposeAction(bad, ethers.id('r'));
    await consensus.connect(risk).triggerLeaderElection(ethers.id('reason'));
    await consensus.connect(compliance).triggerLeaderElection(ethers.id('reason'));

    const newLeaderAddr = await consensus.currentLeader();
    const newLeaderSigner = newLeaderAddr === (await risk.getAddress()) ? risk : compliance;

    const good = ethers.id('safe');
    await expect(consensus.connect(newLeaderSigner).proposeAction(good, ethers.id('r2')))
      .to.emit(consensus, 'Proposed');
  });
});
