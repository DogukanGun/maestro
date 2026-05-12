import { EventEmitter } from 'node:events';
import type { Message } from '../../protocol/message.js';
import type { MessageBus, Unsubscribe } from '../ports.js';

export class InMemoryMessageBus implements MessageBus {
  private readonly emitter = new EventEmitter();

  publish(msg: Message): void {
    this.emitter.emit('msg', msg);
  }

  subscribe(cb: (msg: Message) => void): Unsubscribe {
    this.emitter.on('msg', cb);
    return () => this.emitter.off('msg', cb);
  }
}
