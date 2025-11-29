
import * as secp256k1 from '@noble/secp256k1';
import { keccak256 } from '../../utils/crypto';

export async function recoverAddressFromSignature(
    message: string,
    signature: string
): Promise<string> {
    // EIP-191: Prepend the Ethereum signed message prefix
    const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
    const prefixedMessage = prefix + message;

    // Hash the prefixed message
    const messageHash = keccak256(prefixedMessage);

    // Parse signature components
    const sig = parseSignature(signature);

    // Construct 65-byte signature (r + s + v)
    const signatureBytes = new Uint8Array(65);
    signatureBytes.set(sig.r, 0);
    signatureBytes.set(sig.s, 32);
    signatureBytes.set([sig.v - 27], 64);

    // Recover public key using @noble/secp256k1
    const publicKey = await secp256k1.recoverPublicKey(
        messageHash,
        signatureBytes
    );

    // Derive address from public key
    const address = publicKeyToAddress(publicKey);

    return address;
}

interface SignatureComponents {
    r: Uint8Array;
    s: Uint8Array;
    v: number;
}

function parseSignature(signature: string): SignatureComponents {
    // Remove 0x prefix if present
    const sig = signature.startsWith('0x') ? signature.slice(2) : signature;

    if (sig.length !== 130) {
        throw new Error(`Invalid signature length: ${sig.length}`);
    }

    const r = hexToBytes(sig.slice(0, 64));
    const s = hexToBytes(sig.slice(64, 128));
    let v = parseInt(sig.slice(128, 130), 16);

    // Handle legacy v values
    if (v < 27) {
        v += 27;
    }

    return { r, s, v };
}

function hexToBytes(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

function publicKeyToAddress(publicKey: Uint8Array): string {
    // Remove the 04 prefix if present (uncompressed key marker)
    const key = publicKey[0] === 0x04 ? publicKey.slice(1) : publicKey;

    // Keccak256 hash of the public key
    const hash = keccak256(key);

    // Take last 20 bytes
    const addressBytes = hash.slice(-20);

    // Convert to hex with 0x prefix
    return '0x' + bytesToHex(addressBytes);
}
