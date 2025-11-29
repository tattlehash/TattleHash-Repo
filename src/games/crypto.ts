/**
 * Cryptographic utilities for commit-reveal protocol.
 *
 * The commit-reveal protocol ensures fairness:
 * 1. Player generates random seed
 * 2. Player creates hash of seed:choice (commitment)
 * 3. Player sends commitment to server
 * 4. After all commitments received, players reveal seed+choice
 * 5. Server verifies hash matches, preventing cheating
 */

import type { CommitData } from './types';

/**
 * Generate a cryptographically secure random seed.
 */
export function generateSeed(): string {
    return crypto.randomUUID();
}

/**
 * Calculate SHA-256 hash of input string.
 * Returns lowercase hex string.
 */
export async function sha256Hex(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Create a commitment hash for a choice.
 *
 * For coin toss: hash(seed:)  // empty choice
 * For RPS/duel: hash(seed:choice)
 *
 * @param seed - Random seed (UUID)
 * @param choice - Player's choice (empty for coin toss)
 * @returns Commitment hash
 */
export async function createCommitment(seed: string, choice: string): Promise<string> {
    return sha256Hex(`${seed}:${choice}`);
}

/**
 * Generate complete commit data for a player's choice.
 */
export async function generateCommitData(choice: string): Promise<CommitData> {
    const seed = generateSeed();
    const hash = await createCommitment(seed, choice);
    return { seed, choice, hash };
}

/**
 * Verify that a reveal matches a commitment.
 */
export async function verifyCommitment(
    seed: string,
    choice: string,
    expectedHash: string
): Promise<boolean> {
    const calculatedHash = await createCommitment(seed, choice);
    return calculatedHash === expectedHash;
}

/**
 * Combine seeds and server nonce to create a deterministic random value.
 * Used for games like coin toss where outcome is derived from combined entropy.
 *
 * @param serverNonce - Server-provided nonce for fairness
 * @param seedA - Player A's revealed seed
 * @param seedB - Player B's revealed seed
 * @returns A deterministic hash that both parties can verify
 */
export async function combinedEntropy(
    serverNonce: string,
    seedA: string,
    seedB: string
): Promise<string> {
    return sha256Hex(`${serverNonce}:${seedA}:${seedB}`);
}

/**
 * Derive a number from a hash for pick-a-number games.
 * Returns a number between min and max (inclusive).
 */
export function hashToNumber(hash: string, min: number, max: number): number {
    // Use first 8 hex chars (32 bits) for number derivation
    const slice = hash.slice(0, 8);
    const num = parseInt(slice, 16);
    const range = max - min + 1;
    return min + (num % range);
}

/**
 * Determine coin flip result from combined entropy.
 * Returns 'heads' if first byte is even, 'tails' if odd.
 */
export function hashToCoinFlip(hash: string): 'heads' | 'tails' {
    const firstByte = parseInt(hash.slice(0, 2), 16);
    return firstByte % 2 === 0 ? 'heads' : 'tails';
}
