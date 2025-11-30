/**
 * Handlers Index
 *
 * Central export point for all HTTP handlers.
 * Organized by domain for easier imports in router.ts
 */

// Health & Status
export * from './health';

// Attestation & Anchoring
export * from './attest';
export * from './anchor';
export * from './receipt';

// Gatekeeper (wallet verification, funds check)
export * from './gatekeeper';
export * from './challenges';

// Game Modes
export * from './game';
export * from './enforced';

// ENF (Evidence-and-Forward)
export * from './enf';

// Webhooks
export * from './webhooks';

// Verification & Export
export * from './verification';
export * from './challenge-export';
export * from './dossier';

// Trust Score
export * from './trust-score';

// Credits & Loyalty
export * from './credits';

// LLM Monitoring
export * from './monitoring';

// Governance (admin only)
export * from './governance';

// POF (Proof of Funds - disabled)
export * from './pof';

// Queue Handlers
export * from './queue';

// Sweep (maintenance)
export * from './sweep';

// Admin handlers
export * as admin from './admin';
