
import { keccak_256 } from '@noble/hashes/sha3.js';

export function keccak256(data: string | Uint8Array): Uint8Array {
    const input = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data;
    return keccak_256(input);
}

export async function sha256(data: string | Uint8Array): Promise<Uint8Array> {
    const input = typeof data === 'string'
        ? new TextEncoder().encode(data)
        : data;
    const buffer = await globalThis.crypto.subtle.digest('SHA-256', input as any);
    return new Uint8Array(buffer);
}
