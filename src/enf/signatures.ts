/**
 * ENF Signature Verification
 *
 * EIP-191 signature verification for cryptographic acknowledgments.
 */

import { execute, queryOne } from '../db';
import { createError } from '../errors';
import { Env } from '../types';
import type { EnfSignature, EnfSignatureType } from '../db/types';
import { recoverAddressFromSignature } from '../gatekeeper/wallet/recovery';
import { createEip191Message } from './types';

// ============================================================================
// Signature Storage
// ============================================================================

export interface CreateSignatureInput {
    recipient_id: string;
    signature_type: EnfSignatureType;
    signature?: string;
    message_hash?: string;
    signer_address?: string;
}

export async function createEnfSignature(
    env: Env,
    input: CreateSignatureInput
): Promise<EnfSignature> {
    const id = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO enf_signatures (
            id, recipient_id, signature_type, signature, message_hash,
            signer_address, verified, signed_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            input.recipient_id,
            input.signature_type,
            input.signature ?? null,
            input.message_hash ?? null,
            input.signer_address ?? null,
            false,
            now,
            now,
        ]
    );

    return {
        id,
        recipient_id: input.recipient_id,
        signature_type: input.signature_type,
        signature: input.signature,
        message_hash: input.message_hash,
        signer_address: input.signer_address,
        verified: false,
        signed_at: now,
        created_at: now,
    };
}

export async function getSignatureByRecipient(
    env: Env,
    recipientId: string
): Promise<EnfSignature | null> {
    return queryOne<EnfSignature>(
        env.TATTLEHASH_DB,
        'SELECT * FROM enf_signatures WHERE recipient_id = ?',
        [recipientId]
    );
}

// ============================================================================
// EIP-191 Verification
// ============================================================================

export interface VerifySignatureInput {
    enfId: string;
    evidenceHash: string;
    recipientId: string;
    signature: string;
    expectedAddress: string;
    timestamp: number;
}

export interface VerifySignatureResult {
    verified: boolean;
    recoveredAddress?: string;
    error?: string;
}

export async function verifyEip191Signature(
    input: VerifySignatureInput
): Promise<VerifySignatureResult> {
    try {
        // Create the message that should have been signed
        const message = createEip191Message(
            input.enfId,
            input.evidenceHash,
            input.recipientId,
            input.timestamp
        );

        // Recover the signer address from the signature
        const recoveredAddress = await recoverAddressFromSignature(
            message,
            input.signature
        );

        // Compare addresses (case-insensitive)
        const verified = recoveredAddress.toLowerCase() === input.expectedAddress.toLowerCase();

        return {
            verified,
            recoveredAddress,
            error: verified ? undefined : 'Recovered address does not match expected signer',
        };
    } catch (error: any) {
        console.error('EIP-191 verification error:', error);
        return {
            verified: false,
            error: error.message || 'Signature verification failed',
        };
    }
}

// ============================================================================
// Update Signature Verification Status
// ============================================================================

export async function updateSignatureVerification(
    env: Env,
    signatureId: string,
    verified: boolean,
    error?: string
): Promise<void> {
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `UPDATE enf_signatures
         SET verified = ?, verification_error = ?, verified_at = ?
         WHERE id = ?`,
        [verified ? 1 : 0, error ?? null, now, signatureId]
    );
}

// ============================================================================
// Full Acknowledgment Flow with Signature
// ============================================================================

export interface AcknowledgeWithSignatureInput {
    recipientId: string;
    enfId: string;
    evidenceHash: string;
    signatureType: EnfSignatureType;
    signature?: string;
    signerAddress?: string;
    timestamp: number;
}

export interface AcknowledgeWithSignatureResult {
    signature: EnfSignature;
    verified: boolean;
    message_hash: string;
}

export async function processSignedAcknowledgment(
    env: Env,
    input: AcknowledgeWithSignatureInput
): Promise<AcknowledgeWithSignatureResult> {
    // Create message hash
    const message = createEip191Message(
        input.enfId,
        input.evidenceHash,
        input.recipientId,
        input.timestamp
    );

    const encoder = new TextEncoder();
    const data = encoder.encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const messageHash = Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');

    // Create signature record
    const signatureRecord = await createEnfSignature(env, {
        recipient_id: input.recipientId,
        signature_type: input.signatureType,
        signature: input.signature,
        message_hash: messageHash,
        signer_address: input.signerAddress,
    });

    // Verify if EIP-191 signature provided
    let verified = false;
    if (input.signatureType === 'EIP191' && input.signature && input.signerAddress) {
        const result = await verifyEip191Signature({
            enfId: input.enfId,
            evidenceHash: input.evidenceHash,
            recipientId: input.recipientId,
            signature: input.signature,
            expectedAddress: input.signerAddress,
            timestamp: input.timestamp,
        });

        verified = result.verified;
        await updateSignatureVerification(env, signatureRecord.id, verified, result.error);
    } else if (input.signatureType === 'CLICK_ACK') {
        // Click acknowledgment is always "verified" (no crypto signature)
        verified = true;
        await updateSignatureVerification(env, signatureRecord.id, true);
    }

    console.log(JSON.stringify({
        t: Date.now(),
        at: 'enf_signature_processed',
        recipient_id: input.recipientId,
        signature_type: input.signatureType,
        verified,
    }));

    return {
        signature: {
            ...signatureRecord,
            verified,
            verified_at: verified ? Date.now() : undefined,
        },
        verified,
        message_hash: messageHash,
    };
}
