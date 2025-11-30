# Guide: Mode Orchestration

> Complete challenge lifecycle connecting wallet verification, funds checking,  
> state machines, and attestation generation into a unified flow.

---

## Overview

This guide shows how all the pieces fit together for a **Gatekeeper Mode** challenge — the most complex flow that exercises every component.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        GATEKEEPER MODE FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  Creator                    TattleHash                    Counterparty      │
│     │                           │                              │            │
│     │  POST /challenges         │                              │            │
│     │  (mode: GATEKEEPER)       │                              │            │
│     │──────────────────────────>│                              │            │
│     │                           │  status: DRAFT               │            │
│     │                           │                              │            │
│     │  POST /challenges/:id/send│                              │            │
│     │──────────────────────────>│                              │            │
│     │                           │  status: AWAITING_COUNTERPARTY            │
│     │                           │                              │            │
│     │                           │  [Notification sent]         │            │
│     │                           │─────────────────────────────>│            │
│     │                           │                              │            │
│     │                           │  POST /challenges/:id/accept │            │
│     │                           │<─────────────────────────────│            │
│     │                           │  status: AWAITING_GATEKEEPER │            │
│     │                           │                              │            │
│     │  ┌──────────────────────────────────────────────────────┐│            │
│     │  │           GATEKEEPER VERIFICATION PHASE              ││            │
│     │  │                                                      ││            │
│     │  │  Both parties must:                                  ││            │
│     │  │  1. Verify wallet ownership (EIP-191)                ││            │
│     │  │  2. Pass funds threshold check                       ││            │
│     │  │                                                      ││            │
│     │  │  All checks run in parallel                          ││            │
│     │  └──────────────────────────────────────────────────────┘│            │
│     │                           │                              │            │
│     │                           │  All pass? INTENT_LOCKED     │            │
│     │                           │  Any fail? CANCELLED         │            │
│     │                           │                              │            │
│     │  ┌──────────────────────────────────────────────────────┐│            │
│     │  │           TRANSACTION PHASE (off-platform)           ││            │
│     │  │                                                      ││            │
│     │  │  Parties complete their transaction externally       ││            │
│     │  │  (crypto transfer, fiat payment, etc.)               ││            │
│     │  └──────────────────────────────────────────────────────┘│            │
│     │                           │                              │            │
│     │  POST /challenges/:id/complete                          │            │
│     │──────────────────────────>│                              │            │
│     │                           │                              │            │
│     │                           │  POST /challenges/:id/complete            │
│     │                           │<─────────────────────────────│            │
│     │                           │                              │            │
│     │                           │  status: COMPLETED           │            │
│     │                           │  final_hash: 0x...           │            │
│     │                           │                              │            │
│     │  GET /proof/:id           │  GET /proof/:id              │            │
│     │──────────────────────────>│<─────────────────────────────│            │
│     │                           │                              │            │
│     │  [Shareable proof URL]    │  [Shareable proof URL]       │            │
│     │                           │                              │            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## File Structure

```
src/
├── challenges/
│   ├── index.ts           # Re-exports
│   ├── types.ts           # Challenge-specific types
│   ├── create.ts          # Challenge creation
│   ├── accept.ts          # Counterparty acceptance
│   ├── verify.ts          # Gatekeeper verification orchestration
│   ├── complete.ts        # Completion handling
│   └── queries.ts         # D1 query helpers
├── modes/
│   ├── index.ts           # Re-exports
│   ├── transitions.ts     # Shared transition logic
│   ├── solo.ts            # Solo mode specifics
│   ├── gatekeeper.ts      # Gatekeeper mode specifics
│   ├── fire.ts            # Fire mode (post-MVP)
│   └── enforced.ts        # Enforced mode (post-MVP)
├── orchestration/
│   ├── index.ts           # Main orchestrator
│   ├── verification.ts    # Parallel verification runner
│   └── attestation.ts     # Final attestation creation
└── handlers/
    └── challenges.ts      # HTTP handlers
```

---

## Core Orchestrator

### src/orchestration/index.ts

```typescript
/**
 * Challenge Orchestrator
 * 
 * Coordinates the full lifecycle of a challenge across all components.
 * This is the "glue" that connects wallet verification, funds checking,
 * state machines, and attestation generation.
 */

import { generateId, now } from '../db';
import { query, queryOne, execute, batch } from '../db';
import { canTransition, validateTransition } from '../modes/transitions';
import { runGatekeeperVerification } from './verification';
import { createFinalAttestation } from './attestation';
import { emitEvent } from '../relay/events';
import { logger } from '../lib/logger';
import type { Env } from '../types';
import type { 
  Challenge, 
  ChallengeStatus, 
  CreateChallengeInput,
  AcceptChallengeInput,
} from './types';

/**
 * Create a new challenge.
 */
export async function createChallenge(
  env: Env,
  input: CreateChallengeInput,
  creatorUserId: string
): Promise<Challenge> {
  const id = generateId();
  const createdAt = now();
  
  logger.info('challenge_creating', { 
    challenge_id: id, 
    mode: input.mode,
    creator: creatorUserId,
  });
  
  // Validate mode-specific requirements
  validateModeRequirements(input);
  
  // Insert challenge
  await execute(
    env.TATTLEHASH_DB,
    `INSERT INTO challenges (
      id, mode, creator_user_id, counterparty_user_id,
      title, description, status, expires_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.mode,
      creatorUserId,
      input.counterparty_user_id ?? null,
      input.title,
      input.description ?? null,
      'DRAFT',
      input.expires_at ?? null,
      createdAt,
      createdAt,
    ]
  );
  
  // Insert mode-specific config
  if (input.mode === 'FIRE' && input.fire_config) {
    await execute(
      env.TATTLEHASH_DB,
      `INSERT INTO challenges_fire_config (
        challenge_id, honesty_bond_amount, currency_code, 
        resolution_strategy, oracle_source
      ) VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        input.fire_config.honesty_bond_amount,
        input.fire_config.currency_code,
        input.fire_config.resolution_strategy,
        input.fire_config.oracle_source ?? null,
      ]
    );
  }
  
  if (input.mode === 'ENFORCED' && input.enforced_config) {
    await execute(
      env.TATTLEHASH_DB,
      `INSERT INTO challenges_enforced_config (
        challenge_id, accept_timeout_seconds, 
        response_timeout_seconds, dispute_timeout_seconds
      ) VALUES (?, ?, ?, ?)`,
      [
        id,
        input.enforced_config.accept_timeout_seconds,
        input.enforced_config.response_timeout_seconds,
        input.enforced_config.dispute_timeout_seconds,
      ]
    );
  }
  
  // Insert gatekeeper requirements if provided
  if (input.gatekeeper_requirements) {
    await insertGatekeeperRequirements(env, id, input.gatekeeper_requirements);
  }
  
  const challenge = await getChallengeById(env, id);
  
  logger.info('challenge_created', { challenge_id: id });
  
  await emitEvent(env, {
    type: 'challenge.created',
    challenge_id: id,
    mode: input.mode,
    creator_user_id: creatorUserId,
  });
  
  return challenge!;
}

/**
 * Send challenge to counterparty.
 * Transitions: DRAFT -> AWAITING_COUNTERPARTY
 */
export async function sendChallenge(
  env: Env,
  challengeId: string,
  userId: string
): Promise<Challenge> {
  const challenge = await getChallengeById(env, challengeId);
  
  if (!challenge) {
    throw { code: 'CHALLENGE_NOT_FOUND' };
  }
  
  if (challenge.creator_user_id !== userId) {
    throw { code: 'FORBIDDEN' };
  }
  
  await transitionStatus(env, challenge, 'AWAITING_COUNTERPARTY');
  
  // Send notification to counterparty
  if (challenge.counterparty_user_id) {
    await emitEvent(env, {
      type: 'challenge.invitation_sent',
      challenge_id: challengeId,
      counterparty_user_id: challenge.counterparty_user_id,
    });
  }
  
  return (await getChallengeById(env, challengeId))!;
}

/**
 * Accept a challenge as counterparty.
 * Transitions: AWAITING_COUNTERPARTY -> AWAITING_GATEKEEPER
 */
export async function acceptChallenge(
  env: Env,
  challengeId: string,
  input: AcceptChallengeInput,
  userId: string
): Promise<Challenge> {
  const challenge = await getChallengeById(env, challengeId);
  
  if (!challenge) {
    throw { code: 'CHALLENGE_NOT_FOUND' };
  }
  
  // Verify this user is the designated counterparty
  if (challenge.counterparty_user_id && challenge.counterparty_user_id !== userId) {
    throw { code: 'CHALLENGE_NOT_COUNTERPARTY' };
  }
  
  // Check expiry
  if (challenge.expires_at && new Date(challenge.expires_at) < new Date()) {
    await transitionStatus(env, challenge, 'EXPIRED');
    throw { code: 'CHALLENGE_EXPIRED' };
  }
  
  await transitionStatus(env, challenge, 'AWAITING_GATEKEEPER');
  
  logger.info('challenge_accepted', { 
    challenge_id: challengeId,
    counterparty: userId,
  });
  
  await emitEvent(env, {
    type: 'challenge.accepted',
    challenge_id: challengeId,
    counterparty_user_id: userId,
  });
  
  // For Gatekeeper mode, automatically start verification
  if (challenge.mode === 'GATEKEEPER') {
    return await runVerificationPhase(env, challengeId);
  }
  
  return (await getChallengeById(env, challengeId))!;
}

/**
 * Run the Gatekeeper verification phase.
 * Both parties must verify wallet + pass funds check.
 * Transitions: AWAITING_GATEKEEPER -> INTENT_LOCKED or CANCELLED
 */
export async function runVerificationPhase(
  env: Env,
  challengeId: string
): Promise<Challenge> {
  const challenge = await getChallengeById(env, challengeId);
  
  if (!challenge || challenge.status !== 'AWAITING_GATEKEEPER') {
    throw { code: 'CHALLENGE_INVALID_STATUS_FOR_ACCEPT' };
  }
  
  logger.info('verification_starting', { challenge_id: challengeId });
  
  await emitEvent(env, {
    type: 'challenge.gatekeeper_verification_required',
    challenge_id: challengeId,
  });
  
  // Run verification for both parties
  const result = await runGatekeeperVerification(env, challenge);
  
  if (result.allPassed) {
    // All checks passed - lock intent
    await transitionStatus(env, challenge, 'INTENT_LOCKED');
    
    // Create commitment hashes
    await createIntentCommitment(env, challenge);
    
    logger.info('intent_locked', { challenge_id: challengeId });
    
    await emitEvent(env, {
      type: 'challenge.intent_locked',
      challenge_id: challengeId,
    });
  } else {
    // Verification failed - cancel
    await transitionStatus(env, challenge, 'CANCELLED');
    
    logger.warn('verification_failed', { 
      challenge_id: challengeId,
      failures: result.failures,
    });
    
    await emitEvent(env, {
      type: 'challenge.verification_failed',
      challenge_id: challengeId,
      failures: result.failures,
    });
  }
  
  return (await getChallengeById(env, challengeId))!;
}

/**
 * Mark challenge as complete (called by both parties).
 * When both parties complete, transitions to COMPLETED.
 */
export async function completeChallenge(
  env: Env,
  challengeId: string,
  userId: string,
  resolution?: Record<string, unknown>
): Promise<Challenge> {
  const challenge = await getChallengeById(env, challengeId);
  
  if (!challenge) {
    throw { code: 'CHALLENGE_NOT_FOUND' };
  }
  
  if (!['INTENT_LOCKED', 'ACTIVE', 'AWAITING_RESOLUTION'].includes(challenge.status)) {
    throw { code: 'CHALLENGE_INVALID_STATUS_FOR_RESOLVE' };
  }
  
  // Record this user's completion
  await recordUserCompletion(env, challengeId, userId, resolution);
  
  // Check if both parties have completed
  const completions = await getCompletions(env, challengeId);
  const creatorCompleted = completions.some(c => c.user_id === challenge.creator_user_id);
  const counterpartyCompleted = completions.some(c => c.user_id === challenge.counterparty_user_id);
  
  if (creatorCompleted && counterpartyCompleted) {
    // Both done - finalize
    await transitionStatus(env, challenge, 'COMPLETED');
    
    // Create final attestation
    const attestation = await createFinalAttestation(env, challenge);
    
    logger.info('challenge_completed', { 
      challenge_id: challengeId,
      final_hash: attestation.final_hash,
    });
    
    await emitEvent(env, {
      type: 'challenge.completed',
      challenge_id: challengeId,
      final_hash: attestation.final_hash,
    });
  } else {
    // Waiting for other party
    if (challenge.status === 'INTENT_LOCKED') {
      await transitionStatus(env, challenge, 'AWAITING_RESOLUTION');
    }
    
    logger.info('completion_recorded', { 
      challenge_id: challengeId,
      user_id: userId,
      waiting_for: creatorCompleted ? 'counterparty' : 'creator',
    });
  }
  
  return (await getChallengeById(env, challengeId))!;
}

// ═══════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════

async function transitionStatus(
  env: Env,
  challenge: Challenge,
  newStatus: ChallengeStatus
): Promise<void> {
  const validation = validateTransition(challenge, newStatus);
  
  if (!validation.valid) {
    logger.error('invalid_transition', {
      challenge_id: challenge.id,
      from: challenge.status,
      to: newStatus,
      error: validation.error,
    });
    throw { code: 'CHALLENGE_INVALID_TRANSITION' };
  }
  
  const updates: Record<string, unknown> = {
    status: newStatus,
    updated_at: now(),
  };
  
  // Set timestamps based on status
  if (newStatus === 'INTENT_LOCKED') {
    updates.intent_locked_at = now();
  } else if (newStatus === 'COMPLETED') {
    updates.resolved_at = now();
  }
  
  const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), challenge.id];
  
  await execute(
    env.TATTLEHASH_DB,
    `UPDATE challenges SET ${setClauses} WHERE id = ?`,
    values
  );
  
  logger.info('status_transitioned', {
    challenge_id: challenge.id,
    from: challenge.status,
    to: newStatus,
  });
}

async function getChallengeById(env: Env, id: string): Promise<Challenge | null> {
  return queryOne<Challenge>(
    env.TATTLEHASH_DB,
    'SELECT * FROM challenges WHERE id = ?',
    [id]
  );
}

function validateModeRequirements(input: CreateChallengeInput): void {
  if (input.mode === 'SOLO' && input.counterparty_user_id) {
    throw { code: 'CHALLENGE_SOLO_NO_COUNTERPARTY' };
  }
  
  if (input.mode === 'FIRE' && !input.fire_config) {
    throw { code: 'CHALLENGE_FIRE_CONFIG_REQUIRED' };
  }
  
  if (input.mode !== 'SOLO' && !input.counterparty_user_id) {
    throw { code: 'CHALLENGE_COUNTERPARTY_REQUIRED' };
  }
}

async function insertGatekeeperRequirements(
  env: Env,
  challengeId: string,
  requirements: CreateChallengeInput['gatekeeper_requirements']
): Promise<void> {
  if (!requirements) return;
  
  const insertFundsRequirement = async (
    userId: string,
    wallet: string,
    network: string,
    check: { asset_type: string; token_address?: string; min_balance: string; currency_symbol: string }
  ) => {
    await execute(
      env.TATTLEHASH_DB,
      `INSERT INTO funds_requirements (
        id, challenge_id, user_id, wallet_address, network,
        asset_type, token_address, min_balance, currency_symbol, snapshot_policy
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        generateId(),
        challengeId,
        userId,
        wallet.toLowerCase(),
        network,
        check.asset_type,
        check.token_address ?? null,
        check.min_balance,
        check.currency_symbol,
        'AT_INTENT_LOCK',
      ]
    );
  };
  
  // Creator requirements
  if (requirements.creator) {
    for (const check of requirements.creator.funds_checks || []) {
      await insertFundsRequirement(
        'CREATOR_PLACEHOLDER', // Will be replaced with actual user ID
        requirements.creator.wallet_address,
        requirements.creator.network,
        check
      );
    }
  }
  
  // Counterparty requirements
  if (requirements.counterparty) {
    for (const check of requirements.counterparty.funds_checks || []) {
      await insertFundsRequirement(
        'COUNTERPARTY_PLACEHOLDER',
        requirements.counterparty.wallet_address,
        requirements.counterparty.network,
        check
      );
    }
  }
}

async function createIntentCommitment(env: Env, challenge: Challenge): Promise<void> {
  // Import existing hashing functions
  const { commitInitiator, commitCounter, commitFinal } = await import('../hashing');
  
  const initiatorPayload = {
    ctx: 'tattlehash.gatekeeper.v2',
    type: 'initiator',
    ts: Date.now(),
    challenge_id: challenge.id,
    mode: challenge.mode,
    creator: challenge.creator_user_id,
  };
  
  const I = await commitInitiator(initiatorPayload);
  
  const counterPayload = {
    ctx: 'tattlehash.gatekeeper.v2',
    type: 'counter',
    ts: Date.now(),
    challenge_id: challenge.id,
    initiator_hash: I,
    counterparty: challenge.counterparty_user_id,
  };
  
  const C = await commitCounter(counterPayload);
  const FINAL = await commitFinal(I, C);
  
  // Store in attestations table
  await execute(
    env.TATTLEHASH_DB,
    `INSERT INTO attestations (
      id, challenge_id, user_id, type, status,
      payload, initiator_hash, counter_hash, final_hash, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      generateId(),
      challenge.id,
      challenge.creator_user_id,
      'AGREEMENT',
      'PENDING',
      JSON.stringify({ initiator: initiatorPayload, counter: counterPayload }),
      I,
      C,
      FINAL,
      now(),
      now(),
    ]
  );
}

async function recordUserCompletion(
  env: Env,
  challengeId: string,
  userId: string,
  resolution?: Record<string, unknown>
): Promise<void> {
  // Use KV for quick completion tracking
  const key = `completion:${challengeId}:${userId}`;
  await env.GATE_KV.put(key, JSON.stringify({
    user_id: userId,
    completed_at: now(),
    resolution,
  }), { expirationTtl: 86400 * 30 }); // 30 days
}

async function getCompletions(
  env: Env,
  challengeId: string
): Promise<Array<{ user_id: string; completed_at: string }>> {
  const { keys } = await env.GATE_KV.list({ prefix: `completion:${challengeId}:` });
  
  const completions = await Promise.all(
    keys.map(async ({ name }) => {
      const data = await env.GATE_KV.get(name, 'json');
      return data as { user_id: string; completed_at: string };
    })
  );
  
  return completions.filter(Boolean);
}
```

---

## Verification Runner

### src/orchestration/verification.ts

```typescript
/**
 * Parallel verification runner for Gatekeeper mode.
 * Runs wallet ownership + funds checks for both parties concurrently.
 */

import { createWalletChallenge, verifyWalletSignature } from '../gatekeeper/wallet';
import { checkFundsThreshold } from '../gatekeeper/funds/check';
import { query } from '../db';
import { logger } from '../lib/logger';
import type { Env } from '../types';
import type { Challenge } from './types';

export interface VerificationResult {
  allPassed: boolean;
  creatorWallet: 'PENDING' | 'VERIFIED' | 'FAILED';
  creatorFunds: 'PENDING' | 'PASSED' | 'FAILED';
  counterpartyWallet: 'PENDING' | 'VERIFIED' | 'FAILED';
  counterpartyFunds: 'PENDING' | 'PASSED' | 'FAILED';
  failures: string[];
}

/**
 * Run all Gatekeeper verifications for a challenge.
 * 
 * In production, wallet verification requires user interaction (signing).
 * This function checks if verifications are complete and runs funds checks.
 */
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
  
  // Get wallet verifications (user must have completed these)
  const walletVerifications = await query(
    env.TATTLEHASH_DB,
    `SELECT * FROM wallet_verification_challenges 
     WHERE user_id IN (?, ?) AND status = 'VERIFIED'
     ORDER BY verified_at DESC`,
    [challenge.creator_user_id, challenge.counterparty_user_id]
  );
  
  // Check creator wallet
  const creatorWalletVerified = walletVerifications.some(
    v => v.user_id === challenge.creator_user_id
  );
  result.creatorWallet = creatorWalletVerified ? 'VERIFIED' : 'PENDING';
  
  // Check counterparty wallet
  const counterpartyWalletVerified = walletVerifications.some(
    v => v.user_id === challenge.counterparty_user_id
  );
  result.counterpartyWallet = counterpartyWalletVerified ? 'VERIFIED' : 'PENDING';
  
  // If wallets not verified, can't proceed with funds check
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
    r => r.user_id === challenge.creator_user_id || r.user_id === 'CREATOR_PLACEHOLDER'
  );
  const counterpartyReqs = requirements.filter(
    r => r.user_id === challenge.counterparty_user_id || r.user_id === 'COUNTERPARTY_PLACEHOLDER'
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
  
  result.allPassed = result.failures.length === 0;
  
  logger.info('verification_complete', {
    challenge_id: challenge.id,
    result,
  });
  
  return result;
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
        logger.error('funds_check_error', {
          challenge_id: challengeId,
          requirement_id: req.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return { status: 'FAILED' as const };
      }
    })
  );
  
  return results;
}

/**
 * Check if a user has a verified wallet for a challenge.
 * Users must call /gatekeeper/v2/wallet/challenge and /verify separately.
 */
export async function hasVerifiedWallet(
  env: Env,
  userId: string,
  walletAddress: string
): Promise<boolean> {
  const verification = await query(
    env.TATTLEHASH_DB,
    `SELECT id FROM wallet_verification_challenges 
     WHERE user_id = ? AND wallet_address = ? AND status = 'VERIFIED'
     ORDER BY verified_at DESC LIMIT 1`,
    [userId, walletAddress.toLowerCase()]
  );
  
  return verification.length > 0;
}
```

---

## Attestation Generator

### src/orchestration/attestation.ts

```typescript
/**
 * Final attestation creation.
 * Generates the immutable proof record when a challenge completes.
 */

import { generateId, now } from '../db';
import { queryOne, execute } from '../db';
import { logger } from '../lib/logger';
import type { Env } from '../types';
import type { Challenge } from './types';

export interface Attestation {
  id: string;
  challenge_id: string;
  initiator_hash: string;
  counter_hash: string;
  final_hash: string;
  created_at: string;
}

/**
 * Create the final attestation for a completed challenge.
 * Retrieves the pending attestation and marks it as valid.
 */
export async function createFinalAttestation(
  env: Env,
  challenge: Challenge
): Promise<Attestation> {
  // Get the pending attestation created at intent lock
  const pending = await queryOne<Attestation>(
    env.TATTLEHASH_DB,
    `SELECT * FROM attestations 
     WHERE challenge_id = ? AND status = 'PENDING'
     ORDER BY created_at DESC LIMIT 1`,
    [challenge.id]
  );
  
  if (!pending) {
    throw new Error(`No pending attestation for challenge ${challenge.id}`);
  }
  
  // Mark as valid
  await execute(
    env.TATTLEHASH_DB,
    `UPDATE attestations SET status = 'VALID', updated_at = ? WHERE id = ?`,
    [now(), pending.id]
  );
  
  // Also update the challenge with final hash
  await execute(
    env.TATTLEHASH_DB,
    `UPDATE challenges SET 
       resolution_payload = ?,
       updated_at = ?
     WHERE id = ?`,
    [
      JSON.stringify({
        final_hash: pending.final_hash,
        finalized_at: now(),
      }),
      now(),
      challenge.id,
    ]
  );
  
  // Store in KV for fast retrieval
  await env.GATE_KV.put(
    `proof:${challenge.id}`,
    JSON.stringify({
      id: challenge.id,
      mode: challenge.mode,
      title: challenge.title,
      status: 'COMPLETED',
      initiator_hash: pending.initiator_hash,
      counter_hash: pending.counter_hash,
      final_hash: pending.final_hash,
      created_at: challenge.created_at,
      completed_at: now(),
    }),
    { expirationTtl: 86400 * 365 } // 1 year
  );
  
  // Queue anchor job for L1 anchoring
  await env.TATTLEHASH_QUEUE.send({
    type: 'anchor',
    challenge_id: challenge.id,
    final_hash: pending.final_hash,
  });
  
  logger.info('attestation_finalized', {
    challenge_id: challenge.id,
    attestation_id: pending.id,
    final_hash: pending.final_hash,
  });
  
  return {
    ...pending,
    status: 'VALID',
  } as Attestation;
}
```

---

## HTTP Handlers

### src/handlers/challenges.ts

```typescript
/**
 * HTTP handlers for challenge endpoints.
 */

import { ok, err } from '../lib/http';
import { createError } from '../errors';
import { parseBody } from '../utils/validate';
import {
  createChallenge,
  sendChallenge,
  acceptChallenge,
  completeChallenge,
} from '../orchestration';
import { getChallengeById } from '../challenges/queries';
import {
  CreateChallengeRequestSchema,
  AcceptChallengeRequestSchema,
  ResolveChallengeRequestSchema,
} from '../challenges/schemas';
import type { Env } from '../types';

/**
 * POST /challenges
 */
export async function postChallenge(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const data = await parseBody(request, CreateChallengeRequestSchema);
    
    // Get user ID from auth (simplified - implement proper auth)
    const userId = request.headers.get('X-User-ID') || 'anonymous';
    
    const challenge = await createChallenge(env, data, userId);
    
    return ok(challenge, { status: 201 });
  } catch (e: any) {
    if (e.code) {
      return createError(e.code, e.details);
    }
    console.error('Create challenge error:', e);
    return createError('INTERNAL_ERROR');
  }
}

/**
 * GET /challenges/:id
 */
export async function getChallenge(
  request: Request,
  env: Env,
  challengeId: string
): Promise<Response> {
  try {
    const challenge = await getChallengeById(env, challengeId);
    
    if (!challenge) {
      return createError('CHALLENGE_NOT_FOUND');
    }
    
    return ok(challenge);
  } catch (e: any) {
    if (e.code) {
      return createError(e.code, e.details);
    }
    console.error('Get challenge error:', e);
    return createError('INTERNAL_ERROR');
  }
}

/**
 * POST /challenges/:id/send
 */
export async function postChallengeSend(
  request: Request,
  env: Env,
  challengeId: string
): Promise<Response> {
  try {
    const userId = request.headers.get('X-User-ID') || 'anonymous';
    
    const challenge = await sendChallenge(env, challengeId, userId);
    
    return ok(challenge);
  } catch (e: any) {
    if (e.code) {
      return createError(e.code, e.details);
    }
    console.error('Send challenge error:', e);
    return createError('INTERNAL_ERROR');
  }
}

/**
 * POST /challenges/:id/accept
 */
export async function postChallengeAccept(
  request: Request,
  env: Env,
  challengeId: string
): Promise<Response> {
  try {
    const data = await parseBody(request, AcceptChallengeRequestSchema);
    const userId = request.headers.get('X-User-ID') || 'anonymous';
    
    const challenge = await acceptChallenge(env, challengeId, data, userId);
    
    return ok(challenge);
  } catch (e: any) {
    if (e.code) {
      return createError(e.code, e.details);
    }
    console.error('Accept challenge error:', e);
    return createError('INTERNAL_ERROR');
  }
}

/**
 * POST /challenges/:id/complete
 */
export async function postChallengeComplete(
  request: Request,
  env: Env,
  challengeId: string
): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({}));
    const userId = request.headers.get('X-User-ID') || 'anonymous';
    
    const challenge = await completeChallenge(
      env, 
      challengeId, 
      userId,
      body.resolution
    );
    
    return ok(challenge);
  } catch (e: any) {
    if (e.code) {
      return createError(e.code, e.details);
    }
    console.error('Complete challenge error:', e);
    return createError('INTERNAL_ERROR');
  }
}
```

---

## Public Proof Handler

### src/handlers/proof.ts

```typescript
/**
 * Public proof view handler.
 * Returns shareable proof data for a completed challenge.
 */

import { ok } from '../lib/http';
import { createError } from '../errors';
import type { Env } from '../types';

/**
 * GET /proof/:id
 */
export async function getProof(
  request: Request,
  env: Env,
  proofId: string
): Promise<Response> {
  // Try KV first (fast path)
  const cached = await env.GATE_KV.get(`proof:${proofId}`, 'json');
  
  if (cached) {
    // Check Accept header for format
    const accept = request.headers.get('Accept') || '';
    
    if (accept.includes('application/json')) {
      return ok(cached);
    }
    
    // Return HTML page
    return new Response(renderProofPage(cached as any), {
      headers: { 'Content-Type': 'text/html' },
    });
  }
  
  // Fall back to D1
  const challenge = await env.TATTLEHASH_DB.prepare(
    `SELECT c.*, a.initiator_hash, a.counter_hash, a.final_hash
     FROM challenges c
     LEFT JOIN attestations a ON a.challenge_id = c.id AND a.status = 'VALID'
     WHERE c.id = ? AND c.status = 'COMPLETED'`
  ).bind(proofId).first();
  
  if (!challenge) {
    return createError('NOT_FOUND');
  }
  
  const proof = {
    id: challenge.id,
    mode: challenge.mode,
    title: challenge.title,
    status: challenge.status,
    initiator_hash: challenge.initiator_hash,
    counter_hash: challenge.counter_hash,
    final_hash: challenge.final_hash,
    created_at: challenge.created_at,
    completed_at: challenge.resolved_at,
    verification_url: `https://api.tattlehash.com/proof/${challenge.id}`,
  };
  
  // Cache for next time
  await env.GATE_KV.put(`proof:${proofId}`, JSON.stringify(proof), {
    expirationTtl: 86400 * 365,
  });
  
  const accept = request.headers.get('Accept') || '';
  if (accept.includes('application/json')) {
    return ok(proof);
  }
  
  return new Response(renderProofPage(proof), {
    headers: { 'Content-Type': 'text/html' },
  });
}

function renderProofPage(proof: {
  id: string;
  mode: string;
  title: string;
  status: string;
  initiator_hash: string;
  counter_hash: string;
  final_hash: string;
  created_at: string;
  completed_at: string;
  verification_url: string;
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>TattleHash Proof - ${proof.title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .card {
      background: white;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3);
      max-width: 500px;
      width: 100%;
      overflow: hidden;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 24px;
      text-align: center;
    }
    .header h1 { font-size: 24px; margin-bottom: 8px; }
    .header .status {
      display: inline-block;
      background: rgba(255,255,255,0.2);
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 14px;
    }
    .body { padding: 24px; }
    .field { margin-bottom: 16px; }
    .field label {
      display: block;
      font-size: 12px;
      color: #666;
      text-transform: uppercase;
      margin-bottom: 4px;
    }
    .field .value {
      font-size: 14px;
      color: #333;
      word-break: break-all;
      font-family: 'SF Mono', Monaco, monospace;
      background: #f5f5f5;
      padding: 8px;
      border-radius: 4px;
    }
    .hash { font-size: 12px !important; }
    .footer {
      background: #f9f9f9;
      padding: 16px 24px;
      text-align: center;
      font-size: 12px;
      color: #666;
    }
    .footer a { color: #667eea; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h1>${escapeHtml(proof.title)}</h1>
      <span class="status">✓ ${proof.status}</span>
    </div>
    <div class="body">
      <div class="field">
        <label>Mode</label>
        <div class="value">${proof.mode}</div>
      </div>
      <div class="field">
        <label>Created</label>
        <div class="value">${new Date(proof.created_at).toLocaleString()}</div>
      </div>
      <div class="field">
        <label>Completed</label>
        <div class="value">${new Date(proof.completed_at).toLocaleString()}</div>
      </div>
      <div class="field">
        <label>Initiator Hash</label>
        <div class="value hash">${proof.initiator_hash}</div>
      </div>
      <div class="field">
        <label>Counter Hash</label>
        <div class="value hash">${proof.counter_hash}</div>
      </div>
      <div class="field">
        <label>Final Hash</label>
        <div class="value hash">${proof.final_hash}</div>
      </div>
    </div>
    <div class="footer">
      Verified by <a href="https://tattlehash.com">TattleHash</a><br>
      Proof ID: ${proof.id}
    </div>
  </div>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

---

## Solo Mode Example

For completeness, here's how Solo mode differs:

```typescript
// Solo mode is simpler - no counterparty, no verification phase

export async function createSoloAttestation(
  env: Env,
  input: CreateChallengeInput,
  userId: string
): Promise<Challenge> {
  // Create challenge
  const challenge = await createChallenge(env, {
    ...input,
    mode: 'SOLO',
  }, userId);
  
  // Solo can immediately lock intent (no counterparty)
  await transitionStatus(env, challenge, 'INTENT_LOCKED');
  
  // If no oracle required, immediately complete
  if (!input.oracle_requirement) {
    await transitionStatus(env, challenge, 'COMPLETED');
    await createFinalAttestation(env, challenge);
  }
  
  return challenge;
}
```

---

## Testing the Flow

### test/integration/orchestration.spec.ts

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockEnv } from '../mocks/env';
import { mockRpcFetch, mockRpcResponses } from '../mocks/rpc';
import { 
  createChallenge, 
  sendChallenge,
  acceptChallenge, 
  completeChallenge 
} from '../../src/orchestration';

describe('Challenge Orchestration', () => {
  let env: ReturnType<typeof createMockEnv>;
  
  beforeEach(() => {
    env = createMockEnv();
    global.fetch = mockRpcFetch(mockRpcResponses.balanceHigh);
  });
  
  describe('Gatekeeper Mode Full Flow', () => {
    it('completes full lifecycle', async () => {
      // 1. Creator creates challenge
      const challenge = await createChallenge(env, {
        mode: 'GATEKEEPER',
        title: 'Test P2P Trade',
        counterparty_user_id: 'bob',
        gatekeeper_requirements: {
          creator: {
            wallet_address: '0xaaa...',
            network: 'eth-mainnet',
            funds_checks: [{ asset_type: 'NATIVE', min_balance: '1', currency_symbol: 'ETH' }],
          },
          counterparty: {
            wallet_address: '0xbbb...',
            network: 'eth-mainnet',
            funds_checks: [{ asset_type: 'NATIVE', min_balance: '1', currency_symbol: 'ETH' }],
          },
        },
      }, 'alice');
      
      expect(challenge.status).toBe('DRAFT');
      
      // 2. Creator sends to counterparty
      const sent = await sendChallenge(env, challenge.id, 'alice');
      expect(sent.status).toBe('AWAITING_COUNTERPARTY');
      
      // 3. Mock wallet verifications exist
      // (In real flow, users would have verified wallets separately)
      await mockWalletVerification(env, 'alice', '0xaaa...');
      await mockWalletVerification(env, 'bob', '0xbbb...');
      
      // 4. Counterparty accepts
      const accepted = await acceptChallenge(
        env, 
        challenge.id, 
        { wallet_address: '0xbbb...' },
        'bob'
      );
      
      // Should run verification and lock intent
      expect(accepted.status).toBe('INTENT_LOCKED');
      
      // 5. Both complete
      await completeChallenge(env, challenge.id, 'alice');
      const completed = await completeChallenge(env, challenge.id, 'bob');
      
      expect(completed.status).toBe('COMPLETED');
      expect(completed.final_hash).toBeDefined();
    });
  });
});

async function mockWalletVerification(env: any, userId: string, walletAddress: string) {
  await env.TATTLEHASH_DB.prepare(
    `INSERT INTO wallet_verification_challenges 
     (id, user_id, wallet_address, chain_id, challenge_nonce, message, status, verified_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, 'VERIFIED', ?, ?)`
  ).bind(
    crypto.randomUUID(),
    userId,
    walletAddress.toLowerCase(),
    'eip155:1',
    'test-nonce',
    'test message',
    new Date().toISOString(),
    new Date(Date.now() + 3600000).toISOString()
  ).run();
}
```

---

## Summary

This guide shows how:

1. **Challenge creation** validates mode requirements and stores config
2. **Sending** transitions to `AWAITING_COUNTERPARTY` and notifies
3. **Acceptance** triggers the Gatekeeper verification phase
4. **Verification** runs wallet + funds checks in parallel
5. **Intent lock** creates the I → C → FINAL commitment chain
6. **Completion** (by both parties) finalizes the attestation
7. **Proof page** provides a shareable, public verification URL

The orchestrator is the "glue" that coordinates all components while keeping each piece (wallet verification, funds checking, state machines) independent and testable.
