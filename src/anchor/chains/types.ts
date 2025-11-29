/**
 * Chain provider interface for multi-chain anchoring.
 *
 * This abstraction allows easy addition of new chains.
 * Each chain implements the same interface for:
 * - Transaction creation and signing
 * - Transaction submission
 * - Confirmation polling
 */

/**
 * Supported blockchain networks.
 */
export type ChainId =
    | 'polygon'      // Polygon PoS (137)
    | 'ethereum'     // Ethereum mainnet (1)
    | 'arbitrum'     // Arbitrum One (42161)
    | 'base'         // Base (8453)
    | 'optimism';    // Optimism (10)

/**
 * Chain configuration.
 */
export interface ChainConfig {
    chainId: ChainId;
    networkId: number;          // EIP-155 chain ID
    name: string;
    rpcUrl: string;
    blockExplorerUrl?: string;
    confirmationsRequired: number;
    avgBlockTimeMs: number;
}

/**
 * Transaction to be submitted.
 */
export interface AnchorTransaction {
    to: string;           // Contract address or null for simple tx
    data: string;         // Encoded data (hex)
    value?: string;       // Wei value (hex)
    gasLimit?: string;    // Gas limit (hex)
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
}

/**
 * Submitted transaction result.
 */
export interface TransactionResult {
    txHash: string;
    chainId: ChainId;
    submittedAt: number;
}

/**
 * Transaction status from chain.
 */
export interface TransactionStatus {
    txHash: string;
    confirmed: boolean;
    confirmations: number;
    blockNumber?: number;
    blockHash?: string;
    reorged: boolean;
    failed: boolean;
    gasUsed?: string;
}

/**
 * Chain provider interface.
 * Implement this for each supported blockchain.
 */
export interface ChainProvider {
    readonly config: ChainConfig;

    /**
     * Submit anchor data to the chain.
     *
     * @param rootHash - Merkle root hash to anchor
     * @param privateKey - Signing key (hex, without 0x prefix)
     * @returns Transaction result with hash
     */
    submitAnchor(
        rootHash: string,
        privateKey: string
    ): Promise<TransactionResult>;

    /**
     * Query transaction status.
     *
     * @param txHash - Transaction hash to query
     * @returns Transaction status with confirmations
     */
    getTransactionStatus(txHash: string): Promise<TransactionStatus>;

    /**
     * Get current block number.
     */
    getBlockNumber(): Promise<number>;

    /**
     * Get account nonce for transaction signing.
     */
    getTransactionCount(address: string): Promise<number>;

    /**
     * Estimate gas for anchor transaction.
     */
    estimateGas(tx: AnchorTransaction, from: string): Promise<string>;

    /**
     * Get current gas prices.
     */
    getGasPrice(): Promise<{ maxFeePerGas: string; maxPriorityFeePerGas: string }>;
}

/**
 * Default chain configurations.
 */
export const CHAIN_CONFIGS: Record<ChainId, Omit<ChainConfig, 'rpcUrl'>> = {
    polygon: {
        chainId: 'polygon',
        networkId: 137,
        name: 'Polygon PoS',
        blockExplorerUrl: 'https://polygonscan.com',
        confirmationsRequired: 128,  // ~4-5 minutes on Polygon
        avgBlockTimeMs: 2000,
    },
    ethereum: {
        chainId: 'ethereum',
        networkId: 1,
        name: 'Ethereum Mainnet',
        blockExplorerUrl: 'https://etherscan.io',
        confirmationsRequired: 12,
        avgBlockTimeMs: 12000,
    },
    arbitrum: {
        chainId: 'arbitrum',
        networkId: 42161,
        name: 'Arbitrum One',
        blockExplorerUrl: 'https://arbiscan.io',
        confirmationsRequired: 64,
        avgBlockTimeMs: 250,
    },
    base: {
        chainId: 'base',
        networkId: 8453,
        name: 'Base',
        blockExplorerUrl: 'https://basescan.org',
        confirmationsRequired: 64,
        avgBlockTimeMs: 2000,
    },
    optimism: {
        chainId: 'optimism',
        networkId: 10,
        name: 'Optimism',
        blockExplorerUrl: 'https://optimistic.etherscan.io',
        confirmationsRequired: 64,
        avgBlockTimeMs: 2000,
    },
};
