#!/usr/bin/env node
import 'dotenv/config';
import { makeZgUploader, ZgStorageLogStore } from '@agentraft/adapters-0g';

async function main(): Promise<void> {
  const ref = process.argv[2];
  if (!ref) {
    console.error('usage: replay <rootHash>');
    process.exit(1);
  }
  const indexerRpc = process.env.OG_INDEXER_RPC ?? 'https://indexer-storage-testnet-turbo.0g.ai';
  const evmRpc = process.env.OG_TESTNET_RPC ?? 'https://evmrpc-testnet.0g.ai';
  const uploader = await makeZgUploader({ indexerRpc, evmRpc, signer: undefined });
  const store = new ZgStorageLogStore({ indexerRpc, evmRpc, signer: undefined, uploader });
  const messages = await store.read(ref);
  for (const m of messages) console.log(JSON.stringify(m));
  console.log(`# ${messages.length} messages`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
