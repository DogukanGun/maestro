import '@nomicfoundation/hardhat-toolbox';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import type { HardhatUserConfig } from 'hardhat/config';

// Load .env from the repo root, not the package cwd
loadEnv({ path: resolve(__dirname, '../../.env') });
loadEnv({ path: resolve(__dirname, '.env'), override: false });

// Normalise: trim whitespace, strip a 0x prefix, left-pad to 64 hex chars,
// then re-prefix. Tolerates keys serialised without a leading zero.
function normaliseKey(raw: string | undefined): string | null {
  if (!raw) return null;
  const stripped = raw.trim().replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(stripped)) return null;
  if (stripped.length > 64) return null;
  return '0x' + stripped.padStart(64, '0');
}

const PRIVATE_KEY = normaliseKey(process.env.DEPLOYER_PRIVATE_KEY);

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.24',
    settings: {
      evmVersion: 'cancun',
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    shannon: {
      url: process.env.SOMNIA_TESTNET_RPC ?? 'https://api.infra.testnet.somnia.network/',
      chainId: 50312,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
};

export default config;
