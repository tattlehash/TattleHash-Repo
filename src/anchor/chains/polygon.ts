/**
 * Polygon chain provider implementation.
 *
 * Submits anchor data to Polygon PoS via JSON-RPC.
 * Uses EIP-1559 transactions for gas efficiency.
 */

import * as secp256k1 from '@noble/secp256k1';
import { Signature } from '@noble/secp256k1';
import { keccak256 } from '../../utils/crypto';
import type {
    ChainProvider,
    ChainConfig,
    AnchorTransaction,
    TransactionResult,
    TransactionStatus,
} from './types';
import { CHAIN_CONFIGS } from './types';

// ============================================================================
// Utility Functions
// ============================================================================

function hexToBytes(hex: string): Uint8Array {
    const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
    if (cleanHex.length === 0) return new Uint8Array(0);
    const bytes = new Uint8Array(cleanHex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(cleanHex.substr(i * 2, 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
    return '0x' + Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function padHex(hex: string, bytes: number): string {
    const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
    return clean.padStart(bytes * 2, '0');
}

function numberToHex(n: number | bigint): string {
    if (n === 0 || n === 0n) return '0x0';
    const hex = n.toString(16);
    return '0x' + (hex.length % 2 ? '0' + hex : hex);
}

function trimLeadingZeros(bytes: Uint8Array): Uint8Array {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    return bytes.slice(i);
}

// ============================================================================
// RLP Encoding (EIP-2718 compliant)
// ============================================================================

type RLPInput = Uint8Array | string | number | bigint | null | RLPInput[];

function rlpEncodeLength(len: number, offset: number): Uint8Array {
    if (len < 56) {
        return new Uint8Array([len + offset]);
    }
    const hexLen = len.toString(16);
    const lenBytes = hexToBytes(hexLen.length % 2 ? '0' + hexLen : hexLen);
    const result = new Uint8Array(1 + lenBytes.length);
    result[0] = lenBytes.length + offset + 55;
    result.set(lenBytes, 1);
    return result;
}

function rlpEncode(input: RLPInput): Uint8Array {
    if (input === null || input === undefined) {
        return new Uint8Array([0x80]);
    }

    if (typeof input === 'number' || typeof input === 'bigint') {
        if (input === 0 || input === 0n) {
            return new Uint8Array([0x80]);
        }
        const hex = input.toString(16);
        const bytes = hexToBytes(hex.length % 2 ? '0' + hex : hex);
        return rlpEncode(bytes);
    }

    if (typeof input === 'string') {
        return rlpEncode(hexToBytes(input));
    }

    if (input instanceof Uint8Array) {
        const trimmed = trimLeadingZeros(input);
        if (trimmed.length === 0) {
            return new Uint8Array([0x80]);
        }
        if (trimmed.length === 1 && trimmed[0] < 0x80) {
            return trimmed;
        }
        const lenPrefix = rlpEncodeLength(trimmed.length, 0x80);
        const result = new Uint8Array(lenPrefix.length + trimmed.length);
        result.set(lenPrefix, 0);
        result.set(trimmed, lenPrefix.length);
        return result;
    }

    if (Array.isArray(input)) {
        const encodedItems = input.map(item => rlpEncode(item));
        const totalLength = encodedItems.reduce((acc, item) => acc + item.length, 0);
        const lenPrefix = rlpEncodeLength(totalLength, 0xc0);
        const result = new Uint8Array(lenPrefix.length + totalLength);
        result.set(lenPrefix, 0);
        let offset = lenPrefix.length;
        for (const item of encodedItems) {
            result.set(item, offset);
            offset += item.length;
        }
        return result;
    }

    throw new Error('Invalid RLP input type');
}

// ============================================================================
// Transaction Signing
// ============================================================================

interface EIP1559TxParams {
    chainId: number;
    nonce: number;
    maxPriorityFeePerGas: bigint;
    maxFeePerGas: bigint;
    gasLimit: bigint;
    to: string;
    value: bigint;
    data: string;
}

function serializeEIP1559Tx(params: EIP1559TxParams, signature?: { v: number; r: bigint; s: bigint }): Uint8Array {
    const fields: RLPInput[] = [
        params.chainId,
        params.nonce,
        params.maxPriorityFeePerGas,
        params.maxFeePerGas,
        params.gasLimit,
        hexToBytes(params.to),
        params.value,
        hexToBytes(params.data),
        [], // accessList
    ];

    if (signature) {
        fields.push(signature.v);
        fields.push(signature.r);
        fields.push(signature.s);
    }

    const rlpEncoded = rlpEncode(fields);

    // EIP-2718: type 2 transaction prefix
    const result = new Uint8Array(1 + rlpEncoded.length);
    result[0] = 0x02;
    result.set(rlpEncoded, 1);
    return result;
}

async function signEIP1559Tx(params: EIP1559TxParams, privateKey: string): Promise<Uint8Array> {
    // Serialize unsigned transaction for signing
    const unsignedTx = serializeEIP1559Tx(params);

    // Hash the transaction
    const txHash = keccak256(unsignedTx);

    // Convert private key to bytes
    const privKeyBytes = hexToBytes(privateKey);

    // Sign with secp256k1 - get recovered format (65 bytes: r + s + recovery)
    const sigBytes = await secp256k1.signAsync(txHash, privKeyBytes, {
        lowS: true,
        prehash: false,
        format: 'recovered'
    });

    // Parse signature using Signature class for proper handling
    const sig = Signature.fromBytes(sigBytes, 'recovered');
    const r = sig.r;
    const s = sig.s;
    const v = sig.recovery ?? 0; // Recovery bit (0 or 1) for EIP-1559 type 2 transactions

    // Debug logging
    console.log(JSON.stringify({
        at: 'sign_debug',
        sigBytesLength: sigBytes.length,
        r: r.toString(16).substring(0, 16) + '...',
        s: s.toString(16).substring(0, 16) + '...',
        v: v,
        hasRecovery: sig.recovery !== undefined,
    }));

    // Create signed transaction
    return serializeEIP1559Tx(params, { v, r, s });
}

function getAddressFromPrivateKey(privateKey: string): string {
    const privKeyBytes = hexToBytes(privateKey);
    const publicKey = secp256k1.getPublicKey(privKeyBytes, false);
    // Skip the 0x04 prefix for uncompressed key
    const addressBytes = keccak256(publicKey.slice(1)).slice(-20);
    return bytesToHex(addressBytes);
}

// ============================================================================
// Polygon Provider
// ============================================================================

export class PolygonProvider implements ChainProvider {
    readonly config: ChainConfig;

    constructor(rpcUrl: string) {
        this.config = {
            ...CHAIN_CONFIGS.polygon,
            rpcUrl,
        };
    }

    private async rpcCall<T>(method: string, params: unknown[]): Promise<T> {
        const response = await fetch(this.config.rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                jsonrpc: '2.0',
                id: Date.now(),
                method,
                params,
            }),
        });

        if (!response.ok) {
            throw new Error(`RPC request failed: ${response.status}`);
        }

        const data = await response.json() as { result?: T; error?: { message: string; code?: number } };

        if (data.error) {
            throw new Error(`RPC error: ${data.error.message}`);
        }

        return data.result as T;
    }

    async submitAnchor(rootHash: string, privateKey: string): Promise<TransactionResult> {
        // Derive sender address
        const fromAddress = getAddressFromPrivateKey(privateKey);

        // Prepare anchor data - embed root hash in transaction data
        // Format: 0x + "TATTLEHASH:" prefix + root hash (for easy identification)
        const prefix = new TextEncoder().encode('TATTLEHASH:');
        const rootBytes = hexToBytes(rootHash);
        const dataBytes = new Uint8Array(prefix.length + rootBytes.length);
        dataBytes.set(prefix, 0);
        dataBytes.set(rootBytes, prefix.length);
        const data = bytesToHex(dataBytes);

        // Get current chain state
        const [nonce, gasPrice] = await Promise.all([
            this.getTransactionCount(fromAddress),
            this.getGasPrice(),
        ]);

        // Estimate gas (base tx + data bytes)
        const gasEstimate = await this.estimateGas(
            { to: fromAddress, data, value: '0x0' },
            fromAddress
        );
        const gasLimit = BigInt(gasEstimate) * 120n / 100n; // 20% buffer

        // Build and sign transaction
        const txParams: EIP1559TxParams = {
            chainId: this.config.networkId,
            nonce,
            maxPriorityFeePerGas: BigInt(gasPrice.maxPriorityFeePerGas),
            maxFeePerGas: BigInt(gasPrice.maxFeePerGas),
            gasLimit,
            to: fromAddress, // Self-send with data
            value: 0n,
            data,
        };

        const signedTx = await signEIP1559Tx(txParams, privateKey);

        // Submit to network
        const txHash = await this.rpcCall<string>(
            'eth_sendRawTransaction',
            [bytesToHex(signedTx)]
        );

        return {
            txHash,
            chainId: 'polygon',
            submittedAt: Date.now(),
        };
    }

    async getTransactionStatus(txHash: string): Promise<TransactionStatus> {
        const receipt = await this.rpcCall<{
            blockNumber: string;
            blockHash: string;
            status: string;
            gasUsed: string;
        } | null>('eth_getTransactionReceipt', [txHash]);

        if (!receipt) {
            return {
                txHash,
                confirmed: false,
                confirmations: 0,
                reorged: false,
                failed: false,
            };
        }

        const txBlockNumber = parseInt(receipt.blockNumber, 16);
        const currentBlockNumber = await this.getBlockNumber();
        const confirmations = Math.max(0, currentBlockNumber - txBlockNumber + 1);

        // Verify block still exists (reorg check)
        const block = await this.rpcCall<{ hash: string } | null>(
            'eth_getBlockByNumber',
            [receipt.blockNumber, false]
        );
        const reorged = !block || block.hash !== receipt.blockHash;

        return {
            txHash,
            confirmed: confirmations >= this.config.confirmationsRequired,
            confirmations,
            blockNumber: txBlockNumber,
            blockHash: receipt.blockHash,
            reorged,
            failed: receipt.status === '0x0',
            gasUsed: receipt.gasUsed,
        };
    }

    async getBlockNumber(): Promise<number> {
        const result = await this.rpcCall<string>('eth_blockNumber', []);
        return parseInt(result, 16);
    }

    async getTransactionCount(address: string): Promise<number> {
        const result = await this.rpcCall<string>(
            'eth_getTransactionCount',
            [address, 'pending']
        );
        return parseInt(result, 16);
    }

    async estimateGas(tx: AnchorTransaction, from: string): Promise<string> {
        try {
            const result = await this.rpcCall<string>('eth_estimateGas', [{
                from,
                to: tx.to,
                data: tx.data,
                value: tx.value || '0x0',
            }]);
            return result;
        } catch {
            // Default: 21000 base + 16 gas per non-zero byte + 4 per zero byte
            const dataBytes = hexToBytes(tx.data || '0x');
            let dataGas = 0n;
            for (const byte of dataBytes) {
                dataGas += byte === 0 ? 4n : 16n;
            }
            return numberToHex(21000n + dataGas);
        }
    }

    async getGasPrice(): Promise<{ maxFeePerGas: string; maxPriorityFeePerGas: string }> {
        try {
            const [block, priorityFee] = await Promise.all([
                this.rpcCall<{ baseFeePerGas: string }>('eth_getBlockByNumber', ['latest', false]),
                this.rpcCall<string>('eth_maxPriorityFeePerGas', []).catch(() => '0x6fc23ac00'), // 30 gwei
            ]);

            const baseFee = BigInt(block.baseFeePerGas);
            const priority = BigInt(priorityFee);

            // maxFee = 2 * baseFee + priorityFee (buffer for base fee increases)
            const maxFee = baseFee * 2n + priority;

            return {
                maxFeePerGas: numberToHex(maxFee),
                maxPriorityFeePerGas: numberToHex(priority),
            };
        } catch {
            // Fallback: use legacy gas price
            const gasPrice = await this.rpcCall<string>('eth_gasPrice', []);
            return {
                maxFeePerGas: gasPrice,
                maxPriorityFeePerGas: '0x6fc23ac00', // 30 gwei
            };
        }
    }
}

/**
 * Create a Polygon chain provider.
 */
export function createPolygonProvider(rpcUrl: string): ChainProvider {
    return new PolygonProvider(rpcUrl);
}
