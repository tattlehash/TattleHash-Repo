/**
 * Agent Module Index
 *
 * Exports all agents and registration utilities.
 * Importing this file automatically registers all built-in agents.
 */

// Import agents to trigger registration
import './transaction-monitor';
import './fraud-analyzer';
import './compliance-auditor';

// Export base classes and utilities
export { BaseAgent, registerAgent, createAgent, getRegisteredAgentTypes } from './base';
export type { AgentConfig, AgentResult } from './base';

// Export specific agent classes for testing/extension
export { TransactionMonitorAgent } from './transaction-monitor';
export { FraudAnalyzerAgent } from './fraud-analyzer';
export { ComplianceAuditorAgent } from './compliance-auditor';
