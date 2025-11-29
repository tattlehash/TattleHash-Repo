
import type { ChainConfig } from './types';

export const CHAIN_CONFIGS: Record<string, ChainConfig> = {
    'eth-mainnet': {
        network: 'eth-mainnet',
        chainId: 1,
        rpcEndpoints: [
            '${RPC_ETH_MAIN}',
            'https://cloudflare-eth.com',
            'https://eth.llamarpc.com',
        ],
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://etherscan.io',
    },
    'base-mainnet': {
        network: 'base-mainnet',
        chainId: 8453,
        rpcEndpoints: [
            '${RPC_BASE_MAIN}',
            'https://base-mainnet.public.blastapi.io',
            'https://base.llamarpc.com',
        ],
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://basescan.org',
    },
    'polygon-mainnet': {
        network: 'polygon-mainnet',
        chainId: 137,
        rpcEndpoints: [
            '${WEB3_RPC_URL_POLYGON}',
            'https://polygon-rpc.com',
            'https://polygon.llamarpc.com',
        ],
        nativeCurrency: { symbol: 'MATIC', decimals: 18 },
        blockExplorer: 'https://polygonscan.com',
    },
    'arbitrum-one': {
        network: 'arbitrum-one',
        chainId: 42161,
        rpcEndpoints: [
            'https://arb1.arbitrum.io/rpc',
            'https://arbitrum.llamarpc.com',
        ],
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://arbiscan.io',
    },
    'optimism-mainnet': {
        network: 'optimism-mainnet',
        chainId: 10,
        rpcEndpoints: [
            'https://mainnet.optimism.io',
            'https://optimism.llamarpc.com',
        ],
        nativeCurrency: { symbol: 'ETH', decimals: 18 },
        blockExplorer: 'https://optimistic.etherscan.io',
    },
};

export function resolveRpcEndpoint(
    template: string,
    env: Record<string, string>
): string {
    return template.replace(/\$\{(\w+)\}/g, (_, key) => env[key] || template);
}

export function getRpcEndpoint(
    network: string,
    env: Record<string, string>
): string {
    const config = CHAIN_CONFIGS[network];
    if (!config) {
        throw new Error(`Unsupported network: ${network}`);
    }

    // Try env var first, then fallbacks
    for (const template of config.rpcEndpoints) {
        const resolved = resolveRpcEndpoint(template, env);
        if (!resolved.includes('${')) {
            return resolved;
        }
    }

    throw new Error(`No RPC endpoint available for ${network}`);
}
