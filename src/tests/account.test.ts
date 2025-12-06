/**
 * Account System Tests
 *
 * Tests for email/password registration, login, wallet login,
 * profile management, and password reset flows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    hashPassword,
    verifyPassword,
    validatePassword,
    validateUsername,
    validateEmail,
    generateSecureToken,
    hashToken,
} from '../auth/password';

// Mock the database module
vi.mock('../db', () => ({
    queryOne: vi.fn(),
    query: vi.fn(),
    execute: vi.fn(),
}));

// Mock the auth middleware
vi.mock('../middleware/auth', () => ({
    authenticateRequest: vi.fn(),
}));

// Mock the credits module
vi.mock('../credits', () => ({
    getCreditSummary: vi.fn(),
}));

// Mock the wallet recovery
vi.mock('../gatekeeper/wallet/recovery', () => ({
    recoverAddressFromSignature: vi.fn(),
}));

import { queryOne, query, execute } from '../db';
import { authenticateRequest } from '../middleware/auth';
import { getCreditSummary } from '../credits';
import { recoverAddressFromSignature } from '../gatekeeper/wallet/recovery';
import type { Env } from '../types';

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockEnv(overrides: Partial<Env> = {}): Env {
    return {
        TATTLEHASH_DB: {} as any,
        TATTLEHASH_KV: {} as any,
        TATTLEHASH_CONTENT_KV: {} as any,
        TATTLEHASH_ANCHOR_KV: {} as any,
        TATTLEHASH_ERROR_KV: {} as any,
        ATT_KV: {} as any,
        GATE_KV: {} as any,
        SHIELD_KV: {} as any,
        TATTLEHASH_QUEUE: {} as any,
        AUTH_SECRET: 'test-auth-secret-32-chars-long!!',
        NODE_ENV: 'test',
        ...overrides,
    };
}

function createTestRequest(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>
): Request {
    return new Request(`https://test.local${path}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
    });
}

// ============================================================================
// Password Utilities Tests
// ============================================================================

describe('Password Utilities', () => {
    describe('hashPassword / verifyPassword', () => {
        it('should hash and verify a password', async () => {
            const password = 'MySecurePassword123!';
            const hash = await hashPassword(password);

            expect(hash).toContain('$');
            expect(hash.split('$')).toHaveLength(3);

            const isValid = await verifyPassword(password, hash);
            expect(isValid).toBe(true);
        });

        it('should reject wrong password', async () => {
            const password = 'MySecurePassword123!';
            const hash = await hashPassword(password);

            const isValid = await verifyPassword('WrongPassword', hash);
            expect(isValid).toBe(false);
        });

        it('should produce different hashes for same password (salt)', async () => {
            const password = 'MySecurePassword123!';
            const hash1 = await hashPassword(password);
            const hash2 = await hashPassword(password);

            expect(hash1).not.toBe(hash2);

            // Both should still verify
            expect(await verifyPassword(password, hash1)).toBe(true);
            expect(await verifyPassword(password, hash2)).toBe(true);
        });

        it('should reject malformed hash', async () => {
            const isValid = await verifyPassword('password', 'malformed-hash');
            expect(isValid).toBe(false);
        });
    });

    describe('validatePassword', () => {
        it('should accept valid password', () => {
            expect(validatePassword('password123')).toBeNull();
            expect(validatePassword('MySecure!@#$%^&*()')).toBeNull();
        });

        it('should reject short password', () => {
            const error = validatePassword('short');
            expect(error).toContain('at least 8 characters');
        });

        it('should reject too long password', () => {
            const error = validatePassword('a'.repeat(200));
            expect(error).toContain('at most 128 characters');
        });
    });

    describe('validateUsername', () => {
        it('should accept valid usernames', () => {
            expect(validateUsername('john_doe')).toBeNull();
            expect(validateUsername('user123')).toBeNull();
            expect(validateUsername('my-name')).toBeNull();
        });

        it('should reject short username', () => {
            const error = validateUsername('ab');
            expect(error).toContain('at least 3 characters');
        });

        it('should reject invalid characters', () => {
            const error = validateUsername('user name');
            expect(error).toContain('only contain letters');
        });
    });

    describe('validateEmail', () => {
        it('should accept valid emails', () => {
            expect(validateEmail('test@example.com')).toBe(true);
            expect(validateEmail('user.name+tag@domain.co.uk')).toBe(true);
        });

        it('should reject invalid emails', () => {
            expect(validateEmail('not-an-email')).toBe(false);
            expect(validateEmail('missing@domain')).toBe(false);
            expect(validateEmail('@nodomain.com')).toBe(false);
        });
    });

    describe('generateSecureToken / hashToken', () => {
        it('should generate 64-char hex token', () => {
            const token = generateSecureToken();
            expect(token).toHaveLength(64);
            expect(token).toMatch(/^[a-f0-9]+$/);
        });

        it('should hash token consistently', async () => {
            const token = generateSecureToken();
            const hash1 = await hashToken(token);
            const hash2 = await hashToken(token);

            expect(hash1).toBe(hash2);
            expect(hash1).toHaveLength(64);
        });
    });
});

// ============================================================================
// Registration Tests
// ============================================================================

describe('POST /auth/register', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should register new user with email and password', async () => {
        vi.mocked(queryOne).mockResolvedValue(null); // No existing user
        vi.mocked(execute).mockResolvedValue(undefined);

        const req = createTestRequest('POST', '/auth/register', {
            email: 'test@example.com',
            password: 'SecurePass123!',
            username: 'testuser',
            display_name: 'Test User',
        });

        const { postRegister } = await import('../handlers/account');
        const res = await postRegister(req, env);
        const body = await res.json() as any;

        expect(res.status).toBe(201);
        expect(body.user_id).toBeDefined();
        expect(body.message).toContain('check your email');
        expect(body.verification_token).toBeDefined(); // Present in test mode
    });

    it('should register without optional fields', async () => {
        vi.mocked(queryOne).mockResolvedValue(null);
        vi.mocked(execute).mockResolvedValue(undefined);

        const req = createTestRequest('POST', '/auth/register', {
            email: 'test2@example.com',
            password: 'SecurePass123!',
        });

        const { postRegister } = await import('../handlers/account');
        const res = await postRegister(req, env);

        expect(res.status).toBe(201);
    });

    it('should reject duplicate email', async () => {
        vi.mocked(queryOne).mockResolvedValue({ id: 'existing-user' }); // Email exists

        const req = createTestRequest('POST', '/auth/register', {
            email: 'duplicate@example.com',
            password: 'SecurePass123!',
        });

        const { postRegister } = await import('../handlers/account');
        const res = await postRegister(req, env);

        expect(res.status).toBe(409);
        const body = await res.json() as any;
        expect(body.error.code).toBe('EMAIL_EXISTS');
    });

    it('should reject duplicate username', async () => {
        // First call (email check) returns null, second (username check) returns existing
        vi.mocked(queryOne)
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ id: 'existing-user' });

        const req = createTestRequest('POST', '/auth/register', {
            email: 'new@example.com',
            password: 'SecurePass123!',
            username: 'duplicateuser',
        });

        const { postRegister } = await import('../handlers/account');
        const res = await postRegister(req, env);

        expect(res.status).toBe(409);
        const body = await res.json() as any;
        expect(body.error.code).toBe('USERNAME_EXISTS');
    });

    it('should reject weak password', async () => {
        const req = createTestRequest('POST', '/auth/register', {
            email: 'weak@example.com',
            password: 'short',
        });

        const { postRegister } = await import('../handlers/account');
        const res = await postRegister(req, env);

        expect(res.status).toBe(400);
    });

    it('should reject invalid email', async () => {
        const req = createTestRequest('POST', '/auth/register', {
            email: 'not-an-email',
            password: 'SecurePass123!',
        });

        const { postRegister } = await import('../handlers/account');
        const res = await postRegister(req, env);

        expect(res.status).toBe(400);
    });
});

// ============================================================================
// Email Verification Tests
// ============================================================================

describe('POST /auth/verify-email', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should verify email with valid token', async () => {
        const token = generateSecureToken();
        const tokenHash = await hashToken(token);

        vi.mocked(queryOne).mockResolvedValue({
            id: 'user-123',
            email_verification_expires_at: Date.now() + 3600000, // 1 hour from now
        });
        vi.mocked(execute).mockResolvedValue(undefined);

        const req = createTestRequest('POST', '/auth/verify-email', { token });

        const { postVerifyEmail } = await import('../handlers/account');
        const res = await postVerifyEmail(req, env);

        expect(res.status).toBe(200);
        const body = await res.json() as any;
        expect(body.message).toContain('verified');
    });

    it('should reject invalid token', async () => {
        vi.mocked(queryOne).mockResolvedValue(null); // Token not found

        const req = createTestRequest('POST', '/auth/verify-email', {
            token: 'a'.repeat(64),
        });

        const { postVerifyEmail } = await import('../handlers/account');
        const res = await postVerifyEmail(req, env);

        expect(res.status).toBe(400);
    });

    it('should reject expired token', async () => {
        vi.mocked(queryOne).mockResolvedValue({
            id: 'user-123',
            email_verification_expires_at: Date.now() - 1000, // Expired
        });

        const req = createTestRequest('POST', '/auth/verify-email', {
            token: 'a'.repeat(64),
        });

        const { postVerifyEmail } = await import('../handlers/account');
        const res = await postVerifyEmail(req, env);

        expect(res.status).toBe(400);
        const body = await res.json() as any;
        expect(body.error.code).toBe('TOKEN_EXPIRED');
    });
});

// ============================================================================
// Login Tests
// ============================================================================

describe('POST /auth/login', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should login with valid credentials', async () => {
        const passwordHash = await hashPassword('TestPass123!');

        vi.mocked(queryOne).mockResolvedValue({
            id: 'user-123',
            email: 'test@example.com',
            username: 'testuser',
            password_hash: passwordHash,
            email_verified: 1,
            auth_method: 'email',
            wallet_address: null,
            login_count: 5,
        });
        vi.mocked(execute).mockResolvedValue(undefined);

        const req = createTestRequest('POST', '/auth/login', {
            email: 'test@example.com',
            password: 'TestPass123!',
        });

        const { postLogin } = await import('../handlers/account');
        const res = await postLogin(req, env);
        const body = await res.json() as any;

        expect(res.status).toBe(200);
        expect(body.token).toBeDefined();
        expect(body.user).toBeDefined();
        expect(body.user.email).toBe('test@example.com');
    });

    it('should reject wrong password', async () => {
        const passwordHash = await hashPassword('CorrectPass123!');

        vi.mocked(queryOne).mockResolvedValue({
            id: 'user-123',
            email: 'test@example.com',
            password_hash: passwordHash,
            email_verified: 1,
        });

        const req = createTestRequest('POST', '/auth/login', {
            email: 'test@example.com',
            password: 'WrongPassword!',
        });

        const { postLogin } = await import('../handlers/account');
        const res = await postLogin(req, env);

        expect(res.status).toBe(401);
        const body = await res.json() as any;
        expect(body.error.code).toBe('INVALID_CREDENTIALS');
    });

    it('should reject non-existent email', async () => {
        vi.mocked(queryOne).mockResolvedValue(null);

        const req = createTestRequest('POST', '/auth/login', {
            email: 'nonexistent@example.com',
            password: 'TestPass123!',
        });

        const { postLogin } = await import('../handlers/account');
        const res = await postLogin(req, env);

        expect(res.status).toBe(401);
    });

    it('should reject unverified email', async () => {
        const passwordHash = await hashPassword('TestPass123!');

        vi.mocked(queryOne).mockResolvedValue({
            id: 'user-123',
            email: 'unverified@example.com',
            password_hash: passwordHash,
            email_verified: 0, // Not verified
        });

        const req = createTestRequest('POST', '/auth/login', {
            email: 'unverified@example.com',
            password: 'TestPass123!',
        });

        const { postLogin } = await import('../handlers/account');
        const res = await postLogin(req, env);

        expect(res.status).toBe(403);
        const body = await res.json() as any;
        expect(body.error.code).toBe('EMAIL_NOT_VERIFIED');
    });
});

// ============================================================================
// Wallet Login Tests
// ============================================================================

describe('POST /auth/login/wallet', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should login with valid wallet signature', async () => {
        const walletAddress = '0x1234567890123456789012345678901234567890';

        vi.mocked(recoverAddressFromSignature).mockResolvedValue(walletAddress);
        vi.mocked(queryOne)
            .mockResolvedValueOnce({ // getUserByWallet
                id: 'user-123',
                wallet_address: walletAddress.toLowerCase(),
                created_at: Date.now(),
                updated_at: Date.now(),
            })
            .mockResolvedValueOnce({ // Full user data
                id: 'user-123',
                wallet_address: walletAddress.toLowerCase(),
                email: null,
                username: null,
                email_verified: 0,
                auth_method: 'wallet',
                login_count: 1,
            });
        vi.mocked(execute).mockResolvedValue(undefined);

        const req = createTestRequest('POST', '/auth/login/wallet', {
            wallet_address: walletAddress,
            signature: '0x' + 'ab'.repeat(65),
            message: 'Sign in to TattleHash',
        });

        const { postWalletLogin } = await import('../handlers/account');
        const res = await postWalletLogin(req, env);
        const body = await res.json() as any;

        expect(res.status).toBe(200);
        expect(body.token).toBeDefined();
    });

    it('should reject invalid signature', async () => {
        vi.mocked(recoverAddressFromSignature).mockRejectedValue(new Error('Invalid signature'));

        const req = createTestRequest('POST', '/auth/login/wallet', {
            wallet_address: '0x1234567890123456789012345678901234567890',
            signature: '0xinvalid',
            message: 'Sign in to TattleHash',
        });

        const { postWalletLogin } = await import('../handlers/account');
        const res = await postWalletLogin(req, env);

        expect(res.status).toBe(401);
    });

    it('should reject mismatched signature', async () => {
        vi.mocked(recoverAddressFromSignature).mockResolvedValue('0xdifferentaddress0000000000000000000000000');

        const req = createTestRequest('POST', '/auth/login/wallet', {
            wallet_address: '0x1234567890123456789012345678901234567890',
            signature: '0x' + 'ab'.repeat(65),
            message: 'Sign in to TattleHash',
        });

        const { postWalletLogin } = await import('../handlers/account');
        const res = await postWalletLogin(req, env);

        expect(res.status).toBe(401);
        const body = await res.json() as any;
        expect(body.error.code).toBe('INVALID_SIGNATURE');
    });
});

// ============================================================================
// Password Reset Tests
// ============================================================================

describe('Password Reset Flow', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('POST /auth/forgot-password', () => {
        it('should request password reset for existing user', async () => {
            vi.mocked(queryOne).mockResolvedValue({ id: 'user-123' });
            vi.mocked(execute).mockResolvedValue(undefined);

            const req = createTestRequest('POST', '/auth/forgot-password', {
                email: 'existing@example.com',
            });

            const { postForgotPassword } = await import('../handlers/account');
            const res = await postForgotPassword(req, env);
            const body = await res.json() as any;

            expect(res.status).toBe(200);
            expect(body.reset_token).toBeDefined(); // In test mode
        });

        it('should not reveal if email exists', async () => {
            vi.mocked(queryOne).mockResolvedValue(null); // Email not found

            const req = createTestRequest('POST', '/auth/forgot-password', {
                email: 'nonexistent@example.com',
            });

            const { postForgotPassword } = await import('../handlers/account');
            const res = await postForgotPassword(req, env);

            // Same response for existing and non-existing email
            expect(res.status).toBe(200);
            const body = await res.json() as any;
            expect(body.message).toContain('If an account exists');
        });
    });

    describe('POST /auth/reset-password', () => {
        it('should reset password with valid token', async () => {
            const token = generateSecureToken();

            vi.mocked(queryOne).mockResolvedValue({
                id: 'reset-token-123',
                user_id: 'user-123',
                expires_at: Date.now() + 3600000, // 1 hour from now
            });
            vi.mocked(execute).mockResolvedValue(undefined);

            const req = createTestRequest('POST', '/auth/reset-password', {
                token,
                new_password: 'NewSecurePass456!',
            });

            const { postResetPassword } = await import('../handlers/account');
            const res = await postResetPassword(req, env);

            expect(res.status).toBe(200);
            expect(execute).toHaveBeenCalledTimes(2); // Update password + mark token used
        });

        it('should reject invalid reset token', async () => {
            vi.mocked(queryOne).mockResolvedValue(null); // Token not found

            const req = createTestRequest('POST', '/auth/reset-password', {
                token: 'a'.repeat(64),
                new_password: 'NewPass123!',
            });

            const { postResetPassword } = await import('../handlers/account');
            const res = await postResetPassword(req, env);

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.code).toBe('INVALID_TOKEN');
        });

        it('should reject expired reset token', async () => {
            vi.mocked(queryOne).mockResolvedValue({
                id: 'reset-token-123',
                user_id: 'user-123',
                expires_at: Date.now() - 1000, // Expired
            });

            const req = createTestRequest('POST', '/auth/reset-password', {
                token: 'a'.repeat(64),
                new_password: 'NewPass123!',
            });

            const { postResetPassword } = await import('../handlers/account');
            const res = await postResetPassword(req, env);

            expect(res.status).toBe(400);
            const body = await res.json() as any;
            expect(body.error.code).toBe('TOKEN_EXPIRED');
        });

        it('should reject weak new password', async () => {
            const req = createTestRequest('POST', '/auth/reset-password', {
                token: 'a'.repeat(64),
                new_password: 'weak',
            });

            const { postResetPassword } = await import('../handlers/account');
            const res = await postResetPassword(req, env);

            expect(res.status).toBe(400);
        });
    });
});

// ============================================================================
// Profile Tests
// ============================================================================

describe('GET /auth/me', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should return user profile', async () => {
        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: true,
            context: {
                userId: 'user-123',
                walletAddress: '0x123',
                user: { id: 'user-123' } as any,
            },
        });

        vi.mocked(queryOne).mockResolvedValue({
            id: 'user-123',
            email: 'test@example.com',
            username: 'testuser',
            display_name: 'Test User',
            wallet_address: '0x123',
            email_verified: 1,
            auth_method: 'email',
            profile_image_url: null,
            preferences: '{}',
            created_at: Date.now(),
            updated_at: Date.now(),
            last_login_at: Date.now(),
            login_count: 5,
        });

        vi.mocked(query).mockResolvedValue([]); // No linked wallets
        vi.mocked(getCreditSummary).mockRejectedValue(new Error('Not available'));

        const req = createTestRequest('GET', '/auth/me', undefined, {
            Authorization: 'Bearer test-token',
        });

        const { getMe } = await import('../handlers/account');
        const res = await getMe(req, env);
        const body = await res.json() as any;

        expect(res.status).toBe(200);
        expect(body.id).toBe('user-123');
        expect(body.email).toBe('test@example.com');
        expect(body.username).toBe('testuser');
    });

    it('should reject unauthenticated request', async () => {
        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: false,
            error: {
                name: 'AppError',
                message: 'Unauthorized',
                status: 401,
                code: 'UNAUTHORIZED',
                details: { reason: 'No token' },
            },
        });

        const req = createTestRequest('GET', '/auth/me');

        const { getMe } = await import('../handlers/account');
        const res = await getMe(req, env);

        expect(res.status).toBe(401);
    });
});

describe('PATCH /auth/profile', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should update display name', async () => {
        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: true,
            context: {
                userId: 'user-123',
                walletAddress: '0x123',
                user: { id: 'user-123' } as any,
            },
        });
        vi.mocked(execute).mockResolvedValue(undefined);

        const req = createTestRequest('PATCH', '/auth/profile', {
            display_name: 'New Display Name',
        }, {
            Authorization: 'Bearer test-token',
        });

        const { patchProfile } = await import('../handlers/account');
        const res = await patchProfile(req, env);

        expect(res.status).toBe(200);
        expect(execute).toHaveBeenCalled();
    });

    it('should reject duplicate username', async () => {
        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: true,
            context: {
                userId: 'user-123',
                walletAddress: '0x123',
                user: { id: 'user-123' } as any,
            },
        });
        vi.mocked(queryOne).mockResolvedValue({ id: 'other-user' }); // Username taken

        const req = createTestRequest('PATCH', '/auth/profile', {
            username: 'takenusername',
        }, {
            Authorization: 'Bearer test-token',
        });

        const { patchProfile } = await import('../handlers/account');
        const res = await patchProfile(req, env);

        expect(res.status).toBe(409);
        const body = await res.json() as any;
        expect(body.error.code).toBe('USERNAME_EXISTS');
    });

    it('should reject empty update', async () => {
        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: true,
            context: {
                userId: 'user-123',
                walletAddress: '0x123',
                user: { id: 'user-123' } as any,
            },
        });

        const req = createTestRequest('PATCH', '/auth/profile', {}, {
            Authorization: 'Bearer test-token',
        });

        const { patchProfile } = await import('../handlers/account');
        const res = await patchProfile(req, env);

        expect(res.status).toBe(400);
    });
});

// ============================================================================
// Preferences Tests
// ============================================================================

describe('Preferences', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should get empty preferences', async () => {
        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: true,
            context: {
                userId: 'user-123',
                walletAddress: '0x123',
                user: { id: 'user-123' } as any,
            },
        });
        vi.mocked(queryOne).mockResolvedValue({ preferences: '{}' });

        const req = createTestRequest('GET', '/auth/preferences', undefined, {
            Authorization: 'Bearer test-token',
        });

        const { getPreferences } = await import('../handlers/account');
        const res = await getPreferences(req, env);
        const body = await res.json() as any;

        expect(res.status).toBe(200);
        expect(body.ok).toBe(true);
        // Empty preferences spread into response
        expect(body).not.toHaveProperty('notifications');
    });

    it('should update preferences', async () => {
        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: true,
            context: {
                userId: 'user-123',
                walletAddress: '0x123',
                user: { id: 'user-123' } as any,
            },
        });
        vi.mocked(queryOne).mockResolvedValue({ preferences: '{}' });
        vi.mocked(execute).mockResolvedValue(undefined);

        const req = createTestRequest('PATCH', '/auth/preferences', {
            notifications: { email: true, webhook: false },
            llm_provider: 'openai',
        }, {
            Authorization: 'Bearer test-token',
        });

        const { patchPreferences } = await import('../handlers/account');
        const res = await patchPreferences(req, env);
        const body = await res.json() as any;

        expect(res.status).toBe(200);
        expect(body.notifications.email).toBe(true);
        expect(body.llm_provider).toBe('openai');
    });
});

// ============================================================================
// Logout Test
// ============================================================================

describe('POST /auth/logout', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should logout successfully', async () => {
        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: true,
            context: {
                userId: 'user-123',
                walletAddress: '0x123',
                user: { id: 'user-123' } as any,
            },
        });

        const req = createTestRequest('POST', '/auth/logout', undefined, {
            Authorization: 'Bearer test-token',
        });

        const { postLogout } = await import('../handlers/account');
        const res = await postLogout(req, env);

        expect(res.status).toBe(200);
    });

    it('should succeed even without auth', async () => {
        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: false,
            error: {
                name: 'AppError',
                message: 'Unauthorized',
                status: 401,
                code: 'UNAUTHORIZED',
                details: { reason: 'No token' },
            },
        });

        const req = createTestRequest('POST', '/auth/logout');

        const { postLogout } = await import('../handlers/account');
        const res = await postLogout(req, env);

        expect(res.status).toBe(200);
    });
});

// ============================================================================
// Link Wallet Tests
// ============================================================================

describe('POST /auth/link-wallet', () => {
    const env = createMockEnv();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should link wallet to account', async () => {
        const walletAddress = '0x1234567890123456789012345678901234567890';

        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: true,
            context: {
                userId: 'user-123',
                walletAddress: 'email:test@example.com',
                user: { id: 'user-123' } as any,
            },
        });
        vi.mocked(recoverAddressFromSignature).mockResolvedValue(walletAddress);
        vi.mocked(queryOne).mockResolvedValue(null); // Wallet not linked to other user
        vi.mocked(query).mockResolvedValue([]); // No existing wallets
        vi.mocked(execute).mockResolvedValue(undefined);

        const req = createTestRequest('POST', '/auth/link-wallet', {
            wallet_address: walletAddress,
            signature: '0x' + 'ab'.repeat(65),
            message: 'Link wallet to TattleHash',
        }, {
            Authorization: 'Bearer test-token',
        });

        const { postLinkWallet } = await import('../handlers/account');
        const res = await postLinkWallet(req, env);
        const body = await res.json() as any;

        expect(res.status).toBe(200);
        expect(body.wallet_address).toBe(walletAddress.toLowerCase());
        expect(body.is_primary).toBe(true);
    });

    it('should reject wallet already linked to another user', async () => {
        const walletAddress = '0x1234567890123456789012345678901234567890';

        vi.mocked(authenticateRequest).mockResolvedValue({
            ok: true,
            context: {
                userId: 'user-123',
                walletAddress: 'email:test@example.com',
                user: { id: 'user-123' } as any,
            },
        });
        vi.mocked(recoverAddressFromSignature).mockResolvedValue(walletAddress);
        vi.mocked(queryOne).mockResolvedValue({ id: 'other-user' }); // Wallet linked to other user

        const req = createTestRequest('POST', '/auth/link-wallet', {
            wallet_address: walletAddress,
            signature: '0x' + 'ab'.repeat(65),
            message: 'Link wallet to TattleHash',
        }, {
            Authorization: 'Bearer test-token',
        });

        const { postLinkWallet } = await import('../handlers/account');
        const res = await postLinkWallet(req, env);

        expect(res.status).toBe(409);
        const body = await res.json() as any;
        expect(body.error.code).toBe('WALLET_ALREADY_LINKED');
    });
});
