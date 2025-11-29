/**
 * JWT utilities for stateless authentication.
 *
 * Uses HMAC-SHA256 for token signing with the AUTH_SECRET environment variable.
 * Tokens contain: user_id, wallet_address, issued_at, expires_at
 */

import type { Env } from '../types';

export interface TokenPayload {
    sub: string;           // user_id
    wallet: string;        // wallet_address
    iat: number;           // issued at (unix timestamp)
    exp: number;           // expires at (unix timestamp)
}

export interface AuthToken {
    token: string;
    expires_at: string;    // ISO timestamp
    expires_in: number;    // seconds until expiry
}

// Token validity duration (24 hours)
const TOKEN_TTL_SECONDS = 24 * 60 * 60;

/**
 * Base64URL encode a string.
 */
function base64UrlEncode(data: string): string {
    const base64 = btoa(data);
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Base64URL decode a string.
 */
function base64UrlDecode(data: string): string {
    const padded = data + '='.repeat((4 - data.length % 4) % 4);
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/');
    return atob(base64);
}

/**
 * Create HMAC-SHA256 signature.
 */
async function createSignature(data: string, secret: string): Promise<string> {
    const encoder = new TextEncoder();
    const keyData = encoder.encode(secret);
    const dataBytes = encoder.encode(data);

    const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, dataBytes);
    const signatureArray = Array.from(new Uint8Array(signature));
    const signatureHex = signatureArray.map(b => String.fromCharCode(b)).join('');
    return base64UrlEncode(signatureHex);
}

/**
 * Verify HMAC-SHA256 signature.
 */
async function verifySignature(data: string, signature: string, secret: string): Promise<boolean> {
    const expectedSignature = await createSignature(data, secret);
    return signature === expectedSignature;
}

/**
 * Generate a JWT token for a user.
 */
export async function generateToken(
    env: Env,
    userId: string,
    walletAddress: string
): Promise<AuthToken> {
    const secret = env.AUTH_SECRET;
    if (!secret) {
        throw new Error('AUTH_SECRET not configured');
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + TOKEN_TTL_SECONDS;

    const payload: TokenPayload = {
        sub: userId,
        wallet: walletAddress.toLowerCase(),
        iat: now,
        exp: exp,
    };

    // Create JWT header
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerEncoded = base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = base64UrlEncode(JSON.stringify(payload));

    // Sign
    const dataToSign = `${headerEncoded}.${payloadEncoded}`;
    const signature = await createSignature(dataToSign, secret);

    const token = `${dataToSign}.${signature}`;

    return {
        token,
        expires_at: new Date(exp * 1000).toISOString(),
        expires_in: TOKEN_TTL_SECONDS,
    };
}

/**
 * Verify and decode a JWT token.
 * Returns the payload if valid, null if invalid or expired.
 */
export async function verifyToken(
    env: Env,
    token: string
): Promise<TokenPayload | null> {
    const secret = env.AUTH_SECRET;
    if (!secret) {
        return null;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
        return null;
    }

    const [headerEncoded, payloadEncoded, signature] = parts;

    // Verify signature
    const dataToVerify = `${headerEncoded}.${payloadEncoded}`;
    const isValid = await verifySignature(dataToVerify, signature, secret);
    if (!isValid) {
        return null;
    }

    // Decode payload
    try {
        const payloadJson = base64UrlDecode(payloadEncoded);
        const payload = JSON.parse(payloadJson) as TokenPayload;

        // Check expiration
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp < now) {
            return null;
        }

        return payload;
    } catch {
        return null;
    }
}

/**
 * Extract token from Authorization header.
 * Expects format: Bearer <token>
 */
export function extractBearerToken(request: Request): string | null {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader) {
        return null;
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0] !== 'Bearer') {
        return null;
    }

    return parts[1];
}
