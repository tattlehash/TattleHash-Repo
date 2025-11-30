/**
 * LLM Monitoring Module
 *
 * Dual Agent Architecture with Adaptive LLM Shielding
 *
 * Features:
 * - Multiple specialized agents (Transaction Monitor, Fraud Analyzer, Compliance Auditor)
 * - Three monitoring modes (Exploratory, Balanced, Precision)
 * - Risk scoring engine with component breakdown
 * - Scam Shield URL analysis
 * - Auto Mode for adaptive monitoring based on history
 */

// Re-export all types
export * from './types';

// Export LLM client
export { LlmClient, systemMessage, userMessage, assistantMessage } from './client';

// Export agents
export {
    BaseAgent,
    createAgent,
    getRegisteredAgentTypes,
    TransactionMonitorAgent,
    FraudAnalyzerAgent,
    ComplianceAuditorAgent,
} from './agents';
export type { AgentConfig, AgentResult } from './agents';

// Export core analysis functions
export {
    runAnalysis,
    getAnalysis,
    getAnalysisFlags,
    getAgentResults,
    getCachedAnalysis,
    getMonitoringConfig,
} from './core';
export type { AnalysisResult, AnalysisOptions } from './core';

// Export risk scoring
export {
    getRiskScore,
    updateRiskScoreFromAnalysis,
    getRecommendedMonitoringMode,
} from './scoring';
export type { RiskScoreResult, RiskBreakdown, RiskHistory } from './scoring';

// Export scam shield
export {
    scanUrl,
    scanUrls,
    extractUrls,
} from './scam-shield';
export type { UrlScanResult, UrlIndicator } from './scam-shield';
