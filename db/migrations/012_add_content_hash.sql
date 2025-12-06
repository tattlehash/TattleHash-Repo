-- Add content_hash to challenges table for file attestation
-- This stores the SHA-256 hash of the user's uploaded document
-- The actual file is NEVER stored - only the hash

ALTER TABLE challenges ADD COLUMN content_hash TEXT;
ALTER TABLE challenges ADD COLUMN file_name TEXT;
ALTER TABLE challenges ADD COLUMN file_size INTEGER;

-- Index for quick hash lookups during verification
CREATE INDEX IF NOT EXISTS idx_challenges_content_hash ON challenges(content_hash);
