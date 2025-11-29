/**
 * API client for TattleHash game endpoints.
 */

import type {
    GameMode,
    CreateMatchResponse,
    CommitResponse,
    RevealResponse,
    ApiErrorResponse,
    GameError,
} from './types';

export class GameApiError extends Error {
    constructor(
        public code: string,
        message: string,
        public recoverable: boolean = false
    ) {
        super(message);
        this.name = 'GameApiError';
    }

    toGameError(): GameError {
        return {
            code: this.code,
            message: this.message,
            recoverable: this.recoverable,
        };
    }
}

export class GameApiClient {
    constructor(private baseUrl: string) {}

    private async request<T>(
        endpoint: string,
        body: Record<string, unknown>
    ): Promise<T> {
        const url = `${this.baseUrl}${endpoint}`;

        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
            });

            const data = await response.json();

            if (!response.ok || data.ok === false) {
                const errorData = data as ApiErrorResponse;
                throw new GameApiError(
                    errorData.error || 'UNKNOWN_ERROR',
                    errorData.details?.message as string || 'Request failed',
                    response.status >= 500 // Server errors are recoverable
                );
            }

            return data as T;
        } catch (error) {
            if (error instanceof GameApiError) {
                throw error;
            }

            // Network error
            throw new GameApiError(
                'NETWORK_ERROR',
                'Failed to connect to server',
                true
            );
        }
    }

    /**
     * Create a new game match.
     */
    async createMatch(
        mode: GameMode,
        playerA: string,
        playerB: string
    ): Promise<CreateMatchResponse> {
        return this.request<CreateMatchResponse>('/game/create', {
            mode,
            players: [playerA, playerB],
        });
    }

    /**
     * Submit a commitment for a player.
     */
    async commit(
        matchId: string,
        player: 'A' | 'B',
        commitHash: string
    ): Promise<CommitResponse> {
        return this.request<CommitResponse>('/game/commit', {
            matchId,
            player,
            commit: commitHash,
        });
    }

    /**
     * Reveal a player's choice.
     */
    async reveal(
        matchId: string,
        player: 'A' | 'B',
        seed: string,
        choice?: string
    ): Promise<RevealResponse> {
        const body: Record<string, unknown> = {
            matchId,
            player,
            seed,
        };

        if (choice !== undefined) {
            body.choice = choice;
        }

        return this.request<RevealResponse>('/game/reveal', body);
    }
}

/**
 * Create a new API client instance.
 */
export function createApiClient(baseUrl: string): GameApiClient {
    return new GameApiClient(baseUrl);
}
