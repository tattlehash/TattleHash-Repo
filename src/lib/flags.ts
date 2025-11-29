import { Env } from '../types';

export function getFlag(flag: string, env: Env): boolean {
    // Check environment variable first
    const value = env[flag];

    if (value === 'true' || value === true) {
        return true;
    }

    if (value === 'false' || value === false) {
        return false;
    }

    // Default to false if not set
    return false;
}
