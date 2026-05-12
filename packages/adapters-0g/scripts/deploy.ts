import { ethers } from 'hardhat';
import { writeFileSync } from 'node:fs';

async function main() {
  const [deployer, agent1, agent2, agent3] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log(`deploying to chainId=${network.chainId} from ${deployer.address}`);

  const MIN_STAKE = ethers.parseEther('0.001');

  const Registry = await ethers.getContractFactory('AgentRegistry');
  const registry = await Registry.deploy(MIN_STAKE);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`AgentRegistry: ${registryAddr}`);

  const agents = [agent1, agent2, agent3].filter(Boolean);
  const agentAddrs: string[] = [];
  for (let i = 0; i < agents.length; i++) {
    const signer = agents[i]!;
    const role = ['leader', 'risk', 'compliance'][i] ?? `agent-${i}`;
    const tx = await registry.connect(signer).registerAgent(role, { value: MIN_STAKE });
    await tx.wait();
    agentAddrs.push(signer.address);
    console.log(`  registered ${role}: ${signer.address}`);
  }

  if (agentAddrs.length === 0) {
    console.log('no extra signers; using deployer as the sole agent');
    const tx = await registry.registerAgent('leader', { value: MIN_STAKE });
    await tx.wait();
    agentAddrs.push(deployer.address);
  }

  const Consensus = await ethers.getContractFactory('SwarmConsensus');
  const consensus = await Consensus.deploy(registryAddr, agentAddrs);
  await consensus.waitForDeployment();
  const consensusAddr = await consensus.getAddress();
  console.log(`SwarmConsensus: ${consensusAddr}`);

  const out = {
    chainId: Number(network.chainId),
    deployer: deployer.address,
    AgentRegistry: registryAddr,
    SwarmConsensus: consensusAddr,
    agents: agentAddrs,
    deployedAt: new Date().toISOString(),
  };
  const filename = `deployments.${network.chainId}.json`;
  writeFileSync(filename, JSON.stringify(out, null, 2));
  console.log(`wrote ${filename}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
