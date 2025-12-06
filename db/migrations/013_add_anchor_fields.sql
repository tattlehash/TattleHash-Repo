-- Add anchor-related fields to challenges table
-- receipt_id links to the attestation receipt in KV storage
-- anchor_tx_hash stores the blockchain transaction hash once anchored
-- anchor_block_number stores the block number for verification

ALTER TABLE challenges ADD COLUMN receipt_id TEXT;
ALTER TABLE challenges ADD COLUMN anchor_tx_hash TEXT;
ALTER TABLE challenges ADD COLUMN anchor_block_number INTEGER;

-- Index for looking up challenges by their attestation receipt
CREATE INDEX IF NOT EXISTS idx_challenges_receipt ON challenges(receipt_id);
