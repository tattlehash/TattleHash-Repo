
import { describe, it, expect, beforeEach, env } from 'vitest';

describe('GATEKEEPER Mode Integration', () => {
    const creatorUserId = 'creator-123';
    const counterpartyUserId = 'counterparty-456';

    it('creates a challenge in DRAFT status', async () => {
        const { createChallenge } = await import('../src/gatekeeper/challenges');

        const challengeInput = {
            mode: 'GATEKEEPER' as const,
            title: 'Test P2P Trade',
            description: 'Trading 1 ETH for $2000 USDC',
            counterparty_user_id: counterpartyUserId,
        };

        const challenge = await createChallenge(env, challengeInput, creatorUserId);

        expect(challenge).toBeDefined();
        expect(challenge.status).toBe('DRAFT');
        expect(challenge.mode).toBe('GATEKEEPER');
        expect(challenge.creator_user_id).toBe(creatorUserId);
        expect(challenge.counterparty_user_id).toBe(counterpartyUserId);

        console.log('✅ Challenge created in DRAFT status');
    });

    it('transitions from DRAFT to AWAITING_COUNTERPARTY', async () => {
        const { createChallenge, sendChallenge } = await import('../src/gatekeeper/challenges');

        const challenge = await createChallenge(env, {
            mode: 'GATEKEEPER',
            title: 'State Transition Test',
            counterparty_user_id: counterpartyUserId,
        }, creatorUserId);

        const sentChallenge = await sendChallenge(env, challenge.id, creatorUserId);

        expect(sentChallenge.status).toBe('AWAITING_COUNTERPARTY');
        console.log('✅ Challenge sent to counterparty');
    });

    it('validates state machine transitions', async () => {
        const { createChallenge, sendChallenge, acceptChallenge } = await import('../src/gatekeeper/challenges');

        const challenge = await createChallenge(env, {
            mode: 'GATEKEEPER',
            title: 'State Validation Test',
            counterparty_user_id: counterpartyUserId,
        }, creatorUserId);

        // Cannot accept from DRAFT - must send first
        try {
            await acceptChallenge(env, challenge.id, {}, counterpartyUserId);
            expect.fail('Should not accept from DRAFT');
        } catch (error: any) {
            expect(error.code).toBeDefined();
            console.log('✅ Correctly rejected acceptance from DRAFT');
        }

        // Send challenge
        await sendChallenge(env, challenge.id, creatorUserId);

        // Now acceptance should trigger verification
        const accepted = await acceptChallenge(env, challenge.id, {}, counterpartyUserId);
        expect(['AWAITING_GATEKEEPER', 'INTENT_LOCKED', 'CANCELLED']).toContain(accepted.status);
        console.log(`✅ Challenge transitioned to ${accepted.status}`);
    });

    it('prevents unauthorized actions', async () => {
        const { createChallenge, sendChallenge } = await import('../src/gatekeeper/challenges');

        const challenge = await createChallenge(env, {
            mode: 'GATEKEEPER',
            title: 'Authorization Test',
            counterparty_user_id: counterpartyUserId,
        }, creatorUserId);

        // Wrong user cannot send
        try {
            await sendChallenge(env, challenge.id, 'wrong-user');
            expect.fail('Should not allow wrong user to send');
        } catch (error: any) {
            expect(error.code).toBe('FORBIDDEN');
            console.log('✅ Correctly rejected unauthorized send');
        }
    });

    it('handles challenge expiry', async () => {
        const { createChallenge, sendChallenge, acceptChallenge, getChallengeById } = await import('../src/gatekeeper/challenges');

        const challenge = await createChallenge(env, {
            mode: 'GATEKEEPER',
            title: 'Expiry Test',
            counterparty_user_id: counterpartyUserId,
            expires_at: new Date(Date.now() - 1000).toISOString(), // Already expired
        }, creatorUserId);

        await sendChallenge(env, challenge.id, creatorUserId);

        // Should reject expired challenge
        try {
            await acceptChallenge(env, challenge.id, {}, counterpartyUserId);
            expect.fail('Should reject expired challenge');
        } catch (error: any) {
            expect(error.code).toBe('CHALLENGE_EXPIRED');
        }

        const expiredChallenge = await getChallengeById(env, challenge.id);
        expect(expiredChallenge?.status).toBe('EXPIRED');

        console.log('✅ Expiry handling works correctly');
    });
});
