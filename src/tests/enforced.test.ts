/**
 * Enforced Mode Tests
 *
 * Comprehensive tests for full escrow transactions with
 * stakes, thresholds, and traffic light verification.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    createEnforcedChallenge,
    depositEnforcedStake,
    acceptEnforcedChallenge,
    completeEnforcedChallenge,
    raiseEnforcedDispute,
    resolveEnforcedDispute,
    handleEnforcedTimeout,
    getEnforcedChallengeStatus,
} from '../gatekeeper/modes/enforced';
import {
    createStake,
    confirmStakeDeposit,
    lockStake,
    releaseStake,
    slashStake,
    createThreshold,
    validateStakeAmount,
    isChainAllowed,
    isAssetAllowed,
} from '../gatekeeper/stakes';
import {
    evaluateTrafficLight,
    isGreen,
    isRed,
    canProceed,
} from '../gatekeeper/stakes/traffic-light';
import type { Challenge } from '../gatekeeper/challenges/types';
import type { CreateEnforcedChallengeInput } from '../gatekeeper/stakes/types';
import { Env } from '../types';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockEnv(): Env {
    const mockDb = {
        prepare: vi.fn().mockReturnThis(),
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
        run: vi.fn().mockResolvedValue({ success: true }),
    };
    const mockKv = {
        put: vi.fn().mockResolvedValue(undefined),
        get: vi.fn().mockResolvedValue(null),
        delete: vi.fn().mockResolvedValue(undefined),
    };

    return {
        TATTLEHASH_DB: mockDb,
        GATE_KV: mockKv,
        ENFORCED_MODE_ENABLED: 'true',
    } as any;
}

function createMockChallenge(overrides: Partial<Challenge> = {}): Challenge {
    return {
        id: 'test-challenge-id',
        mode: 'ENFORCED',
        creator_user_id: 'creator-123',
        counterparty_user_id: 'counterparty-456',
        title: 'Test Enforced Challenge',
        status: 'DRAFT',
        created_at: Date.now(),
        updated_at: Date.now(),
        ...overrides,
    };
}

function createMockEnforcedInput(): CreateEnforcedChallengeInput {
    return {
        title: 'P2P BTC/ETH Trade',
        description: 'Trading 1 BTC for 15 ETH',
        counterparty_user_id: 'counterparty-456',
        accept_timeout_seconds: 900,
        response_timeout_seconds: 86400,
        dispute_timeout_seconds: 259200,
        thresholds: {
            min_usd_value: '1000.00',
            max_usd_value: '50000.00',
            required_confirmations: 12,
            allowed_chains: ['eip155:1', 'eip155:137'],
            allowed_assets: ['ETH', 'USDC', 'USDT'],
        },
        stakes: {
            creator_stake: '1000000000000000000', // 1 ETH in wei
            counterparty_stake: '1000000000000000000',
            stake_currency: 'ETH',
        },
    };
}

// ============================================================================
// Stake Validation Tests
// ============================================================================

describe('Stake Validation', () => {
    describe('validateStakeAmount', () => {
        it('should pass when amount equals required', () => {
            const result = validateStakeAmount('1000000000000000000', '1000000000000000000');
            expect(result.valid).toBe(true);
            expect(result.deficit).toBe('0');
        });

        it('should pass when amount exceeds required', () => {
            const result = validateStakeAmount('2000000000000000000', '1000000000000000000');
            expect(result.valid).toBe(true);
        });

        it('should fail when amount is less than required', () => {
            const result = validateStakeAmount('500000000000000000', '1000000000000000000');
            expect(result.valid).toBe(false);
            expect(result.deficit).toBe('500000000000000000');
        });

        it('should handle zero required amount', () => {
            const result = validateStakeAmount('0', '0');
            expect(result.valid).toBe(true);
        });

        it('should handle large numbers correctly', () => {
            const result = validateStakeAmount(
                '115792089237316195423570985008687907853269984665640564039457584007913129639935',
                '115792089237316195423570985008687907853269984665640564039457584007913129639935'
            );
            expect(result.valid).toBe(true);
        });
    });

    describe('isChainAllowed', () => {
        const allowedChains = ['eip155:1', 'eip155:137', 'eip155:42161'];

        it('should return true for allowed chain', () => {
            expect(isChainAllowed('eip155:1', allowedChains)).toBe(true);
            expect(isChainAllowed('eip155:137', allowedChains)).toBe(true);
        });

        it('should return false for disallowed chain', () => {
            expect(isChainAllowed('eip155:56', allowedChains)).toBe(false);
            expect(isChainAllowed('solana:mainnet', allowedChains)).toBe(false);
        });

        it('should handle empty allowed list', () => {
            expect(isChainAllowed('eip155:1', [])).toBe(false);
        });
    });

    describe('isAssetAllowed', () => {
        const allowedAssets = ['ETH', 'USDC', 'USDT'];

        it('should return true for allowed asset (case insensitive)', () => {
            expect(isAssetAllowed('ETH', allowedAssets)).toBe(true);
            expect(isAssetAllowed('eth', allowedAssets)).toBe(true);
            expect(isAssetAllowed('Eth', allowedAssets)).toBe(true);
        });

        it('should return false for disallowed asset', () => {
            expect(isAssetAllowed('BTC', allowedAssets)).toBe(false);
            expect(isAssetAllowed('WBTC', allowedAssets)).toBe(false);
        });
    });
});

// ============================================================================
// Stakes Module Tests
// ============================================================================

describe('Stakes Module', () => {
    let env: Env;
    let mockDb: any;

    beforeEach(() => {
        env = createMockEnv();
        mockDb = env.TATTLEHASH_DB;
    });

    describe('createStake', () => {
        it('should create a stake with PENDING status', async () => {
            const stakeData = {
                challenge_id: 'challenge-123',
                user_id: 'user-456',
                wallet_address: '0x1234567890123456789012345678901234567890',
                amount: '1000000000000000000',
                currency_code: 'ETH',
                chain_id: 'eip155:1',
            };

            // Mock to return created stake
            mockDb.all.mockResolvedValueOnce({
                results: [{
                    id: 'stake-id',
                    ...stakeData,
                    status: 'PENDING',
                    created_at: Date.now(),
                    updated_at: Date.now(),
                }]
            });

            const result = await createStake(env, stakeData);

            expect(mockDb.prepare).toHaveBeenCalledWith(
                expect.stringContaining('INSERT INTO stakes')
            );
            expect(result.status).toBe('PENDING');
        });
    });

    describe('confirmStakeDeposit', () => {
        it('should update stake to CONFIRMED status', async () => {
            const stake = {
                id: 'stake-id',
                challenge_id: 'challenge-123',
                user_id: 'user-456',
                status: 'PENDING',
                amount: '1000000000000000000',
            };

            // Mock getting the stake
            mockDb.all.mockResolvedValueOnce({ results: [stake] });
            // Mock the updated stake
            mockDb.all.mockResolvedValueOnce({
                results: [{
                    ...stake,
                    status: 'CONFIRMED',
                    deposit_tx_hash: '0xabc123',
                    confirmed_at: Date.now(),
                }]
            });

            const result = await confirmStakeDeposit(
                env,
                'stake-id',
                '0xabc123',
                12
            );

            expect(result.status).toBe('CONFIRMED');
        });

        it('should throw if stake not in PENDING status', async () => {
            const stake = {
                id: 'stake-id',
                status: 'CONFIRMED', // Already confirmed
            };

            mockDb.all.mockResolvedValueOnce({ results: [stake] });

            await expect(
                confirmStakeDeposit(env, 'stake-id', '0xabc', 12)
            ).rejects.toMatchObject({
                code: 'VALIDATION_ERROR',
            });
        });
    });

    describe('releaseStake', () => {
        it('should release stake to RELEASED status', async () => {
            const stake = {
                id: 'stake-id',
                status: 'HELD',
            };

            mockDb.all.mockResolvedValueOnce({ results: [stake] });
            mockDb.all.mockResolvedValueOnce({
                results: [{ ...stake, status: 'RELEASED', released_at: Date.now() }]
            });

            const result = await releaseStake(
                env,
                'stake-id',
                'RELEASED',
                undefined,
                'Transaction completed'
            );

            expect(result.status).toBe('RELEASED');
        });

        it('should transfer stake to counterparty on dispute win', async () => {
            const stake = {
                id: 'stake-id',
                status: 'HELD',
            };

            mockDb.all.mockResolvedValueOnce({ results: [stake] });
            mockDb.all.mockResolvedValueOnce({
                results: [{ ...stake, status: 'TRANSFERRED' }]
            });

            const result = await releaseStake(
                env,
                'stake-id',
                'TRANSFERRED',
                '0xtx123',
                'Dispute resolved'
            );

            expect(result.status).toBe('TRANSFERRED');
        });
    });

    describe('slashStake', () => {
        it('should slash stake and set SLASHED status', async () => {
            const stake = {
                id: 'stake-id',
                status: 'HELD',
            };

            mockDb.all.mockResolvedValueOnce({ results: [stake] });
            mockDb.all.mockResolvedValueOnce({
                results: [{ ...stake, status: 'SLASHED' }]
            });

            const result = await slashStake(
                env,
                'stake-id',
                'Dispute resolved against user'
            );

            expect(result.status).toBe('SLASHED');
        });
    });
});

// ============================================================================
// Traffic Light Tests
// ============================================================================

describe('Traffic Light Evaluation', () => {
    let env: Env;
    let mockDb: any;

    beforeEach(() => {
        env = createMockEnv();
        mockDb = env.TATTLEHASH_DB;
    });

    it('should return RED when challenge not found', async () => {
        mockDb.all.mockResolvedValue({ results: [] });

        const result = await evaluateTrafficLight(env, 'nonexistent');

        expect(result.state).toBe('RED');
        expect(result.reason).toContain('not found');
    });

    it('should return RED when not ENFORCED mode', async () => {
        const challenge = createMockChallenge({ mode: 'SOLO' as any });
        mockDb.all.mockResolvedValueOnce({ results: [challenge] });

        const result = await evaluateTrafficLight(env, challenge.id);

        expect(result.state).toBe('RED');
        expect(result.reason).toContain('ENFORCED');
    });

    it('should return YELLOW when stakes are pending', async () => {
        const challenge = createMockChallenge();
        const threshold = {
            id: 'threshold-id',
            challenge_id: challenge.id,
            creator_stake_required: '1000000000000000000',
            counterparty_stake_required: '1000000000000000000',
            required_confirmations: 12,
            allowed_chains: '["eip155:1"]',
            allowed_assets: '["ETH"]',
            min_usd_value: '1000',
        };

        mockDb.all
            .mockResolvedValueOnce({ results: [challenge] }) // getChallengeById
            .mockResolvedValueOnce({ results: [threshold] }) // getThresholdByChallenge
            .mockResolvedValueOnce({ results: [] }); // getStakesByChallenge (no stakes)

        const result = await evaluateTrafficLight(env, challenge.id);

        expect(result.state).toBe('YELLOW');
        expect(result.details.creatorStake.status).toBe('PENDING');
        expect(result.details.counterpartyStake.status).toBe('PENDING');
    });

    it('should return GREEN when all stakes confirmed', async () => {
        const challenge = createMockChallenge();
        const threshold = {
            id: 'threshold-id',
            challenge_id: challenge.id,
            creator_stake_required: '1000000000000000000',
            counterparty_stake_required: '1000000000000000000',
            required_confirmations: 12,
            allowed_chains: '["eip155:1"]',
            allowed_assets: '["ETH"]',
            min_usd_value: '1000',
        };
        const creatorStake = {
            id: 'stake-1',
            challenge_id: challenge.id,
            user_id: 'creator-123',
            amount: '1000000000000000000',
            status: 'CONFIRMED',
        };
        const counterpartyStake = {
            id: 'stake-2',
            challenge_id: challenge.id,
            user_id: 'counterparty-456',
            amount: '1000000000000000000',
            status: 'CONFIRMED',
        };

        mockDb.all
            .mockResolvedValueOnce({ results: [challenge] })
            .mockResolvedValueOnce({ results: [threshold] })
            .mockResolvedValueOnce({ results: [creatorStake, counterpartyStake] });

        const result = await evaluateTrafficLight(env, challenge.id);

        expect(result.state).toBe('GREEN');
        expect(result.details.thresholdsMet).toBe(true);
    });

    it('should return RED when stake is slashed', async () => {
        const challenge = createMockChallenge();
        const threshold = {
            id: 'threshold-id',
            challenge_id: challenge.id,
            creator_stake_required: '1000000000000000000',
            counterparty_stake_required: '1000000000000000000',
            required_confirmations: 12,
            allowed_chains: '["eip155:1"]',
            allowed_assets: '["ETH"]',
            min_usd_value: '1000',
        };
        const creatorStake = {
            id: 'stake-1',
            challenge_id: challenge.id,
            user_id: 'creator-123',
            amount: '1000000000000000000',
            status: 'SLASHED', // Slashed
        };

        mockDb.all
            .mockResolvedValueOnce({ results: [challenge] })
            .mockResolvedValueOnce({ results: [threshold] })
            .mockResolvedValueOnce({ results: [creatorStake] });

        const result = await evaluateTrafficLight(env, challenge.id);

        expect(result.state).toBe('RED');
        expect(result.details.creatorStake.status).toBe('FAILED');
    });

    it('should flag expiring deals', async () => {
        const challenge = createMockChallenge();
        const soonExpiry = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 min
        const threshold = {
            id: 'threshold-id',
            challenge_id: challenge.id,
            creator_stake_required: '0',
            counterparty_stake_required: '0',
            required_confirmations: 12,
            allowed_chains: '["eip155:1"]',
            allowed_assets: '["ETH"]',
            min_usd_value: '1000',
            deal_expiry_at: soonExpiry,
        };

        mockDb.all
            .mockResolvedValueOnce({ results: [challenge] })
            .mockResolvedValueOnce({ results: [threshold] })
            .mockResolvedValueOnce({ results: [] });

        const result = await evaluateTrafficLight(env, challenge.id);

        expect(result.details.flags).toContain('Less than 1 hour until deal expiry');
    });
});

// ============================================================================
// Enforced Challenge Flow Tests
// ============================================================================

describe('Enforced Challenge Flow', () => {
    let env: Env;
    let mockDb: any;
    let mockKv: any;

    beforeEach(() => {
        env = createMockEnv();
        mockDb = env.TATTLEHASH_DB;
        mockKv = env.GATE_KV;
    });

    describe('createEnforcedChallenge', () => {
        it('should create challenge with thresholds and config', async () => {
            const input = createMockEnforcedInput();
            const creatorId = 'creator-123';

            // Mock challenge creation
            const createdChallenge = createMockChallenge({ status: 'DRAFT' });
            const createdThreshold = {
                id: 'threshold-id',
                challenge_id: createdChallenge.id,
                min_usd_value: input.thresholds.min_usd_value,
                creator_stake_required: input.stakes.creator_stake,
                counterparty_stake_required: input.stakes.counterparty_stake,
                allowed_chains: JSON.stringify(input.thresholds.allowed_chains),
                allowed_assets: JSON.stringify(input.thresholds.allowed_assets),
                required_confirmations: 12,
            };

            // Mock all database calls
            mockDb.all
                .mockResolvedValueOnce({ results: [createdThreshold] }) // createThreshold
                .mockResolvedValueOnce({ results: [createdChallenge] }) // getChallengeById
                // Traffic light evaluation
                .mockResolvedValueOnce({ results: [createdChallenge] })
                .mockResolvedValueOnce({ results: [createdThreshold] })
                .mockResolvedValueOnce({ results: [] }); // No stakes yet

            const result = await createEnforcedChallenge(env, input, creatorId);

            expect(result.challenge.mode).toBe('ENFORCED');
            expect(result.challenge.status).toBe('DRAFT');
            expect(result.thresholds.min_usd_value).toBe('1000.00');
            expect(result.trafficLight.state).toBe('YELLOW'); // No stakes yet
        });
    });

    describe('depositEnforcedStake', () => {
        it('should reject deposit from non-participant', async () => {
            const challenge = createMockChallenge();
            mockDb.all.mockResolvedValueOnce({ results: [challenge] });

            await expect(
                depositEnforcedStake(env, challenge.id, 'random-user', {
                    wallet_address: '0x1234567890123456789012345678901234567890',
                    chain_id: 'eip155:1',
                    tx_hash: '0x' + 'a'.repeat(64),
                    amount: '1000000000000000000',
                    currency_code: 'ETH',
                })
            ).rejects.toMatchObject({
                code: 'FORBIDDEN',
            });
        });

        it('should reject deposit on wrong chain', async () => {
            const challenge = createMockChallenge();
            const threshold = {
                challenge_id: challenge.id,
                allowed_chains: '["eip155:1"]', // Only mainnet
                allowed_assets: '["ETH"]',
                creator_stake_required: '1000000000000000000',
                counterparty_stake_required: '1000000000000000000',
            };

            mockDb.all
                .mockResolvedValueOnce({ results: [challenge] })
                .mockResolvedValueOnce({ results: [threshold] });

            await expect(
                depositEnforcedStake(env, challenge.id, 'creator-123', {
                    wallet_address: '0x1234567890123456789012345678901234567890',
                    chain_id: 'eip155:56', // BSC - not allowed
                    tx_hash: '0x' + 'a'.repeat(64),
                    amount: '1000000000000000000',
                    currency_code: 'ETH',
                })
            ).rejects.toMatchObject({
                code: 'VALIDATION_ERROR',
            });
        });

        it('should reject insufficient stake amount', async () => {
            const challenge = createMockChallenge();
            const threshold = {
                challenge_id: challenge.id,
                allowed_chains: '["eip155:1"]',
                allowed_assets: '["ETH"]',
                creator_stake_required: '1000000000000000000', // 1 ETH required
                counterparty_stake_required: '1000000000000000000',
            };

            mockDb.all
                .mockResolvedValueOnce({ results: [challenge] })
                .mockResolvedValueOnce({ results: [threshold] })
                .mockResolvedValueOnce({ results: [] }); // No existing stake

            await expect(
                depositEnforcedStake(env, challenge.id, 'creator-123', {
                    wallet_address: '0x1234567890123456789012345678901234567890',
                    chain_id: 'eip155:1',
                    tx_hash: '0x' + 'a'.repeat(64),
                    amount: '500000000000000000', // Only 0.5 ETH
                    currency_code: 'ETH',
                })
            ).rejects.toMatchObject({
                code: 'FUNDS_INSUFFICIENT',
            });
        });
    });

    describe('acceptEnforcedChallenge', () => {
        it('should reject acceptance when traffic light is RED', async () => {
            const challenge = createMockChallenge({ status: 'AWAITING_COUNTERPARTY' });

            // Mock challenge lookup and config
            mockDb.all
                .mockResolvedValueOnce({ results: [challenge] }) // getChallengeById
                .mockResolvedValueOnce({ results: [{ accept_timeout_seconds: 900 }] }) // config
                .mockResolvedValueOnce({ results: [challenge] }) // updated challenge
                // canProceed evaluation
                .mockResolvedValueOnce({ results: [challenge] })
                .mockResolvedValueOnce({ results: [] }) // No threshold
            ;

            await expect(
                acceptEnforcedChallenge(env, challenge.id, 'counterparty-456')
            ).rejects.toMatchObject({
                code: 'VALIDATION_ERROR',
            });
        });

        it('should reject acceptance from wrong user', async () => {
            const challenge = createMockChallenge({ status: 'AWAITING_COUNTERPARTY' });
            mockDb.all.mockResolvedValueOnce({ results: [challenge] });

            await expect(
                acceptEnforcedChallenge(env, challenge.id, 'wrong-user')
            ).rejects.toMatchObject({
                code: 'CHALLENGE_NOT_COUNTERPARTY',
            });
        });
    });

    describe('raiseEnforcedDispute', () => {
        it('should allow dispute from INTENT_LOCKED status', async () => {
            const challenge = createMockChallenge({ status: 'INTENT_LOCKED' });

            mockDb.all
                .mockResolvedValueOnce({ results: [challenge] })
                .mockResolvedValueOnce({ results: [{ ...challenge, status: 'DISPUTED' }] });

            const result = await raiseEnforcedDispute(
                env,
                challenge.id,
                'creator-123',
                'Counterparty did not deliver',
                { screenshots: ['url1', 'url2'] }
            );

            expect(result.status).toBe('DISPUTED');
        });

        it('should reject dispute from wrong status', async () => {
            const challenge = createMockChallenge({ status: 'DRAFT' });
            mockDb.all.mockResolvedValueOnce({ results: [challenge] });

            await expect(
                raiseEnforcedDispute(env, challenge.id, 'creator-123', 'Reason')
            ).rejects.toMatchObject({
                code: 'VALIDATION_ERROR',
            });
        });
    });

    describe('resolveEnforcedDispute', () => {
        it('should release winner stake and slash loser stake', async () => {
            const challenge = createMockChallenge({
                status: 'DISPUTED',
                creator_user_id: 'creator-123',
                counterparty_user_id: 'counterparty-456',
            });
            const creatorStake = {
                id: 'stake-1',
                challenge_id: challenge.id,
                user_id: 'creator-123',
                status: 'HELD',
            };
            const counterpartyStake = {
                id: 'stake-2',
                challenge_id: challenge.id,
                user_id: 'counterparty-456',
                status: 'HELD',
            };

            mockDb.all
                .mockResolvedValueOnce({ results: [challenge] }) // getChallengeById
                .mockResolvedValueOnce({ results: [creatorStake, counterpartyStake] }) // getStakesByChallenge
                // releaseStake calls
                .mockResolvedValueOnce({ results: [creatorStake] }) // getStakeById
                .mockResolvedValueOnce({ results: [{ ...creatorStake, status: 'RELEASED' }] })
                // slashStake calls
                .mockResolvedValueOnce({ results: [counterpartyStake] })
                .mockResolvedValueOnce({ results: [{ ...counterpartyStake, status: 'SLASHED' }] })
                // Final challenge
                .mockResolvedValueOnce({ results: [{ ...challenge, status: 'COMPLETED' }] })
                // Traffic light eval
                .mockResolvedValueOnce({ results: [{ ...challenge, status: 'COMPLETED' }] })
                .mockResolvedValueOnce({ results: [] })
                .mockResolvedValueOnce({ results: [] });

            const result = await resolveEnforcedDispute(
                env,
                challenge.id,
                'creator-123', // Winner
                'Evidence shows creator fulfilled obligations'
            );

            expect(result.challenge.status).toBe('COMPLETED');
        });
    });
});

// ============================================================================
// Timeout Tests
// ============================================================================

describe('Enforced Mode Timeouts', () => {
    let env: Env;
    let mockDb: any;

    beforeEach(() => {
        env = createMockEnv();
        mockDb = env.TATTLEHASH_DB;
    });

    it('should expire challenge when accept timeout exceeded', async () => {
        const expiredChallenge = createMockChallenge({
            status: 'AWAITING_COUNTERPARTY',
            expires_at: new Date(Date.now() - 1000).toISOString(), // Expired 1 second ago
        });

        mockDb.all
            .mockResolvedValueOnce({ results: [expiredChallenge] })
            .mockResolvedValueOnce({
                results: [{
                    accept_timeout_seconds: 900,
                    response_timeout_seconds: 86400,
                    dispute_timeout_seconds: 259200,
                }]
            })
            .mockResolvedValueOnce({ results: [{ ...expiredChallenge, status: 'EXPIRED' }] })
            .mockResolvedValueOnce({ results: [] }); // No stakes

        const result = await handleEnforcedTimeout(env, expiredChallenge.id);

        expect(result.challenge.status).toBe('EXPIRED');
    });

    it('should release stakes when challenge times out', async () => {
        const expiredChallenge = createMockChallenge({
            status: 'EXPIRED',
        });
        const stake = {
            id: 'stake-1',
            challenge_id: expiredChallenge.id,
            status: 'CONFIRMED',
        };

        mockDb.all
            .mockResolvedValueOnce({ results: [expiredChallenge] })
            .mockResolvedValueOnce({ results: [] }) // No config
            .mockResolvedValueOnce({ results: [stake] }) // getStakesByChallenge
            // releaseStake
            .mockResolvedValueOnce({ results: [stake] })
            .mockResolvedValueOnce({ results: [{ ...stake, status: 'RELEASED' }] });

        const result = await handleEnforcedTimeout(env, expiredChallenge.id);

        expect(result.stakesSlashed).toBe(1);
    });
});

// ============================================================================
// Status Retrieval Tests
// ============================================================================

describe('getEnforcedChallengeStatus', () => {
    let env: Env;
    let mockDb: any;

    beforeEach(() => {
        env = createMockEnv();
        mockDb = env.TATTLEHASH_DB;
    });

    it('should return full status with stakes and thresholds', async () => {
        const challenge = createMockChallenge({ status: 'INTENT_LOCKED' });
        const config = {
            accept_timeout_seconds: 900,
            response_timeout_seconds: 86400,
            dispute_timeout_seconds: 259200,
        };
        const threshold = {
            id: 'threshold-id',
            challenge_id: challenge.id,
            min_usd_value: '1000.00',
            max_usd_value: '50000.00',
            required_confirmations: 12,
            allowed_chains: '["eip155:1", "eip155:137"]',
            allowed_assets: '["ETH", "USDC"]',
            creator_stake_required: '1000000000000000000',
            counterparty_stake_required: '1000000000000000000',
        };
        const creatorStake = {
            id: 'stake-1',
            user_id: 'creator-123',
            status: 'HELD',
            amount: '1000000000000000000',
        };
        const counterpartyStake = {
            id: 'stake-2',
            user_id: 'counterparty-456',
            status: 'HELD',
            amount: '1000000000000000000',
        };

        mockDb.all
            .mockResolvedValueOnce({ results: [challenge] })
            .mockResolvedValueOnce({ results: [config] })
            .mockResolvedValueOnce({ results: [threshold] })
            .mockResolvedValueOnce({ results: [creatorStake, counterpartyStake] })
            // Traffic light eval
            .mockResolvedValueOnce({ results: [challenge] })
            .mockResolvedValueOnce({ results: [threshold] })
            .mockResolvedValueOnce({ results: [creatorStake, counterpartyStake] });

        const status = await getEnforcedChallengeStatus(env, challenge.id);

        expect(status.status).toBe('INTENT_LOCKED');
        expect(status.stakes.creator).toBeTruthy();
        expect(status.stakes.counterparty).toBeTruthy();
        expect(status.thresholds.min_usd_value).toBe('1000.00');
        expect(status.thresholds.allowed_chains).toContain('eip155:1');
    });

    it('should throw for non-ENFORCED challenge', async () => {
        const challenge = createMockChallenge({ mode: 'SOLO' as any });
        mockDb.all.mockResolvedValueOnce({ results: [challenge] });

        await expect(
            getEnforcedChallengeStatus(env, challenge.id)
        ).rejects.toMatchObject({
            code: 'VALIDATION_ERROR',
        });
    });
});
