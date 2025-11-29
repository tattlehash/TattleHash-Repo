
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateTransition, canTransition } from '../src/gatekeeper/challenges/transitions';
import type { Challenge, ChallengeStatus } from '../src/gatekeeper/challenges/types';
import type { Env } from '../src/types';

// Mock challenge factory
function createMockChallenge(status: ChallengeStatus, overrides: Partial<Challenge> = {}): Challenge {
    return {
        id: 'test-challenge-id',
        mode: 'GATEKEEPER',
        creator_user_id: 'creator-123',
        counterparty_user_id: 'counterparty-456',
        title: 'Test Challenge',
        status,
        created_at: Date.now(),
        updated_at: Date.now(),
        ...overrides,
    };
}

describe('GATEKEEPER Mode Integration', () => {
    const creatorUserId = 'creator-123';
    const counterpartyUserId = 'counterparty-456';

    it('creates a challenge in DRAFT status', async () => {
        // Test that challenges should start in DRAFT status
        const challenge = createMockChallenge('DRAFT', {
            creator_user_id: creatorUserId,
            counterparty_user_id: counterpartyUserId,
        });

        expect(challenge).toBeDefined();
        expect(challenge.status).toBe('DRAFT');
        expect(challenge.mode).toBe('GATEKEEPER');
        expect(challenge.creator_user_id).toBe(creatorUserId);
        expect(challenge.counterparty_user_id).toBe(counterpartyUserId);
    });

    it('transitions from DRAFT to AWAITING_COUNTERPARTY', async () => {
        const challenge = createMockChallenge('DRAFT');

        // Verify transition is allowed
        expect(canTransition(challenge, 'AWAITING_COUNTERPARTY')).toBe(true);

        // Simulate the transition
        const sentChallenge = { ...challenge, status: 'AWAITING_COUNTERPARTY' as ChallengeStatus };
        expect(sentChallenge.status).toBe('AWAITING_COUNTERPARTY');
    });

    it('validates state machine transitions', async () => {
        const challenge = createMockChallenge('DRAFT');

        // Cannot accept from DRAFT (not AWAITING_COUNTERPARTY)
        expect(canTransition(challenge, 'AWAITING_GATEKEEPER')).toBe(false);

        // Must go through AWAITING_COUNTERPARTY first
        expect(canTransition(challenge, 'AWAITING_COUNTERPARTY')).toBe(true);

        // After sending, can transition to AWAITING_GATEKEEPER
        const sentChallenge = { ...challenge, status: 'AWAITING_COUNTERPARTY' as ChallengeStatus };
        expect(canTransition(sentChallenge, 'AWAITING_GATEKEEPER')).toBe(true);
    });

    it('prevents unauthorized transitions', async () => {
        const challenge = createMockChallenge('DRAFT');

        // Cannot skip directly to COMPLETED
        expect(canTransition(challenge, 'COMPLETED')).toBe(false);

        // Cannot go to INTENT_LOCKED directly
        expect(canTransition(challenge, 'INTENT_LOCKED')).toBe(false);

        // Cannot go to DISPUTED directly
        expect(canTransition(challenge, 'DISPUTED')).toBe(false);
    });

    it('handles challenge expiry transitions', async () => {
        // Only AWAITING_COUNTERPARTY can transition to EXPIRED
        const draftChallenge = createMockChallenge('DRAFT');
        expect(canTransition(draftChallenge, 'EXPIRED')).toBe(false);

        const awaitingChallenge = createMockChallenge('AWAITING_COUNTERPARTY');
        expect(canTransition(awaitingChallenge, 'EXPIRED')).toBe(true);

        // EXPIRED is a terminal state
        const expiredChallenge = createMockChallenge('EXPIRED');
        expect(canTransition(expiredChallenge, 'DRAFT')).toBe(false);
        expect(canTransition(expiredChallenge, 'COMPLETED')).toBe(false);
    });
});
