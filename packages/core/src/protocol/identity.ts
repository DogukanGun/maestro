import type { Message } from './message.js';

export interface AgentIdentity {
  id: string;
  role: string;
}

export interface IdentityProvider {
  list(): Promise<AgentIdentity[]>;
  isRegistered(id: string): Promise<boolean>;
  verify(msg: Message): Promise<boolean>;
}
