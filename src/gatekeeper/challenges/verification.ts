
import { query } from '../../db';
import { checkFundsThreshold } from '../funds/check';
import type { Challenge, VerificationResult, TrustScoreAttestation } from './types';
import { Env } from '../../types';
import { getTrustScore } from '../../trust-score';
import { calculateWalletTrafficLight } from '../wallet/verify';

export async function runGatekeeperVerification(
    env: Env,
    challenge: Challenge
): Promise<VerificationResult> {
    const result: VerificationResult = {
        allPassed: false,
        creatorWallet: 'PENDING',
        creatorFunds: 'PENDING',
        counterpartyWallet: 'PENDING',
        counterpartyFunds: 'PENDING',
        failures: [],
    };

    // Get funds requirements for this challenge
    const requirements = await query(
        env.TATTLEHASH_DB,
        'SELECT * FROM funds_requirements WHERE challenge_id = ?',
        [challenge.id]
    );

    // Get wallet verifications (users must have completed these beforehand)
    const walletVerifications = await query(
        env.TATTLEHASH_DB,
        `SELECT * FROM wallet_challenges 
     WHERE used_at IS NOT NULL
     ORDER BY created_at DESC
     LIMIT 10`
    );

    // Check creator wallet
    const creatorWalletVerified = walletVerifications.some(
        (v: any) => v.wallet_address?.toLowerCase() === getCreatorWallet(requirements)?.toLowerCase()
    );
    result.creatorWallet = creatorWalletVerified ? 'VERIFIED' : 'FAILED';

    // Check counterparty wallet
    const counterpartyWalletVerified = walletVerifications.some(
        (v: any) => v.wallet_address?.toLowerCase() === getCounterpartyWallet(requirements)?.toLowerCase()
    );
    result.counterpartyWallet = counterpartyWalletVerified ? 'VERIFIED' : 'FAILED';

    // If wallets not verified, can't proceed
    if (!creatorWalletVerified) {
        result.failures.push('Creator wallet not verified');
    }
    if (!counterpartyWalletVerified) {
        result.failures.push('Counterparty wallet not verified');
    }

    if (result.failures.length > 0) {
        return result;
    }

    // Run funds checks in parallel
    const creatorReqs = requirements.filter(
        (r: any) => r.user_id === challenge.creator_user_id
    );
    const counterpartyReqs = requirements.filter(
        (r: any) => r.user_id === challenge.counterparty_user_id || r.user_id === 'COUNTERPARTY_PLACEHOLDER'
    );

    const [creatorFundsResults, counterpartyFundsResults] = await Promise.all([
        runFundsChecks(env, creatorReqs, challenge.id, challenge.creator_user_id),
        runFundsChecks(env, counterpartyReqs, challenge.id, challenge.counterparty_user_id!),
    ]);

    // Evaluate results
    const creatorFundsPassed = creatorFundsResults.every(r => r.status === 'PASSED');
    const counterpartyFundsPassed = counterpartyFundsResults.every(r => r.status === 'PASSED');

    result.creatorFunds = creatorFundsPassed ? 'PASSED' : 'FAILED';
    result.counterpartyFunds = counterpartyFundsPassed ? 'PASSED' : 'FAILED';

    if (!creatorFundsPassed) {
        result.failures.push('Creator funds check failed');
    }
    if (!counterpartyFundsPassed) {
        result.failures.push('Counterparty funds check failed');
    }

    // Fetch Trust Scores for attestation metadata
    const creatorWallet = getCreatorWallet(requirements);
    const counterpartyWallet = getCounterpartyWallet(requirements);

    const [creatorTrustAttestation, counterpartyTrustAttestation] = await Promise.all([
        creatorWallet ? fetchTrustScoreAttestation(env, creatorWallet, result.creatorWallet === 'VERIFIED') : null,
        counterpartyWallet ? fetchTrustScoreAttestation(env, counterpartyWallet, result.counterpartyWallet === 'VERIFIED') : null,
    ]);

    result.trustScores = {
        creator: creatorTrustAttestation ?? undefined,
        counterparty: counterpartyTrustAttestation ?? undefined,
    };

    // Add Trust Score warnings to failures if needed
    if (creatorTrustAttestation?.trafficLight === 'RED') {
        result.failures.push(`Creator wallet has RED traffic light (Trust Score: ${creatorTrustAttestation.score})`);
    }
    if (counterpartyTrustAttestation?.trafficLight === 'RED') {
        result.failures.push(`Counterparty wallet has RED traffic light (Trust Score: ${counterpartyTrustAttestation.score})`);
    }

    result.allPassed = result.failures.length === 0;

    return result;
}

/**
 * Fetch Trust Score and create attestation data.
 */
async function fetchTrustScoreAttestation(
    env: Env,
    wallet: string,
    walletVerified: boolean
): Promise<TrustScoreAttestation | null> {
    try {
        const score = await getTrustScore(env, wallet, false);
        const trafficLight = calculateWalletTrafficLight(score, walletVerified);

        return {
            wallet,
            score: score.trustScore,
            riskLevel: score.riskLevel,
            trafficLight,
            flagCount: score.flags.length,
            confidence: score.confidence,
            assessedAt: new Date().toISOString(),
        };
    } catch (error) {
        console.error(`Trust score attestation fetch failed for ${wallet}:`, error);
        return null;
    }
}

async function runFundsChecks(
    env: Env,
    requirements: any[],
    challengeId: string,
    userId: string
): Promise<Array<{ status: 'PASSED' | 'FAILED' }>> {
    const results = await Promise.all(
        requirements.map(async (req) => {
            try {
                const result = await checkFundsThreshold(env, {
                    wallet_address: req.wallet_address,
                    network: req.network,
                    asset_type: req.asset_type,
                    token_address: req.token_address,
                    min_balance: req.min_balance,
                    challenge_id: challengeId,
                    user_id: userId,
                });
                return { status: result.status as 'PASSED' | 'FAILED' };
            } catch (error) {
                console.error('Funds check error:', error);
                return { status: 'FAILED' as const };
            }
        })
    );

    return results;
}

function getCreatorWallet(requirements: any[]): string | null {
    const creatorReq = requirements.find((r: any) => r.user_id !== 'COUNTERPARTY_PLACEHOLDER');
    return creatorReq?.wallet_address ?? null;
}

function getCounterpartyWallet(requirements: any[]): string | null {
    const counterpartyReq = requirements.find((r: any) => r.user_id === 'COUNTERPARTY_PLACEHOLDER');
    return counterpartyReq?.wallet_address ?? null;
}
