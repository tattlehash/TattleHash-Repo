/**
 * User service for managing user accounts.
 * Users are created automatically on first wallet verification.
 */

import { queryOne, execute } from '../db';
import type { Env } from '../types';

export interface User {
    id: string;
    wallet_address: string;
    created_at: number;
    updated_at: number;
}

/**
 * Get a user by their ID.
 */
export async function getUserById(
    env: Env,
    userId: string
): Promise<User | null> {
    return queryOne<User>(
        env.TATTLEHASH_DB,
        'SELECT id, wallet_address, created_at, updated_at FROM users WHERE id = ?',
        [userId]
    );
}

/**
 * Get a user by their wallet address.
 */
export async function getUserByWallet(
    env: Env,
    walletAddress: string
): Promise<User | null> {
    const normalizedAddress = walletAddress.toLowerCase();
    return queryOne<User>(
        env.TATTLEHASH_DB,
        'SELECT id, wallet_address, created_at, updated_at FROM users WHERE wallet_address = ?',
        [normalizedAddress]
    );
}

/**
 * Create a new user with the given wallet address.
 * Returns the created user.
 */
export async function createUser(
    env: Env,
    walletAddress: string
): Promise<User> {
    const normalizedAddress = walletAddress.toLowerCase();
    const now = Date.now();
    const id = crypto.randomUUID();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO users (id, wallet_address, created_at, updated_at)
         VALUES (?, ?, ?, ?)`,
        [id, normalizedAddress, now, now]
    );

    return {
        id,
        wallet_address: normalizedAddress,
        created_at: now,
        updated_at: now,
    };
}

/**
 * Get or create a user for the given wallet address.
 * This is the main entry point for user creation during authentication.
 */
export async function getOrCreateUser(
    env: Env,
    walletAddress: string
): Promise<{ user: User; created: boolean }> {
    const existing = await getUserByWallet(env, walletAddress);

    if (existing) {
        return { user: existing, created: false };
    }

    const user = await createUser(env, walletAddress);
    return { user, created: true };
}

/**
 * Update user's updated_at timestamp.
 */
export async function touchUser(
    env: Env,
    userId: string
): Promise<void> {
    const now = Date.now();
    await execute(
        env.TATTLEHASH_DB,
        'UPDATE users SET updated_at = ? WHERE id = ?',
        [now, userId]
    );
}
