/**
 * Transaction Monitor Agent
 *
 * Core agent for real-time analysis of transaction patterns.
 * Focuses on: amount anomalies, timing patterns, counterparty behavior.
 */

import { LlmClient } from '../client';
import { BaseAgent, AgentConfig, registerAgent } from './base';
import { AgentInput } from '../types';

const SYSTEM_PROMPT = `You are the Core Transaction Monitor, a specialized AI agent for analyzing peer-to-peer transactions on the TattleHash platform.

YOUR ROLE:
- Analyze transaction patterns for anomalies
- Identify suspicious timing or amount patterns
- Evaluate counterparty behavior signals
- Provide risk assessment based on transaction characteristics

ANALYSIS FOCUS AREAS:
1. AMOUNT ANALYSIS
   - Is the amount unusual for this type of transaction?
   - Does it match common scam amounts (e.g., round numbers, just under limits)?
   - Is there evidence of amount manipulation or structuring?

2. TIMING PATTERNS
   - Is the transaction happening at unusual times?
   - Is there urgency pressure being applied?
   - Does the timing align with known scam patterns (e.g., holiday scams)?

3. COUNTERPARTY SIGNALS
   - Any red flags in counterparty information?
   - Wallet age and activity patterns
   - Communication patterns if available

4. TRANSACTION CONTEXT
   - Does the stated purpose match the transaction characteristics?
   - Are there inconsistencies in the provided information?
   - Cross-reference with known legitimate patterns

OUTPUT FORMAT:
Respond ONLY with a valid JSON object. Do not include any text outside the JSON.
Be specific in your flags - cite exact evidence from the transaction data.
Keep risk_contribution between 0-100 based on your findings.`;

const CONFIG: AgentConfig = {
    name: 'Core Transaction Monitor',
    type: 'TRANSACTION_MONITOR',
    version: '1.0.0',
    description: 'Real-time analysis of transaction patterns',
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.2,
    maxTokens: 2000,
    supportedModes: ['EXPLORATORY', 'BALANCED', 'PRECISION'],
};

export class TransactionMonitorAgent extends BaseAgent {
    constructor(client: LlmClient) {
        super(client, CONFIG);
    }

    protected override buildAnalysisPrompt(input: AgentInput): string {
        const data = input.target_data as Record<string, unknown>;

        // Extract relevant transaction fields
        const amount = data.amount ?? data.value ?? 'unknown';
        const currency = data.currency ?? data.currency_code ?? 'unknown';
        const description = data.description ?? data.title ?? '';
        const counterparty = data.counterparty_wallet ?? data.counterparty_user_id ?? 'unknown';
        const createdAt = data.created_at ?? Date.now();
        const mode = data.mode ?? 'unknown';

        return `Analyze this transaction for anomalies and risk patterns:

TRANSACTION DETAILS:
- ID: ${input.target_id}
- Type: ${input.target_type}
- Mode: ${mode}
- Amount: ${amount} ${currency}
- Description: "${description}"
- Counterparty: ${counterparty}
- Created: ${new Date(createdAt as number).toISOString()}

FULL DATA:
${JSON.stringify(input.target_data, null, 2)}

${input.context ? `CONTEXT:\n${JSON.stringify(input.context, null, 2)}` : ''}

Analyze for:
1. Amount anomalies (unusual values, scam amounts, structuring)
2. Timing patterns (urgency, unusual hours, holiday timing)
3. Counterparty signals (wallet patterns, communication red flags)
4. Description consistency (does stated purpose match characteristics?)

Respond with a JSON object containing:
{
  "confidence_score": <0.0-1.0 how confident you are in your analysis>,
  "risk_contribution": <0-100 overall risk score from your analysis>,
  "flags": [<array of specific concerns found>],
  "summary": "<2-3 sentence summary>",
  "recommendations": [<array of suggested actions>]
}`;
    }
}

// Register the agent
registerAgent('TRANSACTION_MONITOR', TransactionMonitorAgent);
