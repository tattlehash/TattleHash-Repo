/**
 * Base Agent Class
 *
 * Abstract base class for all monitoring agents.
 * Each agent analyzes specific aspects of a transaction/entity.
 */

import { LlmClient, systemMessage, userMessage } from '../client';
import {
    AgentInput,
    AgentOutput,
    AgentOutputSchema,
    AgentType,
    MonitoringMode,
    AGENT_TYPES,
} from '../types';

// ============================================================================
// Types
// ============================================================================

export interface AgentConfig {
    name: string;
    type: AgentType;
    version: string;
    description: string;
    systemPrompt: string;
    temperature?: number;
    maxTokens?: number;
    supportedModes: MonitoringMode[];
}

export type AgentResult = {
    ok: true;
    output: AgentOutput;
    tokens: number;
    latencyMs: number;
} | {
    ok: false;
    error: string;
    code: string;
};

// ============================================================================
// Base Agent
// ============================================================================

export abstract class BaseAgent {
    protected config: AgentConfig;
    protected client: LlmClient;

    constructor(client: LlmClient, config: AgentConfig) {
        this.client = client;
        this.config = config;
    }

    /**
     * Get the agent's type
     */
    get type(): AgentType {
        return this.config.type;
    }

    /**
     * Get the agent's name
     */
    get name(): string {
        return this.config.name;
    }

    /**
     * Get the agent's version
     */
    get version(): string {
        return this.config.version;
    }

    /**
     * Check if the agent supports a monitoring mode
     */
    supportsMode(mode: MonitoringMode): boolean {
        return this.config.supportedModes.includes(mode);
    }

    /**
     * Run the agent analysis
     */
    async analyze(input: AgentInput): Promise<AgentResult> {
        if (!this.supportsMode(input.monitoring_mode)) {
            return {
                ok: false,
                error: `Agent ${this.name} does not support mode ${input.monitoring_mode}`,
                code: 'MODE_NOT_SUPPORTED',
            };
        }

        // Build the analysis prompt
        const analysisPrompt = this.buildAnalysisPrompt(input);

        // Get mode-specific system prompt adjustments
        const modeAdjustment = this.getModeAdjustment(input.monitoring_mode);

        const messages = [
            systemMessage(this.config.systemPrompt + '\n\n' + modeAdjustment),
            userMessage(analysisPrompt),
        ];

        // Call LLM
        const result = await this.client.completeJson<AgentOutput>(messages, {
            temperature: this.config.temperature,
            maxTokens: this.config.maxTokens,
        });

        if (!result.ok) {
            return {
                ok: false,
                error: result.error,
                code: result.code,
            };
        }

        // Validate output structure
        const parsed = AgentOutputSchema.safeParse(result.data);
        if (!parsed.success) {
            console.error('Invalid agent output:', parsed.error);
            return {
                ok: false,
                error: 'Invalid agent output structure',
                code: 'INVALID_OUTPUT',
            };
        }

        return {
            ok: true,
            output: parsed.data,
            tokens: result.completion.tokens.total,
            latencyMs: result.completion.latencyMs,
        };
    }

    /**
     * Build the analysis prompt for the specific input
     * Override in subclasses for specialized prompts
     */
    protected buildAnalysisPrompt(input: AgentInput): string {
        return `Analyze the following ${input.target_type} (ID: ${input.target_id}):

TARGET DATA:
${JSON.stringify(input.target_data, null, 2)}

${input.context ? `ADDITIONAL CONTEXT:\n${JSON.stringify(input.context, null, 2)}` : ''}

Provide your analysis as a JSON object with the following structure:
{
  "confidence_score": <number 0.0-1.0>,
  "risk_contribution": <number 0-100>,
  "flags": [
    {
      "flag_type": "<SCAM_PATTERN|SUSPICIOUS_URL|AMOUNT_ANOMALY|TIMING_ANOMALY|IDENTITY_MISMATCH|BEHAVIOR_PATTERN|COMPLIANCE_ISSUE|VELOCITY_SPIKE|COUNTERPARTY_RISK|NETWORK_RISK|CUSTOM>",
      "severity": "<INFO|LOW|MEDIUM|HIGH|CRITICAL>",
      "title": "<short title>",
      "description": "<detailed description>",
      "evidence": { ... }
    }
  ],
  "summary": "<brief summary of findings>",
  "recommendations": ["<recommendation 1>", "<recommendation 2>"]
}`;
    }

    /**
     * Get mode-specific adjustments to the system prompt
     */
    protected getModeAdjustment(mode: MonitoringMode): string {
        switch (mode) {
            case 'EXPLORATORY':
                return `MODE: EXPLORATORY
- Be thorough but not alarmist
- Surface potential concerns for discussion
- Ask clarifying questions in your recommendations
- Lower threshold for flagging - better to mention something than miss it`;

            case 'BALANCED':
                return `MODE: BALANCED
- Standard analysis with reasonable thresholds
- Flag clear anomalies and suspicious patterns
- Provide actionable recommendations
- Balance thoroughness with signal-to-noise ratio`;

            case 'PRECISION':
                return `MODE: PRECISION
- Strict analysis with low tolerance for risk
- Flag anything that could indicate problems
- High confidence required before clearing
- Err on the side of caution for high-value transactions`;

            default:
                return '';
        }
    }
}

// ============================================================================
// Agent Registry
// ============================================================================

const agentRegistry = new Map<AgentType, new (client: LlmClient) => BaseAgent>();

/**
 * Register an agent class
 */
export function registerAgent(
    type: AgentType,
    agentClass: new (client: LlmClient) => BaseAgent
): void {
    agentRegistry.set(type, agentClass);
}

/**
 * Create an agent instance
 */
export function createAgent(type: AgentType, client: LlmClient): BaseAgent | null {
    const AgentClass = agentRegistry.get(type);
    if (!AgentClass) {
        return null;
    }
    return new AgentClass(client);
}

/**
 * Get all registered agent types
 */
export function getRegisteredAgentTypes(): AgentType[] {
    return Array.from(agentRegistry.keys());
}
