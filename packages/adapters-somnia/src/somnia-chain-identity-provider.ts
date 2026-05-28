import { Contract, type ContractRunner } from 'ethers';
import { verifyMessage } from 'ethers';
import type { AgentIdentity, IdentityProvider, Message } from '@agentraft/core';
import { AGENT_REGISTRY_ABI } from './abi.js';

export interface SomniaChainIdentityProviderOptions {
  registryAddress: string;
  runner: ContractRunner;
  agentIds?: string[];
}

export class SomniaChainIdentityProvider implements IdentityProvider {
  private readonly registry: Contract;
  private readonly explicitIds?: string[];

  constructor(opts: SomniaChainIdentityProviderOptions) {
    this.registry = new Contract(opts.registryAddress, [...AGENT_REGISTRY_ABI], opts.runner);
    if (opts.agentIds) this.explicitIds = opts.agentIds;
  }

  async list(): Promise<AgentIdentity[]> {
    const addresses: string[] = this.explicitIds
      ? [...this.explicitIds]
      : ((await this.registry.activeAgents()) as string[]);
    const out: AgentIdentity[] = [];
    for (const addr of addresses) {
      const a = await this.registry.agents(addr);
      out.push({ id: addr, role: a.role });
    }
    return out;
  }

  async isRegistered(id: string): Promise<boolean> {
    return (await this.registry.isActive(id)) as boolean;
  }

  async verify(msg: Message): Promise<boolean> {
    if (!msg.sig) return await this.isRegistered(msg.agent_id);
    const canonical = JSON.stringify({
      agent_id: msg.agent_id,
      timestamp: msg.timestamp,
      epoch: msg.epoch,
      nonce: msg.nonce,
      message_type: msg.message_type,
      payload: msg.payload,
    });
    try {
      const recovered = verifyMessage(canonical, msg.sig);
      return recovered.toLowerCase() === msg.agent_id.toLowerCase();
    } catch {
      return false;
    }
  }
}
