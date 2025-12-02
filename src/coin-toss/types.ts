/**
 * Coin Toss Types for Gatekeeper Fee-Split
 *
 * Determines which party sponsors (pays) the attestation fee through
 * a provably fair coin toss using the blockchain anchor block hash.
 */

import { z } from 'zod';

// ============================================================================
// Fee Arrangement Options
// ============================================================================

/**
 * Fee arrangement options for Gatekeeper/Enforced attestations.
 */
export type FeeArrangement = 'creator_pays' | 'counterparty_pays' | 'split' | 'coin_toss';

export const FeeArrangementSchema = z.enum(['creator_pays', 'counterparty_pays', 'split', 'coin_toss']);

// ============================================================================
// Coin Toss Types
// ============================================================================

/**
 * Coin side options.
 */
export type CoinSide = 'heads' | 'tails';

export const CoinSideSchema = z.enum(['heads', 'tails']);

/**
 * Coin toss status.
 */
export type CoinTossStatus = 'pending' | 'waiting_counterparty' | 'ready' | 'flipped' | 'cancelled';

export const CoinTossStatusSchema = z.enum(['pending', 'waiting_counterparty', 'ready', 'flipped', 'cancelled']);

/**
 * Party identifier for coin toss.
 */
export type CoinTossParty = 'creator' | 'counterparty';

// ============================================================================
// Coin Toss Data Structure
// ============================================================================

/**
 * Coin toss configuration and result.
 * Stored in KV with key: `coin-toss:{challenge_id}`
 */
export interface CoinTossData {
    /** Challenge ID this coin toss belongs to */
    challenge_id: string;

    /** Current status */
    status: CoinTossStatus;

    /** Creator's call (heads or tails) */
    creator_call: CoinSide;

    /** Counterparty's call (always opposite of creator) */
    counterparty_call: CoinSide;

    /** Fee amount in cents */
    fee_amount_cents: number;

    // --- Populated after flip ---

    /** Block hash used for randomness (from anchor transaction) */
    block_hash?: string;

    /** Block number of anchor transaction */
    block_number?: number;

    /** The result of the flip */
    result?: CoinSide;

    /** Who is sponsoring (paying) the fee */
    sponsor?: CoinTossParty;

    /** Who is being sponsored (fee waived) */
    sponsored_party?: CoinTossParty;

    // --- Timestamps ---

    /** When the coin toss was created */
    created_at: number;

    /** When counterparty accepted */
    accepted_at?: number;

    /** When the coin was flipped */
    flipped_at?: number;
}

/**
 * Coin toss result for verification.
 */
export interface CoinTossVerification {
    /** Is the recorded result valid? */
    valid: boolean;

    /** Inputs used for verification */
    inputs: {
        block_hash: string;
        block_number: number;
    };

    /** Computation details */
    computation: {
        /** First byte of block hash (hex) */
        first_byte_hex: string;
        /** First byte as integer */
        first_byte_int: number;
        /** Result of modulo 2 */
        modulo_2: number;
        /** Computed result */
        computed_result: CoinSide;
    };

    /** Recorded result */
    recorded_result: CoinSide;

    /** Do computed and recorded match? */
    match: boolean;
}

// ============================================================================
// Request/Response Schemas
// ============================================================================

/**
 * Schema for initiating coin toss (when creating challenge with coin_toss fee arrangement).
 */
export const InitCoinTossSchema = z.object({
    /** Creator's call */
    creator_call: CoinSideSchema,
});

export type InitCoinTossInput = z.infer<typeof InitCoinTossSchema>;

/**
 * Response after coin toss result is computed.
 */
export interface CoinTossResultResponse {
    /** The result of the flip */
    result: CoinSide;

    /** Who is sponsoring (paying) */
    sponsor: CoinTossParty;

    /** Who is being sponsored (fee waived) */
    sponsored_party: CoinTossParty;

    /** Fee amount the sponsor pays */
    fee_amount_cents: number;

    /** Block hash used for randomness */
    block_hash: string;

    /** Block number */
    block_number: number;

    /** Verification URL */
    verification_url: string;
}

// ============================================================================
// Constants
// ============================================================================

/**
 * Default fee for Gatekeeper attestations in cents.
 * 6 credits at $4.99 each = $29.94
 */
export const GATEKEEPER_FEE_CENTS = 2994;

/**
 * KV key prefix for coin toss data.
 */
export const COIN_TOSS_KV_PREFIX = 'coin-toss:';

/**
 * TTL for coin toss data in KV (30 days).
 */
export const COIN_TOSS_TTL_SECONDS = 30 * 24 * 60 * 60;
