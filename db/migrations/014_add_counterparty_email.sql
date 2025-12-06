-- Add counterparty_email column for Fire mode email notifications
-- This stores the email address to notify when a challenge is sent

ALTER TABLE challenges ADD COLUMN counterparty_email TEXT;
ALTER TABLE challenges ADD COLUMN custom_note TEXT;

-- Index for looking up challenges by counterparty email
CREATE INDEX IF NOT EXISTS idx_challenges_counterparty_email ON challenges(counterparty_email);
