import { createHash } from 'node:crypto';
import type { Message } from '../../protocol/message.js';
import type { LogStore } from '../ports.js';

export class InMemoryLogStore implements LogStore {
  private readonly buffer: Message[] = [];
  private readonly sealed: Map<string, Message[]> = new Map();

  async append(msg: Message): Promise<void> {
    this.buffer.push(msg);
  }

  async seal(_epoch: number): Promise<{ ref: string }> {
    const snapshot = [...this.buffer];
    const jsonl = snapshot.map((m) => JSON.stringify(m)).join('\n');
    const ref = '0x' + createHash('sha256').update(jsonl).digest('hex');
    this.sealed.set(ref, snapshot);
    this.buffer.length = 0;
    return { ref };
  }

  async read(ref: string): Promise<Message[]> {
    const snapshot = this.sealed.get(ref);
    if (!snapshot) throw new Error(`unknown log ref: ${ref}`);
    return [...snapshot];
  }

  pending(): readonly Message[] {
    return this.buffer;
  }
}
