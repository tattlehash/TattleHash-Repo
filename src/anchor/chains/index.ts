/**
 * Chain provider exports.
 */

export * from './types';
export { PolygonProvider, createPolygonProvider } from './polygon';

import type { ChainProvider, ChainId } from './types';
import { createPolygonProvider } from './polygon';

/**
 * Create a chain provider for the specified chain.
 *
 * @param chainId - The chain to create a provider for
 * @param rpcUrl - The RPC endpoint URL
 * @returns Chain provider instance
 */
export function createChainProvider(chainId: ChainId, rpcUrl: string): ChainProvider {
    switch (chainId) {
        case 'polygon':
            return createPolygonProvider(rpcUrl);
        // Future chains can be added here:
        // case 'ethereum':
        //     return createEthereumProvider(rpcUrl);
        // case 'arbitrum':
        //     return createArbitrumProvider(rpcUrl);
        default:
            throw new Error(`Unsupported chain: ${chainId}`);
    }
}
