import type { AgentIdentity, IdentityProvider } from '../../protocol/identity.js';
import type { Message } from '../../protocol/message.js';

export class InMemoryIdentityProvider implements IdentityProvider {
  private readonly agents: Map<string, AgentIdentity>;

  constructor(agents: AgentIdentity[]) {
    this.agents = new Map(agents.map((a) => [a.id, a]));
  }

  async list(): Promise<AgentIdentity[]> {
    return [...this.agents.values()];
  }

  async isRegistered(id: string): Promise<boolean> {
    return this.agents.has(id);
  }

  async verify(msg: Message): Promise<boolean> {
    return this.agents.has(msg.agent_id);
  }
}
