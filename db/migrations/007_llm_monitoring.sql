-- LLM Monitoring System Tables
-- Supports: Dual Agent Architecture, Monitoring Modes, Risk Scoring, Scam Shield

-- Main analysis table - one per analysis request
CREATE TABLE IF NOT EXISTS llm_analyses (
  id TEXT PRIMARY KEY,
  -- What is being analyzed
  target_type TEXT NOT NULL CHECK (target_type IN ('CHALLENGE', 'DISPUTE', 'ENF_BUNDLE', 'USER', 'TRANSACTION')),
  target_id TEXT NOT NULL,

  -- Analysis configuration
  monitoring_mode TEXT NOT NULL CHECK (monitoring_mode IN ('EXPLORATORY', 'BALANCED', 'PRECISION')),
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('AUTO', 'MANUAL', 'THRESHOLD', 'SCHEDULED')),

  -- Requestor
  requested_by_user_id TEXT,

  -- Overall results
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'PARTIAL')),
  risk_score INTEGER, -- 0-100
  risk_level TEXT CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  recommendation TEXT CHECK (recommendation IN ('PROCEED', 'CAUTION', 'BLOCK', 'REVIEW')),
  summary TEXT,

  -- LLM metadata
  model_used TEXT,
  total_tokens_used INTEGER DEFAULT 0,
  processing_time_ms INTEGER,

  -- Timestamps
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  completed_at INTEGER,
  expires_at INTEGER -- Cache TTL for results
);

-- Individual agent results (each analysis can have multiple agents)
CREATE TABLE IF NOT EXISTS llm_agent_results (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL,

  -- Agent info
  agent_type TEXT NOT NULL CHECK (agent_type IN ('TRANSACTION_MONITOR', 'FRAUD_ANALYZER', 'COMPLIANCE_AUDITOR', 'CUSTOM')),
  agent_name TEXT NOT NULL,
  agent_version TEXT DEFAULT '1.0',

  -- Agent output
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'SKIPPED')),
  confidence_score REAL, -- 0.0-1.0
  raw_output TEXT, -- JSON: full LLM response
  structured_output TEXT, -- JSON: parsed/extracted data

  -- Concerns raised by this agent
  flags_raised INTEGER DEFAULT 0,

  -- Performance
  tokens_used INTEGER DEFAULT 0,
  latency_ms INTEGER,

  -- Timestamps
  started_at INTEGER,
  completed_at INTEGER,

  FOREIGN KEY (analysis_id) REFERENCES llm_analyses(id)
);

-- Flags/concerns raised during analysis
CREATE TABLE IF NOT EXISTS llm_flags (
  id TEXT PRIMARY KEY,
  analysis_id TEXT NOT NULL,
  agent_result_id TEXT, -- Which agent raised it (null if system-generated)

  -- Flag details
  flag_type TEXT NOT NULL CHECK (flag_type IN (
    'SCAM_PATTERN', 'SUSPICIOUS_URL', 'AMOUNT_ANOMALY', 'TIMING_ANOMALY',
    'IDENTITY_MISMATCH', 'BEHAVIOR_PATTERN', 'COMPLIANCE_ISSUE', 'VELOCITY_SPIKE',
    'COUNTERPARTY_RISK', 'NETWORK_RISK', 'CUSTOM'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),

  -- Content
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  evidence TEXT, -- JSON: supporting data

  -- Resolution
  resolved INTEGER DEFAULT 0,
  resolved_by_user_id TEXT,
  resolution_notes TEXT,
  resolved_at INTEGER,

  -- Timestamps
  created_at INTEGER NOT NULL,

  FOREIGN KEY (analysis_id) REFERENCES llm_analyses(id),
  FOREIGN KEY (agent_result_id) REFERENCES llm_agent_results(id)
);

-- Risk score history (track changes over time)
CREATE TABLE IF NOT EXISTS llm_risk_scores (
  id TEXT PRIMARY KEY,

  -- What is scored
  entity_type TEXT NOT NULL CHECK (entity_type IN ('USER', 'WALLET', 'CHALLENGE', 'TRANSACTION')),
  entity_id TEXT NOT NULL,

  -- Score details
  score INTEGER NOT NULL, -- 0-100
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),

  -- Score components (JSON breakdown)
  score_breakdown TEXT, -- JSON: { "fraud": 20, "compliance": 10, "velocity": 15, ... }

  -- Source
  analysis_id TEXT,
  scoring_version TEXT DEFAULT '1.0',

  -- Timestamps
  calculated_at INTEGER NOT NULL,
  valid_until INTEGER, -- Score expiry

  FOREIGN KEY (analysis_id) REFERENCES llm_analyses(id)
);

-- URL scans for Scam Shield
CREATE TABLE IF NOT EXISTS llm_url_scans (
  id TEXT PRIMARY KEY,

  -- URL info
  url TEXT NOT NULL,
  domain TEXT NOT NULL,
  normalized_url TEXT NOT NULL, -- Canonical form for deduplication

  -- Context
  source_analysis_id TEXT,
  found_in_target_type TEXT,
  found_in_target_id TEXT,

  -- Scan results
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'SCANNING', 'CLEAN', 'SUSPICIOUS', 'MALICIOUS', 'ERROR')),
  threat_type TEXT CHECK (threat_type IN ('PHISHING', 'MALWARE', 'SCAM', 'SPAM', 'IMPERSONATION', 'UNKNOWN')),
  threat_score INTEGER, -- 0-100

  -- Source data
  scan_sources TEXT, -- JSON: which threat DBs were checked
  raw_results TEXT, -- JSON: raw results from sources

  -- Timestamps
  first_seen_at INTEGER NOT NULL,
  last_scanned_at INTEGER,
  scan_count INTEGER DEFAULT 1,

  FOREIGN KEY (source_analysis_id) REFERENCES llm_analyses(id)
);

-- Agent prompts/configurations (versioned for reproducibility)
CREATE TABLE IF NOT EXISTS llm_agent_configs (
  id TEXT PRIMARY KEY,

  -- Agent identity
  agent_type TEXT NOT NULL CHECK (agent_type IN ('TRANSACTION_MONITOR', 'FRAUD_ANALYZER', 'COMPLIANCE_AUDITOR', 'CUSTOM')),
  agent_name TEXT NOT NULL,
  version TEXT NOT NULL,

  -- Configuration
  system_prompt TEXT NOT NULL,
  temperature REAL DEFAULT 0.3,
  max_tokens INTEGER DEFAULT 2000,

  -- Feature flags
  enabled INTEGER DEFAULT 1,
  monitoring_modes TEXT NOT NULL, -- JSON array: ["BALANCED", "PRECISION"]

  -- Metadata
  description TEXT,
  created_by_user_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,

  UNIQUE(agent_type, agent_name, version)
);

-- Monitoring mode configurations
CREATE TABLE IF NOT EXISTS llm_monitoring_configs (
  mode TEXT PRIMARY KEY CHECK (mode IN ('EXPLORATORY', 'BALANCED', 'PRECISION')),

  -- Behavior settings
  description TEXT NOT NULL,
  risk_threshold_low INTEGER NOT NULL, -- Score below this = LOW risk
  risk_threshold_medium INTEGER NOT NULL, -- Score below this = MEDIUM risk
  risk_threshold_high INTEGER NOT NULL, -- Score below this = HIGH risk (above = CRITICAL)

  -- Agent selection
  required_agents TEXT NOT NULL, -- JSON array of agent types
  optional_agents TEXT, -- JSON array of agent types

  -- Strictness
  auto_block_threshold INTEGER, -- Auto-block if score >= this
  require_human_review_threshold INTEGER, -- Require human review if score >= this

  -- Timing
  analysis_timeout_ms INTEGER NOT NULL,

  updated_at INTEGER NOT NULL
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_llm_analyses_target ON llm_analyses(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_llm_analyses_status ON llm_analyses(status);
CREATE INDEX IF NOT EXISTS idx_llm_analyses_risk ON llm_analyses(risk_level);
CREATE INDEX IF NOT EXISTS idx_llm_analyses_created ON llm_analyses(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_llm_agent_results_analysis ON llm_agent_results(analysis_id);
CREATE INDEX IF NOT EXISTS idx_llm_agent_results_type ON llm_agent_results(agent_type);

CREATE INDEX IF NOT EXISTS idx_llm_flags_analysis ON llm_flags(analysis_id);
CREATE INDEX IF NOT EXISTS idx_llm_flags_type ON llm_flags(flag_type);
CREATE INDEX IF NOT EXISTS idx_llm_flags_severity ON llm_flags(severity);
CREATE INDEX IF NOT EXISTS idx_llm_flags_unresolved ON llm_flags(resolved) WHERE resolved = 0;

CREATE INDEX IF NOT EXISTS idx_llm_risk_scores_entity ON llm_risk_scores(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_llm_risk_scores_level ON llm_risk_scores(risk_level);
CREATE INDEX IF NOT EXISTS idx_llm_risk_scores_valid ON llm_risk_scores(valid_until);

CREATE INDEX IF NOT EXISTS idx_llm_url_scans_domain ON llm_url_scans(domain);
CREATE INDEX IF NOT EXISTS idx_llm_url_scans_normalized ON llm_url_scans(normalized_url);
CREATE INDEX IF NOT EXISTS idx_llm_url_scans_status ON llm_url_scans(status);

-- Insert default monitoring mode configurations
INSERT OR REPLACE INTO llm_monitoring_configs (mode, description, risk_threshold_low, risk_threshold_medium, risk_threshold_high, required_agents, optional_agents, auto_block_threshold, require_human_review_threshold, analysis_timeout_ms, updated_at)
VALUES
  ('EXPLORATORY', 'First-time users, complex deals. Asks clarifying questions, surfaces concerns.', 30, 50, 70, '["TRANSACTION_MONITOR"]', '["FRAUD_ANALYZER"]', NULL, 60, 30000, strftime('%s', 'now') * 1000),
  ('BALANCED', 'Standard monitoring. Flags anomalies without being intrusive.', 25, 45, 65, '["TRANSACTION_MONITOR", "FRAUD_ANALYZER"]', '["COMPLIANCE_AUDITOR"]', 90, 70, 20000, strftime('%s', 'now') * 1000),
  ('PRECISION', 'High-value transactions. Strict verification, minimal tolerance.', 20, 40, 60, '["TRANSACTION_MONITOR", "FRAUD_ANALYZER", "COMPLIANCE_AUDITOR"]', NULL, 80, 50, 45000, strftime('%s', 'now') * 1000);
