/**
 * Gatekeeper Profiles and Check Types
 *
 * Manage verification profiles and their associated checks.
 */

import { query, queryOne } from '../../db';
import type { Env } from '../../types';
import type {
    ProfileRow,
    CheckTypeRow,
    ProfileCheckRow,
    Profile,
    CheckType,
} from './types';

// ============================================================================
// Get All Profiles
// ============================================================================

export async function getProfiles(env: Env): Promise<Profile[]> {
    const profiles = await query<ProfileRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_profiles WHERE enabled = 1 ORDER BY sort_order`
    );

    const result: Profile[] = [];

    for (const profile of profiles) {
        const checks = await getProfileChecks(env, profile.id);
        result.push({
            id: profile.id,
            name: profile.name,
            description: profile.description,
            target_market: profile.target_market,
            checks,
        });
    }

    return result;
}

// ============================================================================
// Get Profile by ID
// ============================================================================

export async function getProfile(env: Env, profileId: string): Promise<Profile | null> {
    const profile = await queryOne<ProfileRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_profiles WHERE id = ? AND enabled = 1`,
        [profileId]
    );

    if (!profile) {
        return null;
    }

    const checks = await getProfileChecks(env, profile.id);

    return {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        target_market: profile.target_market,
        checks,
    };
}

// ============================================================================
// Get Checks for a Profile
// ============================================================================

export async function getProfileChecks(env: Env, profileId: string): Promise<CheckType[]> {
    const checks = await query<CheckTypeRow & { required: number }>(
        env.TATTLEHASH_DB,
        `SELECT ct.*, pc.required
         FROM gatekeeper_check_types ct
         JOIN gatekeeper_profile_checks pc ON ct.id = pc.check_type_id
         WHERE pc.profile_id = ? AND ct.enabled = 1
         ORDER BY pc.sort_order`,
        [profileId]
    );

    return checks.map(check => ({
        id: check.id,
        category: check.category,
        name: check.name,
        description: check.description,
        method: check.method,
        badge_required: check.badge_required === 1,
    }));
}

// ============================================================================
// Get All Check Types
// ============================================================================

export async function getAllCheckTypes(env: Env): Promise<CheckType[]> {
    const checks = await query<CheckTypeRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_check_types WHERE enabled = 1 ORDER BY sort_order`
    );

    return checks.map(check => ({
        id: check.id,
        category: check.category,
        name: check.name,
        description: check.description,
        method: check.method,
        badge_required: check.badge_required === 1,
    }));
}

// ============================================================================
// Get Check Type by ID
// ============================================================================

export async function getCheckType(env: Env, checkTypeId: string): Promise<CheckTypeRow | null> {
    return queryOne<CheckTypeRow>(
        env.TATTLEHASH_DB,
        `SELECT * FROM gatekeeper_check_types WHERE id = ?`,
        [checkTypeId]
    );
}
