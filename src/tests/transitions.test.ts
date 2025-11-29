
import { describe, it, expect } from 'vitest';
import { validateTransition, canTransition } from '../gatekeeper/challenges/transitions';
import type { Challenge, ChallengeStatus } from '../gatekeeper/challenges/types';

function createMockChallenge(status: ChallengeStatus): Challenge {
    return {
        id: 'test-challenge-id',
        mode: 'GATEKEEPER',
        creator_user_id: 'creator-123',
        counterparty_user_id: 'counterparty-456',
        title: 'Test Challenge',
        status,
        created_at: Date.now(),
        updated_at: Date.now(),
    };
}

describe('Challenge State Transitions', () => {
    describe('validateTransition', () => {
        describe('DRAFT state transitions', () => {
            it('should allow DRAFT -> AWAITING_COUNTERPARTY', () => {
                const challenge = createMockChallenge('DRAFT');
                const result = validateTransition(challenge, 'AWAITING_COUNTERPARTY');
                expect(result.valid).toBe(true);
            });

            it('should allow DRAFT -> CANCELLED', () => {
                const challenge = createMockChallenge('DRAFT');
                const result = validateTransition(challenge, 'CANCELLED');
                expect(result.valid).toBe(true);
            });

            it('should NOT allow DRAFT -> COMPLETED', () => {
                const challenge = createMockChallenge('DRAFT');
                const result = validateTransition(challenge, 'COMPLETED');
                expect(result.valid).toBe(false);
                expect(result.error).toContain('Cannot transition from DRAFT to COMPLETED');
            });

            it('should NOT allow DRAFT -> INTENT_LOCKED', () => {
                const challenge = createMockChallenge('DRAFT');
                const result = validateTransition(challenge, 'INTENT_LOCKED');
                expect(result.valid).toBe(false);
            });
        });

        describe('AWAITING_COUNTERPARTY state transitions', () => {
            it('should allow AWAITING_COUNTERPARTY -> AWAITING_GATEKEEPER', () => {
                const challenge = createMockChallenge('AWAITING_COUNTERPARTY');
                const result = validateTransition(challenge, 'AWAITING_GATEKEEPER');
                expect(result.valid).toBe(true);
            });

            it('should allow AWAITING_COUNTERPARTY -> EXPIRED', () => {
                const challenge = createMockChallenge('AWAITING_COUNTERPARTY');
                const result = validateTransition(challenge, 'EXPIRED');
                expect(result.valid).toBe(true);
            });

            it('should allow AWAITING_COUNTERPARTY -> CANCELLED', () => {
                const challenge = createMockChallenge('AWAITING_COUNTERPARTY');
                const result = validateTransition(challenge, 'CANCELLED');
                expect(result.valid).toBe(true);
            });

            it('should NOT allow AWAITING_COUNTERPARTY -> COMPLETED', () => {
                const challenge = createMockChallenge('AWAITING_COUNTERPARTY');
                const result = validateTransition(challenge, 'COMPLETED');
                expect(result.valid).toBe(false);
            });
        });

        describe('AWAITING_GATEKEEPER state transitions', () => {
            it('should allow AWAITING_GATEKEEPER -> INTENT_LOCKED', () => {
                const challenge = createMockChallenge('AWAITING_GATEKEEPER');
                const result = validateTransition(challenge, 'INTENT_LOCKED');
                expect(result.valid).toBe(true);
            });

            it('should allow AWAITING_GATEKEEPER -> CANCELLED', () => {
                const challenge = createMockChallenge('AWAITING_GATEKEEPER');
                const result = validateTransition(challenge, 'CANCELLED');
                expect(result.valid).toBe(true);
            });

            it('should NOT allow AWAITING_GATEKEEPER -> DRAFT', () => {
                const challenge = createMockChallenge('AWAITING_GATEKEEPER');
                const result = validateTransition(challenge, 'DRAFT');
                expect(result.valid).toBe(false);
            });
        });

        describe('INTENT_LOCKED state transitions', () => {
            it('should allow INTENT_LOCKED -> AWAITING_RESOLUTION', () => {
                const challenge = createMockChallenge('INTENT_LOCKED');
                const result = validateTransition(challenge, 'AWAITING_RESOLUTION');
                expect(result.valid).toBe(true);
            });

            it('should allow INTENT_LOCKED -> COMPLETED', () => {
                const challenge = createMockChallenge('INTENT_LOCKED');
                const result = validateTransition(challenge, 'COMPLETED');
                expect(result.valid).toBe(true);
            });

            it('should allow INTENT_LOCKED -> CANCELLED', () => {
                const challenge = createMockChallenge('INTENT_LOCKED');
                const result = validateTransition(challenge, 'CANCELLED');
                expect(result.valid).toBe(true);
            });

            it('should NOT allow INTENT_LOCKED -> DRAFT', () => {
                const challenge = createMockChallenge('INTENT_LOCKED');
                const result = validateTransition(challenge, 'DRAFT');
                expect(result.valid).toBe(false);
            });
        });

        describe('AWAITING_RESOLUTION state transitions', () => {
            it('should allow AWAITING_RESOLUTION -> COMPLETED', () => {
                const challenge = createMockChallenge('AWAITING_RESOLUTION');
                const result = validateTransition(challenge, 'COMPLETED');
                expect(result.valid).toBe(true);
            });

            it('should allow AWAITING_RESOLUTION -> DISPUTED', () => {
                const challenge = createMockChallenge('AWAITING_RESOLUTION');
                const result = validateTransition(challenge, 'DISPUTED');
                expect(result.valid).toBe(true);
            });

            it('should allow AWAITING_RESOLUTION -> CANCELLED', () => {
                const challenge = createMockChallenge('AWAITING_RESOLUTION');
                const result = validateTransition(challenge, 'CANCELLED');
                expect(result.valid).toBe(true);
            });

            it('should NOT allow AWAITING_RESOLUTION -> DRAFT', () => {
                const challenge = createMockChallenge('AWAITING_RESOLUTION');
                const result = validateTransition(challenge, 'DRAFT');
                expect(result.valid).toBe(false);
            });
        });

        describe('DISPUTED state transitions', () => {
            it('should allow DISPUTED -> COMPLETED', () => {
                const challenge = createMockChallenge('DISPUTED');
                const result = validateTransition(challenge, 'COMPLETED');
                expect(result.valid).toBe(true);
            });

            it('should allow DISPUTED -> CANCELLED', () => {
                const challenge = createMockChallenge('DISPUTED');
                const result = validateTransition(challenge, 'CANCELLED');
                expect(result.valid).toBe(true);
            });

            it('should NOT allow DISPUTED -> DRAFT', () => {
                const challenge = createMockChallenge('DISPUTED');
                const result = validateTransition(challenge, 'DRAFT');
                expect(result.valid).toBe(false);
            });
        });

        describe('Terminal states (no outbound transitions)', () => {
            it('should NOT allow COMPLETED -> any state', () => {
                const challenge = createMockChallenge('COMPLETED');
                const states: ChallengeStatus[] = [
                    'DRAFT', 'AWAITING_COUNTERPARTY', 'AWAITING_GATEKEEPER',
                    'INTENT_LOCKED', 'AWAITING_RESOLUTION', 'CANCELLED', 'EXPIRED', 'DISPUTED'
                ];

                for (const state of states) {
                    const result = validateTransition(challenge, state);
                    expect(result.valid).toBe(false);
                }
            });

            it('should NOT allow CANCELLED -> any state', () => {
                const challenge = createMockChallenge('CANCELLED');
                const states: ChallengeStatus[] = [
                    'DRAFT', 'AWAITING_COUNTERPARTY', 'AWAITING_GATEKEEPER',
                    'INTENT_LOCKED', 'AWAITING_RESOLUTION', 'COMPLETED', 'EXPIRED', 'DISPUTED'
                ];

                for (const state of states) {
                    const result = validateTransition(challenge, state);
                    expect(result.valid).toBe(false);
                }
            });

            it('should NOT allow EXPIRED -> any state', () => {
                const challenge = createMockChallenge('EXPIRED');
                const states: ChallengeStatus[] = [
                    'DRAFT', 'AWAITING_COUNTERPARTY', 'AWAITING_GATEKEEPER',
                    'INTENT_LOCKED', 'AWAITING_RESOLUTION', 'COMPLETED', 'CANCELLED', 'DISPUTED'
                ];

                for (const state of states) {
                    const result = validateTransition(challenge, state);
                    expect(result.valid).toBe(false);
                }
            });
        });
    });

    describe('canTransition', () => {
        it('should return true for valid transitions', () => {
            const challenge = createMockChallenge('DRAFT');
            expect(canTransition(challenge, 'AWAITING_COUNTERPARTY')).toBe(true);
        });

        it('should return false for invalid transitions', () => {
            const challenge = createMockChallenge('DRAFT');
            expect(canTransition(challenge, 'COMPLETED')).toBe(false);
        });

        it('should return false for self-transitions', () => {
            const challenge = createMockChallenge('DRAFT');
            // DRAFT -> DRAFT is not in the allowed transitions
            expect(canTransition(challenge, 'DRAFT')).toBe(false);
        });
    });

    describe('Complete Flow Validation', () => {
        it('should validate happy path: DRAFT -> AWAITING_COUNTERPARTY -> AWAITING_GATEKEEPER -> INTENT_LOCKED -> COMPLETED', () => {
            let challenge = createMockChallenge('DRAFT');

            expect(canTransition(challenge, 'AWAITING_COUNTERPARTY')).toBe(true);
            challenge = { ...challenge, status: 'AWAITING_COUNTERPARTY' };

            expect(canTransition(challenge, 'AWAITING_GATEKEEPER')).toBe(true);
            challenge = { ...challenge, status: 'AWAITING_GATEKEEPER' };

            expect(canTransition(challenge, 'INTENT_LOCKED')).toBe(true);
            challenge = { ...challenge, status: 'INTENT_LOCKED' };

            expect(canTransition(challenge, 'COMPLETED')).toBe(true);
        });

        it('should validate dispute path: INTENT_LOCKED -> AWAITING_RESOLUTION -> DISPUTED -> COMPLETED', () => {
            let challenge = createMockChallenge('INTENT_LOCKED');

            expect(canTransition(challenge, 'AWAITING_RESOLUTION')).toBe(true);
            challenge = { ...challenge, status: 'AWAITING_RESOLUTION' };

            expect(canTransition(challenge, 'DISPUTED')).toBe(true);
            challenge = { ...challenge, status: 'DISPUTED' };

            expect(canTransition(challenge, 'COMPLETED')).toBe(true);
        });

        it('should validate cancellation from any non-terminal state', () => {
            const nonTerminalStates: ChallengeStatus[] = [
                'DRAFT', 'AWAITING_COUNTERPARTY', 'AWAITING_GATEKEEPER',
                'INTENT_LOCKED', 'AWAITING_RESOLUTION', 'DISPUTED'
            ];

            for (const status of nonTerminalStates) {
                const challenge = createMockChallenge(status);
                expect(canTransition(challenge, 'CANCELLED')).toBe(true);
            }
        });

        it('should validate expiry only from AWAITING_COUNTERPARTY', () => {
            const canExpireFrom: ChallengeStatus[] = ['AWAITING_COUNTERPARTY'];
            const cannotExpireFrom: ChallengeStatus[] = [
                'DRAFT', 'AWAITING_GATEKEEPER', 'INTENT_LOCKED',
                'AWAITING_RESOLUTION', 'COMPLETED', 'CANCELLED', 'DISPUTED'
            ];

            for (const status of canExpireFrom) {
                const challenge = createMockChallenge(status);
                expect(canTransition(challenge, 'EXPIRED')).toBe(true);
            }

            for (const status of cannotExpireFrom) {
                const challenge = createMockChallenge(status);
                expect(canTransition(challenge, 'EXPIRED')).toBe(false);
            }
        });
    });

    describe('Error Messages', () => {
        it('should provide meaningful error for invalid transitions', () => {
            const challenge = createMockChallenge('COMPLETED');
            const result = validateTransition(challenge, 'DRAFT');

            expect(result.error).toBeDefined();
            expect(result.error).toContain('COMPLETED');
            expect(result.error).toContain('DRAFT');
        });

        it('should not have error property for valid transitions', () => {
            const challenge = createMockChallenge('DRAFT');
            const result = validateTransition(challenge, 'AWAITING_COUNTERPARTY');

            expect(result.error).toBeUndefined();
        });
    });
});
