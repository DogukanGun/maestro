import '@nomicfoundation/hardhat-toolbox';
import 'dotenv/config';
import type { HardhatUserConfig } from 'hardhat/config';

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY ?? '';

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
    testnet: {
      url: process.env.OG_TESTNET_RPC ?? 'https://evmrpc-testnet.0g.ai',
      chainId: 16602,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    mainnet: {
      url: process.env.OG_MAINNET_RPC ?? 'https://evmrpc.0g.ai',
      chainId: 16661,
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
