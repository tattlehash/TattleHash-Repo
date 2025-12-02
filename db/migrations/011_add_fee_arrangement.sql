-- Migration: Add fee_arrangement column to challenges table
-- Supports: creator_pays, counterparty_pays, split, coin_toss
-- Defaults to creator_pays for backward compatibility

ALTER TABLE challenges ADD COLUMN fee_arrangement TEXT DEFAULT 'creator_pays'
  CHECK (fee_arrangement IN ('creator_pays', 'counterparty_pays', 'split', 'coin_toss'));

-- Note: Coin toss data is stored in KV (GATE_KV) with key pattern: coin-toss:{challenge_id}
-- This keeps the challenge table lean while allowing rich coin toss state management
