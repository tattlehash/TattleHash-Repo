
import { z } from 'zod';

export const WalletAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid Ethereum address');

export const ChainIdSchema = z.string().min(1, 'Chain ID is required');

export const WalletChallengeSchema = z.object({
    wallet_address: WalletAddressSchema,
    chain_id: ChainIdSchema,
});

export const WalletVerifySchema = z.object({
    challenge_id: z.string().uuid('Invalid challenge ID'),
    signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/, 'Invalid signature format'),
});

export const FundsCheckSchema = z.object({
    wallet_address: WalletAddressSchema,
    network: z.string().min(1, 'Network is required'),
    asset_type: z.enum(['NATIVE', 'ERC20']),
    min_balance: z.string().regex(/^\d+$/, 'Must be a positive integer string'),
    token_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
    challenge_id: z.string().uuid().optional(),
    user_id: z.string().optional(),
});

const GatekeeperRequirementSchema = z.object({
    wallet_address: WalletAddressSchema,
    network: z.string().min(1),
    funds_checks: z.array(z.object({
        asset_type: z.enum(['NATIVE', 'ERC20']),
        token_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional(),
        min_balance: z.string().regex(/^\d+$/),
        currency_symbol: z.string().min(1),
    })).optional(),
});

export const CreateChallengeSchema = z.object({
    mode: z.enum(['SOLO', 'GATEKEEPER', 'FIRE', 'ENFORCED']),
    title: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    content_hash: z.string().regex(/^[a-fA-F0-9]{64}$/, 'Invalid SHA-256 hash').optional(),
    file_name: z.string().max(255).optional(),
    file_size: z.number().int().positive().optional(),
    counterparty_user_id: z.string().optional(),
    counterparty_email: z.string().email().optional(),
    custom_note: z.string().max(500).optional(),
    expires_at: z.string().optional(),
    fee_arrangement: z.enum(['creator_pays', 'counterparty_pays', 'split', 'coin_toss']).optional(),
    coin_toss_call: z.enum(['heads', 'tails']).optional(),
    gatekeeper_requirements: z.object({
        creator: GatekeeperRequirementSchema.optional(),
        counterparty: GatekeeperRequirementSchema.optional(),
    }).optional(),
});

export const AcceptChallengeSchema = z.object({
    // Future: acceptance message, etc.
});
