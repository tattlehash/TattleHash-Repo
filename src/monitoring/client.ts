/**
 * LLM Client Abstraction
 *
 * Provides a unified interface for interacting with LLM providers.
 * Currently supports OpenAI, extensible for Anthropic, etc.
 */

import { Env } from '../types';
import {
    MONITORING_DEFAULTS,
    LlmRequest,
    LlmResponse,
    LlmMessage,
    LlmResponseSchema,
} from './types';

// ============================================================================
// Types
// ============================================================================

export interface LlmClientConfig {
    provider: 'openai' | 'anthropic';
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    defaultTemperature?: number;
    defaultMaxTokens?: number;
    timeout?: number;
}

export interface LlmCompletion {
    content: string;
    model: string;
    tokens: {
        prompt: number;
        completion: number;
        total: number;
    };
    latencyMs: number;
}

export type LlmClientResult = {
    ok: true;
    completion: LlmCompletion;
} | {
    ok: false;
    error: string;
    code: 'API_ERROR' | 'TIMEOUT' | 'RATE_LIMIT' | 'INVALID_RESPONSE' | 'CONFIG_ERROR';
};

// ============================================================================
// LLM Client
// ============================================================================

export class LlmClient {
    private config: Required<Omit<LlmClientConfig, 'apiKey' | 'baseUrl'>> & Pick<LlmClientConfig, 'apiKey' | 'baseUrl'>;

    constructor(config: LlmClientConfig) {
        this.config = {
            provider: config.provider,
            model: config.model ?? MONITORING_DEFAULTS.DEFAULT_MODEL,
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            defaultTemperature: config.defaultTemperature ?? MONITORING_DEFAULTS.DEFAULT_TEMPERATURE,
            defaultMaxTokens: config.defaultMaxTokens ?? MONITORING_DEFAULTS.DEFAULT_MAX_TOKENS,
            timeout: config.timeout ?? 30000,
        };
    }

    /**
     * Create an LLM client from environment configuration
     */
    static fromEnv(env: Env): LlmClient | null {
        if (!env.OPENAI_API_KEY) {
            return null;
        }

        return new LlmClient({
            provider: 'openai',
            model: env.OPENAI_MODEL ?? MONITORING_DEFAULTS.DEFAULT_MODEL,
            apiKey: env.OPENAI_API_KEY,
        });
    }

    /**
     * Check if the client is configured and ready
     */
    isConfigured(): boolean {
        return !!this.config.apiKey;
    }

    /**
     * Send a completion request to the LLM
     */
    async complete(
        messages: LlmMessage[],
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
            jsonMode?: boolean;
        }
    ): Promise<LlmClientResult> {
        if (!this.config.apiKey) {
            return {
                ok: false,
                error: 'API key not configured',
                code: 'CONFIG_ERROR',
            };
        }

        const startTime = Date.now();

        try {
            const request: LlmRequest = {
                model: options?.model ?? this.config.model,
                messages,
                temperature: options?.temperature ?? this.config.defaultTemperature,
                max_tokens: options?.maxTokens ?? this.config.defaultMaxTokens,
            };

            if (options?.jsonMode) {
                request.response_format = { type: 'json_object' };
            }

            const response = await this.callOpenAI(request);

            if (!response.ok) {
                return response;
            }

            const latencyMs = Date.now() - startTime;

            return {
                ok: true,
                completion: {
                    content: response.data.choices[0]?.message?.content ?? '',
                    model: response.data.model,
                    tokens: {
                        prompt: response.data.usage.prompt_tokens,
                        completion: response.data.usage.completion_tokens,
                        total: response.data.usage.total_tokens,
                    },
                    latencyMs,
                },
            };
        } catch (error: any) {
            console.error('LLM completion error:', error);
            return {
                ok: false,
                error: error.message ?? 'Unknown error',
                code: 'API_ERROR',
            };
        }
    }

    /**
     * Send a JSON completion request (expects structured JSON response)
     */
    async completeJson<T>(
        messages: LlmMessage[],
        options?: {
            model?: string;
            temperature?: number;
            maxTokens?: number;
        }
    ): Promise<{ ok: true; data: T; completion: LlmCompletion } | { ok: false; error: string; code: string }> {
        const result = await this.complete(messages, {
            ...options,
            jsonMode: true,
        });

        if (!result.ok) {
            return result;
        }

        try {
            const data = JSON.parse(result.completion.content) as T;
            return {
                ok: true,
                data,
                completion: result.completion,
            };
        } catch (error: any) {
            return {
                ok: false,
                error: `Failed to parse JSON response: ${error.message}`,
                code: 'INVALID_RESPONSE',
            };
        }
    }

    /**
     * Call OpenAI API
     */
    private async callOpenAI(
        request: LlmRequest
    ): Promise<{ ok: true; data: LlmResponse } | { ok: false; error: string; code: 'API_ERROR' | 'TIMEOUT' | 'RATE_LIMIT' | 'INVALID_RESPONSE' }> {
        const baseUrl = this.config.baseUrl ?? 'https://api.openai.com/v1';

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

        try {
            const response = await fetch(`${baseUrl}/chat/completions`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.config.apiKey}`,
                },
                body: JSON.stringify(request),
                signal: controller.signal,
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                const errorBody = await response.text();

                if (response.status === 429) {
                    return {
                        ok: false,
                        error: `Rate limited: ${errorBody}`,
                        code: 'RATE_LIMIT',
                    };
                }

                return {
                    ok: false,
                    error: `API error (${response.status}): ${errorBody}`,
                    code: 'API_ERROR',
                };
            }

            const data = await response.json();

            // Validate response structure
            const parsed = LlmResponseSchema.safeParse(data);
            if (!parsed.success) {
                console.error('Invalid LLM response structure:', parsed.error);
                return {
                    ok: false,
                    error: 'Invalid response structure from LLM',
                    code: 'INVALID_RESPONSE',
                };
            }

            return {
                ok: true,
                data: parsed.data,
            };
        } catch (error: any) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                return {
                    ok: false,
                    error: 'Request timed out',
                    code: 'TIMEOUT',
                };
            }

            return {
                ok: false,
                error: error.message ?? 'Network error',
                code: 'API_ERROR',
            };
        }
    }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create a system message
 */
export function systemMessage(content: string): LlmMessage {
    return { role: 'system', content };
}

/**
 * Create a user message
 */
export function userMessage(content: string): LlmMessage {
    return { role: 'user', content };
}

/**
 * Create an assistant message
 */
export function assistantMessage(content: string): LlmMessage {
    return { role: 'assistant', content };
}
