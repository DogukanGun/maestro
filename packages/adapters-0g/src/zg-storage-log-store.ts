import type { LogStore, Message } from '@agentraft/core';

export interface ZgStorageLogStoreOptions {
  indexerRpc: string;
  evmRpc: string;
  signer: unknown; // ethers.Wallet — kept loose so we don't pull ethers types into core
  uploader: ZgUploaderLike;
}

export interface ZgUploaderLike {
  upload(bytes: Uint8Array): Promise<{ rootHash: string }>;
  download(rootHash: string): Promise<Uint8Array>;
}

export class ZgStorageLogStore implements LogStore {
  private readonly buffer: Message[] = [];
  private readonly uploader: ZgUploaderLike;

  constructor(opts: ZgStorageLogStoreOptions) {
    this.uploader = opts.uploader;
  }

  async append(msg: Message): Promise<void> {
    this.buffer.push(msg);
  }

  async seal(_epoch: number): Promise<{ ref: string }> {
    if (this.buffer.length === 0) {
      const empty = new TextEncoder().encode('');
      const { rootHash } = await this.uploader.upload(empty);
      return { ref: rootHash };
    }
    const jsonl = this.buffer.map((m) => JSON.stringify(m)).join('\n');
    const bytes = new TextEncoder().encode(jsonl);
    const { rootHash } = await this.uploader.upload(bytes);
    this.buffer.length = 0;
    return { ref: rootHash };
  }

  async read(ref: string): Promise<Message[]> {
    const bytes = await this.uploader.download(ref);
    const text = new TextDecoder().decode(bytes);
    if (!text.trim()) return [];
    return text
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Message);
  }
}

/**
 * Concrete uploader backed by @0glabs/0g-ts-sdk's `Indexer` + `MemData`.
 * Imported lazily so that consumers who only want the in-memory `LogStore`
 * never have to install the 0G storage SDK.
 */
export async function makeZgUploader(opts: {
  indexerRpc: string;
  evmRpc: string;
  signer: unknown;
}): Promise<ZgUploaderLike> {
  // @ts-expect-error 0g-ts-sdk publishes types under lib.commonjs/ which legacy Node resolution doesn't reach.
  const sdk = await import('@0glabs/0g-ts-sdk');
  const IndexerCls: any = (sdk as any).Indexer;
  const MemDataCls: any = (sdk as any).MemData;
  if (!IndexerCls || !MemDataCls) {
    throw new Error('0g-ts-sdk does not export Indexer/MemData; SDK version mismatch');
  }
  const indexer = new IndexerCls(opts.indexerRpc);
  return {
    async upload(bytes: Uint8Array) {
      const data = new MemDataCls(bytes);
      const [tx, err] = await indexer.upload(data, opts.evmRpc, opts.signer);
      if (err) throw err;
      const rootHash: string = tx?.rootHash ?? tx?.tree?.rootHash?.() ?? tx;
      return { rootHash };
    },
    async download(rootHash: string) {
      const result = await indexer.downloadToBlob(rootHash);
      const blob = Array.isArray(result) ? result[0] : result;
      if (blob instanceof Uint8Array) return blob;
      if (blob && typeof blob.arrayBuffer === 'function') {
        const ab = await blob.arrayBuffer();
        return new Uint8Array(ab);
      }
      throw new Error('unexpected download result shape');
    },
  };
}
