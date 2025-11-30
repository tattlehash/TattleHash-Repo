/**
 * Fraud Pattern Analyzer Agent
 *
 * Specialized agent for detecting known scam signatures and fraud patterns.
 * Focuses on: scam typologies, social engineering, URL analysis.
 */

import { LlmClient } from '../client';
import { BaseAgent, AgentConfig, registerAgent } from './base';
import { AgentInput } from '../types';

const SYSTEM_PROMPT = `You are the Fraud Pattern Analyzer, a specialized AI agent trained to detect scam signatures and fraud patterns in peer-to-peer transactions.

YOUR ROLE:
- Identify known scam patterns and typologies
- Detect social engineering tactics
- Analyze URLs for phishing/malware indicators
- Recognize impersonation and fake identity signals

KNOWN SCAM PATTERNS TO DETECT:

1. ADVANCE FEE FRAUD
   - Requests for upfront payments before larger sums
   - "Processing fees", "tax payments", "release fees"
   - Promise of returns far exceeding initial payment

2. OVERPAYMENT SCAMS
   - Payment exceeds agreed amount
   - Request to return difference
   - Often uses fake checks or reversible payments

3. ESCROW IMPERSONATION
   - Fake escrow services
   - Links to lookalike websites
   - Pressure to use "their" escrow service

4. ROMANCE/RELATIONSHIP SCAMS
   - Building fake emotional connection
   - Sudden emergencies requiring money
   - Never able to meet in person

5. INVESTMENT SCAMS
   - Guaranteed high returns
   - Urgency and FOMO tactics
   - Unregistered investments

6. CRYPTO-SPECIFIC SCAMS
   - Fake exchange interfaces
   - Rug pull patterns
   - Dusting attacks
   - Address poisoning

7. SOCIAL ENGINEERING
   - Impersonating authority figures
   - Creating artificial urgency
   - Isolating victim from advisors
   - Appeal to greed or fear

URL RED FLAGS:
- Lookalike domains (g00gle.com, paypa1.com)
- Recently registered domains
- Unusual TLDs
- IP addresses instead of domains
- Excessive subdomains
- Shortened URLs hiding destination

OUTPUT FORMAT:
Respond ONLY with valid JSON. Be specific about which scam patterns match.
Include evidence from the transaction data that triggered each flag.`;

const CONFIG: AgentConfig = {
    name: 'Fraud Pattern Analyzer',
    type: 'FRAUD_ANALYZER',
    version: '1.0.0',
    description: 'Specialized in detecting scam signatures',
    systemPrompt: SYSTEM_PROMPT,
    temperature: 0.15,
    maxTokens: 2500,
    supportedModes: ['BALANCED', 'PRECISION'],
};

export class FraudAnalyzerAgent extends BaseAgent {
    constructor(client: LlmClient) {
        super(client, CONFIG);
    }

    protected override buildAnalysisPrompt(input: AgentInput): string {
        const data = input.target_data as Record<string, unknown>;

        // Extract text content for analysis
        const description = data.description ?? data.title ?? '';
        const messages = data.messages ?? data.communication ?? [];
        const urls = this.extractUrls(data);

        return `Analyze this transaction for fraud patterns and scam signatures:

TRANSACTION:
- ID: ${input.target_id}
- Type: ${input.target_type}

DESCRIPTION/CONTENT:
"${description}"

${Array.isArray(messages) && messages.length > 0 ? `COMMUNICATION:\n${JSON.stringify(messages, null, 2)}` : ''}

${urls.length > 0 ? `URLS FOUND:\n${urls.map(u => `- ${u}`).join('\n')}` : 'NO URLS DETECTED'}

FULL DATA:
${JSON.stringify(input.target_data, null, 2)}

${input.context ? `CONTEXT:\n${JSON.stringify(input.context, null, 2)}` : ''}

Check for:
1. Known scam pattern matches (advance fee, overpayment, escrow impersonation, etc.)
2. Social engineering tactics (urgency, authority, isolation, emotional manipulation)
3. URL/link red flags (lookalikes, suspicious domains, redirects)
4. Impersonation signals (fake identities, authority claims)
5. Too-good-to-be-true offers

For each concern, specify:
- Which scam pattern it matches
- The specific evidence that triggered it
- Confidence level in the match

Respond with JSON:
{
  "confidence_score": <0.0-1.0>,
  "risk_contribution": <0-100>,
  "flags": [
    {
      "flag_type": "SCAM_PATTERN",
      "severity": "<severity>",
      "title": "<specific scam type>",
      "description": "<evidence and explanation>",
      "evidence": { "pattern_matched": "<pattern>", "indicators": [...] }
    }
  ],
  "summary": "<summary of fraud analysis>",
  "recommendations": [...]
}`;
    }

    /**
     * Extract URLs from various data fields
     */
    private extractUrls(data: Record<string, unknown>): string[] {
        const urls: string[] = [];
        const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

        const searchFields = (obj: unknown, depth = 0): void => {
            if (depth > 5) return; // Prevent infinite recursion

            if (typeof obj === 'string') {
                const matches = obj.match(urlPattern);
                if (matches) urls.push(...matches);
            } else if (Array.isArray(obj)) {
                obj.forEach(item => searchFields(item, depth + 1));
            } else if (obj && typeof obj === 'object') {
                Object.values(obj).forEach(val => searchFields(val, depth + 1));
            }
        };

        searchFields(data);
        return [...new Set(urls)]; // Deduplicate
    }
}

// Register the agent
registerAgent('FRAUD_ANALYZER', FraudAnalyzerAgent);
