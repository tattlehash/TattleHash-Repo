
import type { Challenge, ChallengeStatus } from './types';

const VALID_TRANSITIONS: Record<ChallengeStatus, ChallengeStatus[]> = {
    DRAFT: ['AWAITING_COUNTERPARTY', 'CANCELLED'],
    AWAITING_COUNTERPARTY: ['AWAITING_GATEKEEPER', 'EXPIRED', 'CANCELLED'],
    AWAITING_GATEKEEPER: ['INTENT_LOCKED', 'CANCELLED'],
    INTENT_LOCKED: ['AWAITING_RESOLUTION', 'COMPLETED', 'CANCELLED'],
    AWAITING_RESOLUTION: ['COMPLETED', 'DISPUTED', 'CANCELLED'],
    COMPLETED: [],
    CANCELLED: [],
    EXPIRED: [],
    DISPUTED: ['COMPLETED', 'CANCELLED'],
};

export interface TransitionValidation {
    valid: boolean;
    error?: string;
}

export function validateTransition(
    challenge: Challenge,
    newStatus: ChallengeStatus
): TransitionValidation {
    const allowedTransitions = VALID_TRANSITIONS[challenge.status];

    if (!allowedTransitions.includes(newStatus)) {
        return {
            valid: false,
            error: `Cannot transition from ${challenge.status} to ${newStatus}`,
        };
    }

    return { valid: true };
}

export function canTransition(
    challenge: Challenge,
    newStatus: ChallengeStatus
): boolean {
    return validateTransition(challenge, newStatus).valid;
}
