
import { describe, it, expect } from 'vitest';
import { ERRORS, createError } from '../src/errors';
import { getFlag } from '../src/lib/flags';
import { WalletChallengeSchema } from '../src/utils/validation';

describe('Foundation', () => {
    describe('Error Taxonomy', () => {
        it('error codes are unique', () => {
            const codes = Object.values(ERRORS).map(e => e.code);
            const uniqueCodes = new Set(codes);
            expect(uniqueCodes.size).toBe(codes.length);
        });

        it('createError returns correct structure', () => {
            const err = createError('NOT_FOUND', { id: '123' });
            expect(err.code).toBe('NOT_FOUND');
            expect(err.status).toBe(404);
            expect(err.details).toEqual({ id: '123' });
            expect(err.message).toBe('Resource not found');
        });
    });

    describe('Feature Flags', () => {
        it('returns true for "true" string', () => {
            expect(getFlag('TEST_FLAG', { TEST_FLAG: 'true' })).toBe(true);
        });

        it('returns true for true boolean', () => {
            expect(getFlag('TEST_FLAG', { TEST_FLAG: true })).toBe(true);
        });

        it('returns false for "false" string', () => {
            expect(getFlag('TEST_FLAG', { TEST_FLAG: 'false' })).toBe(false);
        });

        it('returns false for undefined', () => {
            expect(getFlag('TEST_FLAG', {})).toBe(false);
        });
    });

    describe('Validation Schemas', () => {
        it('validates correct wallet challenge', () => {
            const valid = {
                wallet_address: '0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00',
                chain_id: 'eip155:1'
            };
            const result = WalletChallengeSchema.safeParse(valid);
            expect(result.success).toBe(true);
        });

        it('rejects invalid wallet address', () => {
            const invalid = {
                wallet_address: 'not-an-address',
                chain_id: 'eip155:1'
            };
            const result = WalletChallengeSchema.safeParse(invalid);
            expect(result.success).toBe(false);
        });
    });
});
