/**
 * Compliance Auditor Agent
 *
 * Specialized agent for regulatory flag detection and compliance monitoring.
 * Focuses on: AML patterns, sanctions, KYC gaps, regulatory requirements.
 */

import { LlmClient } from '../client';
import { BaseAgent, AgentConfig, registerAgent } from './base';
import { AgentInput } from '../types';

const SYSTEM_PROMPT = `You are the Compliance Auditor, a specialized AI agent for detecting regulatory flags and compliance concerns in peer-to-peer transactions.

YOUR ROLE:
- Identify potential AML (Anti-Money Laundering) red flags
- Detect sanctions evasion patterns
- Flag KYC (Know Your Customer) gaps
- Recognize structuring and layering patterns
- Identify high-risk jurisdiction indicators

COMPLIANCE RED FLAGS TO MONITOR:

1. AML PATTERNS
   - Structuring: Breaking large amounts into smaller transactions
   - Layering: Complex transaction chains to obscure origin
   - Integration: Converting illicit funds to legitimate-looking assets
   - Round-tripping: Funds returning to origin via complex path
   - Rapid movement: Quick transfers with no apparent purpose

2. SANCTIONS INDICATORS
   - Transactions involving sanctioned jurisdictions
   - Names matching or similar to sanctioned entities
   - Wallet addresses associated with sanctioned activity
   - Unusual geographic patterns

3. KYC CONCERNS
   - Incomplete identity information
   - Mismatched identification details
   - Use of nominees or shell entities
   - Frequent identity changes

4. HIGH-RISK INDICATORS
   - Politically Exposed Persons (PEP) connections
   - High-risk jurisdictions (FATF grey/black list)
   - Cash-intensive business patterns
   - Unusual transaction sizes for stated purpose

5. SUSPICIOUS ACTIVITY
   - No clear economic purpose
   - Transactions inconsistent with user profile
   - Reluctance to provide information
   - Complex ownership structures

IMPORTANT NOTES:
- Flag potential concerns, not definitive violations
- Compliance decisions require human review
- Be specific about which indicators triggered concerns
- Consider legitimate explanations for patterns observed

OUTPUT FORMAT:
Respond ONLY with valid JSON.
For each flag, cite the specific compliance concern and evidence.`;

const CONFIG: AgentConfig = {
    name: 'Compliance Auditor',
    type: 'COMPLIANCE_AUDITOR',
    version: '1.0.0',
    description: 'Regulatory flag detection',
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.1, // Very low for consistent compliance analysis
    maxTokens: 2500,
    supportedModes: ['PRECISION'], // Only used in strict mode
};

export class ComplianceAuditorAgent extends BaseAgent {
    constructor(client: LlmClient) {
        super(client, CONFIG);
    }

    protected override buildAnalysisPrompt(input: AgentInput): string {
        const data = input.target_data as Record<string, unknown>;

        // Extract compliance-relevant fields
        const amount = data.amount ?? data.value ?? 'unknown';
        const currency = data.currency ?? data.currency_code ?? 'unknown';
        const wallets = this.extractWallets(data);
        const chainId = data.chain_id ?? data.network ?? 'unknown';
        const userInfo = data.user ?? data.creator ?? {};
        const counterpartyInfo = data.counterparty ?? {};

        return `Perform compliance analysis on this transaction:

TRANSACTION DETAILS:
- ID: ${input.target_id}
- Type: ${input.target_type}
- Amount: ${amount} ${currency}
- Network/Chain: ${chainId}

WALLET ADDRESSES INVOLVED:
${wallets.map(w => `- ${w}`).join('\n') || 'None detected'}

USER INFORMATION:
${JSON.stringify(userInfo, null, 2)}

COUNTERPARTY INFORMATION:
${JSON.stringify(counterpartyInfo, null, 2)}

FULL TRANSACTION DATA:
${JSON.stringify(input.target_data, null, 2)}

${input.context ? `CONTEXT (historical data):\n${JSON.stringify(input.context, null, 2)}` : ''}

COMPLIANCE CHECKS:
1. AML Red Flags
   - Structuring patterns (amounts just under reporting thresholds)
   - Layering indicators (unnecessary complexity)
   - Rapid movement patterns

2. Sanctions Screening
   - Jurisdiction concerns
   - Name/entity matches (note: we flag for review, not determine matches)
   - Wallet address patterns

3. KYC Assessment
   - Information completeness
   - Consistency of provided details
   - Verification gaps

4. Risk Classification
   - Transaction size vs stated purpose
   - Counterparty risk level
   - Geographic considerations

Respond with JSON:
{
  "confidence_score": <0.0-1.0>,
  "risk_contribution": <0-100>,
  "flags": [
    {
      "flag_type": "COMPLIANCE_ISSUE",
      "severity": "<severity>",
      "title": "<specific compliance concern>",
      "description": "<detailed explanation with regulatory reference>",
      "evidence": { "indicator": "<indicator>", "details": "..." }
    }
  ],
  "summary": "<compliance assessment summary>",
  "recommendations": ["<compliance recommendations>"]
}`;
    }

    /**
     * Extract wallet addresses from various data fields
     */
    private extractWallets(data: Record<string, unknown>): string[] {
        const wallets: string[] = [];
        // Ethereum-style addresses
        const ethPattern = /0x[a-fA-F0-9]{40}/g;
        // Bitcoin-style addresses (simplified)
        const btcPattern = /[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{39,59}/g;

        const searchFields = (obj: unknown, depth = 0): void => {
            if (depth > 5) return;

            if (typeof obj === 'string') {
                const ethMatches = obj.match(ethPattern);
                const btcMatches = obj.match(btcPattern);
                if (ethMatches) wallets.push(...ethMatches);
                if (btcMatches) wallets.push(...btcMatches);
            } else if (Array.isArray(obj)) {
                obj.forEach(item => searchFields(item, depth + 1));
            } else if (obj && typeof obj === 'object') {
                Object.values(obj).forEach(val => searchFields(val, depth + 1));
            }
        };

        searchFields(data);
        return [...new Set(wallets)]; // Deduplicate
    }
}

// Register the agent
registerAgent('COMPLIANCE_AUDITOR', ComplianceAuditorAgent);
