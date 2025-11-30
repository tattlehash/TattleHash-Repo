/**
 * Password hashing and verification utilities.
 * Uses PBKDF2 with SHA-256 for password hashing (Web Crypto API compatible).
 */

const ITERATIONS = 100000;
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 16; // 128 bits

/**
 * Generate a random salt.
 */
function generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
}

/**
 * Convert Uint8Array to hex string.
 */
function toHex(bytes: Uint8Array): string {
    return Array.from(bytes)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Convert hex string to Uint8Array.
 */
function fromHex(hex: string): Uint8Array {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < hex.length; i += 2) {
        bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
    }
    return bytes;
}

/**
 * Derive a key from password and salt using PBKDF2.
 */
async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
    const encoder = new TextEncoder();
    const passwordBytes = encoder.encode(password);

    const baseKey = await crypto.subtle.importKey(
        'raw',
        passwordBytes,
        'PBKDF2',
        false,
        ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: salt.buffer as ArrayBuffer,
            iterations: ITERATIONS,
            hash: 'SHA-256',
        },
        baseKey,
        KEY_LENGTH * 8
    );

    return new Uint8Array(derivedBits);
}

/**
 * Hash a password.
 * Returns a string in format: iterations$salt$hash (all hex encoded)
 */
export async function hashPassword(password: string): Promise<string> {
    const salt = generateSalt();
    const hash = await deriveKey(password, salt);

    return `${ITERATIONS}$${toHex(salt)}$${toHex(hash)}`;
}

/**
 * Verify a password against a hash.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const parts = storedHash.split('$');
    if (parts.length !== 3) {
        return false;
    }

    const [iterationsStr, saltHex, expectedHashHex] = parts;
    const iterations = parseInt(iterationsStr, 10);

    if (iterations !== ITERATIONS) {
        // Could support migration to new iteration counts here
        return false;
    }

    const salt = fromHex(saltHex);
    const expectedHash = fromHex(expectedHashHex);
    const actualHash = await deriveKey(password, salt);

    // Constant-time comparison
    if (actualHash.length !== expectedHash.length) {
        return false;
    }

    let result = 0;
    for (let i = 0; i < actualHash.length; i++) {
        result |= actualHash[i] ^ expectedHash[i];
    }

    return result === 0;
}

/**
 * Validate password strength.
 * Returns null if valid, error message if invalid.
 */
export function validatePassword(password: string): string | null {
    if (password.length < 8) {
        return 'Password must be at least 8 characters long';
    }
    if (password.length > 128) {
        return 'Password must be at most 128 characters long';
    }
    // Could add more rules: uppercase, lowercase, number, special char
    return null;
}

/**
 * Validate email format.
 */
export function validateEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email) && email.length <= 254;
}

/**
 * Validate username format.
 */
export function validateUsername(username: string): string | null {
    if (username.length < 3) {
        return 'Username must be at least 3 characters long';
    }
    if (username.length > 30) {
        return 'Username must be at most 30 characters long';
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(username)) {
        return 'Username can only contain letters, numbers, underscores, and hyphens';
    }
    return null;
}

/**
 * Generate a secure random token (for email verification, password reset).
 */
export function generateSecureToken(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    return toHex(bytes);
}

/**
 * Hash a token for storage (we don't store tokens in plain text).
 */
export async function hashToken(token: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return toHex(new Uint8Array(hashBuffer));
}
