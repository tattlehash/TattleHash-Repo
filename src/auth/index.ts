/**
 * Authentication module exports.
 */

export { getUserById, getUserByWallet, createUser, getOrCreateUser, touchUser } from './users';
export type { User } from './users';

export { generateToken, verifyToken, extractBearerToken } from './jwt';
export type { TokenPayload, AuthToken } from './jwt';

export {
    hashPassword,
    verifyPassword,
    validatePassword,
    validateEmail,
    validateUsername,
    generateSecureToken,
    hashToken,
} from './password';
