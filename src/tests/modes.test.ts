
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSoloMode, completeSoloChallenge } from '../gatekeeper/modes/solo';
import { handleFireMode, depositBond, raiseDispute, resolveDispute } from '../gatekeeper/modes/fire';
import { handleEnforcedMode, checkEnforcedTimeouts, enforceCompletion } from '../gatekeeper/modes/enforced';
import type { Challenge } from '../gatekeeper/challenges/types';
import { Env } from '../types';

function createMockChallenge(overrides: Partial<Challenge> = {}): Challenge {
    return {
        id: 'test-challenge-id',
        mode: 'GATEKEEPER',
        creator_user_id: 'creator-123',
        counterparty_user_id: 'counterparty-456',
        title: 'Test Challenge',
        status: 'DRAFT',
        created_at: Date.now(),
        updated_at: Date.now(),
        ...overrides,
    };
}

describe('Challenge Modes', () => {
    let env: Env;
    let mockDb: any;
    let mockKv: any;

    beforeEach(() => {
        mockDb = {
            prepare: vi.fn().mockReturnThis(),
            bind: vi.fn().mockReturnThis(),
            all: vi.fn().mockResolvedValue({ results: [] }),
            run: vi.fn().mockResolvedValue({ success: true }),
        };
        mockKv = {
            put: vi.fn().mockResolvedValue(undefined),
            get: vi.fn().mockResolvedValue(null),
            delete: vi.fn().mockResolvedValue(undefined),
        };

        env = {
            TATTLEHASH_DB: mockDb,
            GATE_KV: mockKv,
        } as any;
    });

    describe('SOLO Mode', () => {
        describe('handleSoloMode', () => {
            it('should transition SOLO challenge to INTENT_LOCKED immediately', async () => {
                const challenge = createMockChallenge({
                    mode: 'SOLO',
                    counterparty_user_id: undefined, // No counterparty
                    status: 'DRAFT',
                });

                // Mock the database query to return updated challenge
                mockDb.all.mockResolvedValue({
                    results: [{
                        ...challenge,
                        status: 'INTENT_LOCKED',
                        intent_locked_at: Date.now(),
                    }]
                });

                const result = await handleSoloMode(env, challenge);

                expect(mockDb.prepare).toHaveBeenCalledWith(
                    expect.stringContaining('UPDATE challenges')
                );
                expect(result.status).toBe('INTENT_LOCKED');
            });

            it('should throw error if SOLO challenge has counterparty', async () => {
                const challenge = createMockChallenge({
                    mode: 'SOLO',
                    counterparty_user_id: 'counterparty-456', // Has counterparty
                });

                await expect(handleSoloMode(env, challenge)).rejects.toMatchObject({
                    code: 'CHALLENGE_SOLO_NO_COUNTERPARTY',
                });
            });
        });

        describe('completeSoloChallenge', () => {
            it('should complete SOLO challenge when creator calls', async () => {
                const challenge = createMockChallenge({
                    mode: 'SOLO',
                    status: 'INTENT_LOCKED',
                    counterparty_user_id: undefined,
                });

                // Mock getting the challenge
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                // Mock the updated challenge
                mockDb.all.mockResolvedValueOnce({
                    results: [{ ...challenge, status: 'COMPLETED', resolved_at: Date.now() }]
                });

                const result = await completeSoloChallenge(env, challenge.id, challenge.creator_user_id);

                expect(result.status).toBe('COMPLETED');
            });

            it('should throw FORBIDDEN if non-creator tries to complete', async () => {
                const challenge = createMockChallenge({
                    mode: 'SOLO',
                    status: 'INTENT_LOCKED',
                });

                mockDb.all.mockResolvedValue({ results: [challenge] });

                await expect(
                    completeSoloChallenge(env, challenge.id, 'wrong-user')
                ).rejects.toMatchObject({
                    code: 'FORBIDDEN',
                });
            });

            it('should throw VALIDATION_ERROR if challenge not in INTENT_LOCKED', async () => {
                const challenge = createMockChallenge({
                    mode: 'SOLO',
                    status: 'DRAFT', // Not INTENT_LOCKED
                });

                mockDb.all.mockResolvedValue({ results: [challenge] });

                await expect(
                    completeSoloChallenge(env, challenge.id, challenge.creator_user_id)
                ).rejects.toMatchObject({
                    code: 'VALIDATION_ERROR',
                });
            });

            it('should throw CHALLENGE_NOT_FOUND for non-existent challenge', async () => {
                mockDb.all.mockResolvedValue({ results: [] });

                await expect(
                    completeSoloChallenge(env, 'nonexistent', 'user-123')
                ).rejects.toMatchObject({
                    code: 'CHALLENGE_NOT_FOUND',
                });
            });
        });
    });

    describe('FIRE Mode', () => {
        describe('handleFireMode', () => {
            it('should store FIRE config in database', async () => {
                const challenge = createMockChallenge({ mode: 'FIRE' });
                const config = {
                    honesty_bond_amount: '1000000000000000000', // 1 ETH
                    currency_code: 'ETH',
                    resolution_strategy: 'ORACLE' as const,
                    oracle_source: 'chainlink',
                };

                mockDb.all.mockResolvedValue({ results: [challenge] });

                await handleFireMode(env, challenge, config);

                expect(mockDb.prepare).toHaveBeenCalledWith(
                    expect.stringContaining('INSERT INTO challenges_fire_config')
                );
            });
        });

        describe('depositBond', () => {
            it('should record bond deposit', async () => {
                const challenge = createMockChallenge({
                    mode: 'FIRE',
                    status: 'AWAITING_GATEKEEPER',
                });
                const fireConfig = {
                    honesty_bond_amount: '1000000000000000000',
                    currency_code: 'ETH',
                    resolution_strategy: 'ORACLE',
                };

                // Mock getting challenge
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                // Mock getting fire config
                mockDb.all.mockResolvedValueOnce({ results: [fireConfig] });
                // Mock existing deposits (none yet)
                mockDb.all.mockResolvedValueOnce({ results: [] });

                const result = await depositBond(
                    env,
                    challenge.id,
                    'user-123',
                    '0xabc123'
                );

                expect(result).toHaveProperty('id');
                expect(result.amount).toBe('1000000000000000000');
                expect(result.currency_code).toBe('ETH');
                expect(result.status).toBe('CONFIRMED');
            });

            it('should set status to PENDING when no tx_hash', async () => {
                const challenge = createMockChallenge({ mode: 'FIRE' });
                const fireConfig = {
                    honesty_bond_amount: '1000000000000000000',
                    currency_code: 'ETH',
                    resolution_strategy: 'ORACLE',
                };

                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                mockDb.all.mockResolvedValueOnce({ results: [fireConfig] });
                mockDb.all.mockResolvedValueOnce({ results: [] });

                const result = await depositBond(env, challenge.id, 'user-123');

                expect(result.status).toBe('PENDING');
            });

            it('should transition to INTENT_LOCKED when both parties deposit', async () => {
                const challenge = createMockChallenge({ mode: 'FIRE' });
                const fireConfig = {
                    honesty_bond_amount: '1000000000000000000',
                    currency_code: 'ETH',
                    resolution_strategy: 'ORACLE',
                };

                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                mockDb.all.mockResolvedValueOnce({ results: [fireConfig] });
                // Both deposits exist
                mockDb.all.mockResolvedValueOnce({
                    results: [
                        { id: 'bond-1', user_id: 'creator-123', status: 'CONFIRMED' },
                        { id: 'bond-2', user_id: 'counterparty-456', status: 'CONFIRMED' },
                    ]
                });

                await depositBond(env, challenge.id, 'user-123', '0xabc');

                // Should have called UPDATE to transition status
                const updateCalls = mockDb.prepare.mock.calls.filter((call: string[]) =>
                    call[0].includes('UPDATE challenges') && call[0].includes('status')
                );
                expect(updateCalls.length).toBeGreaterThan(0);
            });

            it('should throw CHALLENGE_NOT_FOUND for non-existent challenge', async () => {
                mockDb.all.mockResolvedValue({ results: [] });

                await expect(
                    depositBond(env, 'nonexistent', 'user-123')
                ).rejects.toMatchObject({
                    code: 'CHALLENGE_NOT_FOUND',
                });
            });

            it('should throw VALIDATION_ERROR for non-FIRE challenge', async () => {
                const challenge = createMockChallenge({ mode: 'SOLO' });
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                mockDb.all.mockResolvedValueOnce({ results: [] }); // No fire config

                await expect(
                    depositBond(env, challenge.id, 'user-123')
                ).rejects.toMatchObject({
                    code: 'VALIDATION_ERROR',
                });
            });
        });

        describe('raiseDispute', () => {
            it('should create dispute record and transition to DISPUTED', async () => {
                const challenge = createMockChallenge({
                    mode: 'FIRE',
                    status: 'AWAITING_RESOLUTION',
                });

                mockDb.all.mockResolvedValue({ results: [challenge] });

                await raiseDispute(
                    env,
                    challenge.id,
                    'user-123',
                    'Counterparty did not deliver',
                    { screenshots: ['url1', 'url2'] }
                );

                expect(mockDb.prepare).toHaveBeenCalledWith(
                    expect.stringContaining('INSERT INTO challenge_disputes')
                );
                expect(mockDb.prepare).toHaveBeenCalledWith(
                    expect.stringContaining("status = ?")
                );
            });

            it('should throw VALIDATION_ERROR if not in AWAITING_RESOLUTION', async () => {
                const challenge = createMockChallenge({
                    mode: 'FIRE',
                    status: 'INTENT_LOCKED', // Wrong status
                });

                mockDb.all.mockResolvedValue({ results: [challenge] });

                await expect(
                    raiseDispute(env, challenge.id, 'user-123', 'reason')
                ).rejects.toMatchObject({
                    code: 'VALIDATION_ERROR',
                });
            });
        });

        describe('resolveDispute', () => {
            it('should resolve dispute and release winner bond', async () => {
                const challenge = createMockChallenge({
                    mode: 'FIRE',
                    status: 'DISPUTED',
                });

                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                mockDb.all.mockResolvedValueOnce({
                    results: [{ ...challenge, status: 'COMPLETED' }]
                });

                const result = await resolveDispute(
                    env,
                    challenge.id,
                    'creator-123', // Winner
                    'Evidence supports creator claim'
                );

                expect(result.status).toBe('COMPLETED');
                // Should update bonds - winner released, loser forfeited
                const bondUpdateCalls = mockDb.prepare.mock.calls.filter((call: string[]) =>
                    call[0].includes('UPDATE bond_deposits')
                );
                expect(bondUpdateCalls.length).toBe(2);
            });

            it('should throw VALIDATION_ERROR if not in DISPUTED status', async () => {
                const challenge = createMockChallenge({
                    mode: 'FIRE',
                    status: 'INTENT_LOCKED',
                });

                mockDb.all.mockResolvedValue({ results: [challenge] });

                await expect(
                    resolveDispute(env, challenge.id, 'creator-123', 'resolution')
                ).rejects.toMatchObject({
                    code: 'VALIDATION_ERROR',
                });
            });
        });
    });

    describe('ENFORCED Mode', () => {
        describe('handleEnforcedMode', () => {
            it('should store enforced config and set expiry', async () => {
                const challenge = createMockChallenge({ mode: 'ENFORCED' });
                const config = {
                    accept_timeout_seconds: 3600, // 1 hour
                    response_timeout_seconds: 86400, // 24 hours
                    dispute_timeout_seconds: 604800, // 7 days
                };

                mockDb.all.mockResolvedValue({ results: [challenge] });

                await handleEnforcedMode(env, challenge, config);

                expect(mockDb.prepare).toHaveBeenCalledWith(
                    expect.stringContaining('INSERT INTO challenges_enforced_config')
                );
                expect(mockDb.prepare).toHaveBeenCalledWith(
                    expect.stringContaining('UPDATE challenges')
                );
            });
        });

        describe('checkEnforcedTimeouts', () => {
            it('should expire challenge past accept deadline', async () => {
                const pastExpiry = new Date(Date.now() - 1000).toISOString();
                const challenge = createMockChallenge({
                    mode: 'ENFORCED',
                    status: 'AWAITING_COUNTERPARTY',
                    expires_at: pastExpiry,
                });
                const config = {
                    accept_timeout_seconds: 3600,
                    response_timeout_seconds: 86400,
                    dispute_timeout_seconds: 604800,
                };

                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                mockDb.all.mockResolvedValueOnce({ results: [config] });
                mockDb.all.mockResolvedValueOnce({
                    results: [{ ...challenge, status: 'EXPIRED' }]
                });

                const result = await checkEnforcedTimeouts(env, challenge.id);

                expect(result.status).toBe('EXPIRED');
            });

            it('should cancel challenge past response deadline', async () => {
                const challenge = createMockChallenge({
                    mode: 'ENFORCED',
                    status: 'INTENT_LOCKED',
                    intent_locked_at: Date.now() - 100000000, // Long ago
                });
                const config = {
                    accept_timeout_seconds: 3600,
                    response_timeout_seconds: 1, // 1 second (expired)
                    dispute_timeout_seconds: 604800,
                };

                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                mockDb.all.mockResolvedValueOnce({ results: [config] });
                mockDb.all.mockResolvedValueOnce({
                    results: [{ ...challenge, status: 'CANCELLED' }]
                });

                const result = await checkEnforcedTimeouts(env, challenge.id);

                expect(result.status).toBe('CANCELLED');
            });

            it('should cancel disputed challenge past dispute deadline', async () => {
                const challenge = createMockChallenge({
                    mode: 'ENFORCED',
                    status: 'DISPUTED',
                });
                const config = {
                    accept_timeout_seconds: 3600,
                    response_timeout_seconds: 86400,
                    dispute_timeout_seconds: 1, // 1 second
                };
                const dispute = {
                    created_at: Date.now() - 10000, // 10 seconds ago
                };

                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                mockDb.all.mockResolvedValueOnce({ results: [config] });
                mockDb.all.mockResolvedValueOnce({ results: [dispute] });
                mockDb.all.mockResolvedValueOnce({
                    results: [{ ...challenge, status: 'CANCELLED' }]
                });

                const result = await checkEnforcedTimeouts(env, challenge.id);

                expect(result.status).toBe('CANCELLED');
            });

            it('should return challenge unchanged if no timeout exceeded', async () => {
                const futureExpiry = new Date(Date.now() + 100000).toISOString();
                const challenge = createMockChallenge({
                    mode: 'ENFORCED',
                    status: 'AWAITING_COUNTERPARTY',
                    expires_at: futureExpiry,
                });
                const config = {
                    accept_timeout_seconds: 3600,
                    response_timeout_seconds: 86400,
                    dispute_timeout_seconds: 604800,
                };

                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                mockDb.all.mockResolvedValueOnce({ results: [config] });

                const result = await checkEnforcedTimeouts(env, challenge.id);

                expect(result.status).toBe('AWAITING_COUNTERPARTY');
            });

            it('should return challenge unchanged if no enforced config', async () => {
                const challenge = createMockChallenge({ mode: 'GATEKEEPER' });

                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                mockDb.all.mockResolvedValueOnce({ results: [] }); // No config

                const result = await checkEnforcedTimeouts(env, challenge.id);

                expect(result).toEqual(challenge);
            });
        });

        describe('enforceCompletion', () => {
            it('should record user completion in KV', async () => {
                const challenge = createMockChallenge({
                    mode: 'ENFORCED',
                    status: 'INTENT_LOCKED',
                });

                // enforceCompletion calls getChallengeById first
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                // checkEnforcedTimeouts calls getChallengeById
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                // checkEnforcedTimeouts queries for config
                mockDb.all.mockResolvedValueOnce({ results: [] }); // No enforced config (skip timeout check)
                // enforceCompletion returns challenge at end
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });

                await enforceCompletion(env, challenge.id, 'creator-123');

                expect(mockKv.put).toHaveBeenCalledWith(
                    `enforced_completion:${challenge.id}:creator-123`,
                    expect.any(String),
                    expect.objectContaining({ expirationTtl: expect.any(Number) })
                );
            });

            it('should complete challenge when both parties complete', async () => {
                const challenge = createMockChallenge({
                    mode: 'ENFORCED',
                    status: 'INTENT_LOCKED',
                    creator_user_id: 'creator-123',
                    counterparty_user_id: 'counterparty-456',
                });

                // enforceCompletion calls getChallengeById first
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                // checkEnforcedTimeouts calls getChallengeById
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                // checkEnforcedTimeouts queries for config
                mockDb.all.mockResolvedValueOnce({ results: [] }); // No enforced config
                // KV checks for completion
                mockKv.get.mockImplementation((key: string) => {
                    if (key.includes('creator-123') || key.includes('counterparty-456')) {
                        return JSON.stringify({ completed_at: Date.now() });
                    }
                    return null;
                });
                // Final getChallengeById after completion
                mockDb.all.mockResolvedValueOnce({
                    results: [{ ...challenge, status: 'COMPLETED' }]
                });

                const result = await enforceCompletion(env, challenge.id, 'creator-123');

                expect(result.status).toBe('COMPLETED');
            });

            it('should throw VALIDATION_ERROR if not in INTENT_LOCKED', async () => {
                const challenge = createMockChallenge({
                    mode: 'ENFORCED',
                    status: 'DRAFT',
                });

                // enforceCompletion calls getChallengeById first
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                // checkEnforcedTimeouts calls getChallengeById
                mockDb.all.mockResolvedValueOnce({ results: [challenge] });
                // checkEnforcedTimeouts queries for config
                mockDb.all.mockResolvedValueOnce({ results: [] }); // No config

                await expect(
                    enforceCompletion(env, challenge.id, 'user-123')
                ).rejects.toMatchObject({
                    code: 'VALIDATION_ERROR',
                });
            });
        });
    });

    describe('Mode Selection', () => {
        it('SOLO mode should not require counterparty', () => {
            const challenge = createMockChallenge({
                mode: 'SOLO',
                counterparty_user_id: undefined,
            });

            expect(challenge.counterparty_user_id).toBeUndefined();
        });

        it('GATEKEEPER mode should have counterparty', () => {
            const challenge = createMockChallenge({
                mode: 'GATEKEEPER',
                counterparty_user_id: 'counterparty-456',
            });

            expect(challenge.counterparty_user_id).toBeDefined();
        });

        it('FIRE mode should have counterparty for bond mechanics', () => {
            const challenge = createMockChallenge({
                mode: 'FIRE',
                counterparty_user_id: 'counterparty-456',
            });

            expect(challenge.counterparty_user_id).toBeDefined();
        });

        it('ENFORCED mode should have counterparty for timeout enforcement', () => {
            const challenge = createMockChallenge({
                mode: 'ENFORCED',
                counterparty_user_id: 'counterparty-456',
            });

            expect(challenge.counterparty_user_id).toBeDefined();
        });
    });
});
