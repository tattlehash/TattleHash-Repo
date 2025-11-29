/**
 * Base class for game modules with common functionality.
 */

import type {
    GameModule,
    GameMode,
    GameConfig,
    GameState,
    GamePhase,
    GameChoice,
    GameResult,
    GameError,
    MatchData,
    CommitData,
    Player,
} from './types';
import { GameApiClient, GameApiError } from './api';
import { generateCommitData } from './crypto';

/**
 * Initial game state.
 */
function createInitialState(): GameState {
    return {
        phase: 'idle',
        match: null,
        localCommit: null,
        opponentCommitted: false,
        opponentRevealed: false,
        result: null,
        error: null,
    };
}

/**
 * Abstract base class for all game modules.
 * Subclasses must implement game-specific logic.
 */
export abstract class BaseGameModule implements GameModule {
    abstract readonly id: GameMode;
    abstract readonly name: string;
    abstract readonly description: string;

    protected config: GameConfig | null = null;
    protected api: GameApiClient | null = null;
    protected _state: GameState = createInitialState();
    protected container: HTMLElement | null = null;
    protected cleanupFn: (() => void) | null = null;

    get state(): GameState {
        return this._state;
    }

    initialize(config: GameConfig): void {
        this.config = config;
        this.api = new GameApiClient(config.apiBaseUrl);
        this.reset();
    }

    protected updateState(updates: Partial<GameState>): void {
        this._state = { ...this._state, ...updates };
        this.config?.onStateChange?.(this._state);
        this.renderUI();
    }

    protected setPhase(phase: GamePhase): void {
        this.updateState({ phase });
    }

    protected setError(error: GameError | null): void {
        this.updateState({
            phase: error ? 'error' : this._state.phase,
            error,
        });
        if (error) {
            this.config?.onError?.(error);
        }
    }

    async createMatch(): Promise<void> {
        if (!this.config || !this.api) {
            throw new Error('Game not initialized');
        }

        this.setPhase('creating');

        try {
            const response = await this.api.createMatch(
                this.id,
                this.config.localPlayerId,
                this.config.opponentPlayerId
            );

            const localIsA = this.config.localPlayerId === this.config.localPlayerId;
            const match: MatchData = {
                id: response.id,
                serverNonce: response.serverNonce,
                mode: this.id,
                players: {
                    A: {
                        id: this.config.localPlayerId,
                        label: 'You',
                        isLocal: true,
                    },
                    B: {
                        id: this.config.opponentPlayerId,
                        label: 'Opponent',
                        isLocal: false,
                    },
                },
                localPlayer: 'A',
                createdAt: Date.now(),
                expiresAt: Date.now() + 10 * 60 * 1000,
            };

            this.updateState({
                phase: 'committing',
                match,
            });
        } catch (error) {
            this.handleError(error);
        }
    }

    abstract getChoices(): GameChoice[];

    async submitChoice(choice: string): Promise<void> {
        if (!this.config || !this.api || !this._state.match) {
            throw new Error('No active match');
        }

        try {
            const commitData = await generateCommitData(choice);

            await this.api.commit(
                this._state.match.id,
                this._state.match.localPlayer,
                commitData.hash
            );

            this.updateState({
                phase: 'waiting',
                localCommit: commitData,
            });
        } catch (error) {
            this.handleError(error);
        }
    }

    async checkOpponentCommit(): Promise<boolean> {
        // In real implementation, would poll server
        // For v1, we simulate opponent has committed
        // This would be replaced with actual API call in production
        return true;
    }

    async reveal(): Promise<void> {
        if (!this.config || !this.api || !this._state.match || !this._state.localCommit) {
            throw new Error('Cannot reveal: missing data');
        }

        this.setPhase('revealing');

        try {
            await this.api.reveal(
                this._state.match.id,
                this._state.match.localPlayer,
                this._state.localCommit.seed,
                this._state.localCommit.choice || undefined
            );

            // Determine winner
            const result = this.determineWinner();

            this.updateState({
                phase: 'resolved',
                result,
            });

            this.config.onComplete?.(result);
        } catch (error) {
            this.handleError(error);
        }
    }

    abstract determineWinner(): GameResult;

    reset(): void {
        this._state = createInitialState();
        this.renderUI();
    }

    render(container: HTMLElement): () => void {
        this.container = container;
        this.renderUI();

        return () => {
            this.container = null;
        };
    }

    protected abstract renderUI(): void;

    destroy(): void {
        this.cleanupFn?.();
        this.container = null;
        this.config = null;
        this.api = null;
        this._state = createInitialState();
    }

    protected handleError(error: unknown): void {
        let gameError: GameError;

        if (error instanceof GameApiError) {
            gameError = error.toGameError();
        } else if (error instanceof Error) {
            gameError = {
                code: 'UNKNOWN_ERROR',
                message: error.message,
                recoverable: false,
            };
        } else {
            gameError = {
                code: 'UNKNOWN_ERROR',
                message: 'An unexpected error occurred',
                recoverable: false,
            };
        }

        this.setError(gameError);
    }

    // ========================================================================
    // UI Helper Methods
    // ========================================================================

    protected createStyles(): string {
        return `
            .th-game {
                font-family: system-ui, -apple-system, sans-serif;
                max-width: 400px;
                margin: 0 auto;
                padding: 1rem;
                text-align: center;
            }
            .th-game-title {
                font-size: 1.5rem;
                font-weight: 600;
                margin-bottom: 0.5rem;
                color: #1a1a2e;
            }
            .th-game-desc {
                font-size: 0.875rem;
                color: #666;
                margin-bottom: 1.5rem;
            }
            .th-game-phase {
                font-size: 0.75rem;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: #888;
                margin-bottom: 1rem;
            }
            .th-game-arena {
                background: linear-gradient(135deg, #f5f7fa 0%, #e4e8eb 100%);
                border-radius: 1rem;
                padding: 2rem;
                margin-bottom: 1.5rem;
                min-height: 200px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
            }
            .th-game-choices {
                display: flex;
                gap: 0.75rem;
                flex-wrap: wrap;
                justify-content: center;
            }
            .th-game-choice {
                background: white;
                border: 2px solid #e0e0e0;
                border-radius: 0.75rem;
                padding: 1rem 1.5rem;
                cursor: pointer;
                transition: all 0.2s ease;
                font-size: 1rem;
                min-width: 80px;
            }
            .th-game-choice:hover {
                border-color: #6366f1;
                transform: translateY(-2px);
                box-shadow: 0 4px 12px rgba(99, 102, 241, 0.2);
            }
            .th-game-choice:active {
                transform: translateY(0);
            }
            .th-game-choice .icon {
                font-size: 2rem;
                display: block;
                margin-bottom: 0.25rem;
            }
            .th-game-btn {
                background: #6366f1;
                color: white;
                border: none;
                border-radius: 0.5rem;
                padding: 0.75rem 2rem;
                font-size: 1rem;
                font-weight: 500;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .th-game-btn:hover {
                background: #4f46e5;
            }
            .th-game-btn:disabled {
                background: #ccc;
                cursor: not-allowed;
            }
            .th-game-result {
                font-size: 1.25rem;
                font-weight: 600;
                padding: 1rem;
                border-radius: 0.5rem;
                margin-bottom: 1rem;
            }
            .th-game-result.win {
                background: #dcfce7;
                color: #166534;
            }
            .th-game-result.lose {
                background: #fee2e2;
                color: #991b1b;
            }
            .th-game-result.draw {
                background: #fef3c7;
                color: #92400e;
            }
            .th-game-error {
                background: #fee2e2;
                color: #991b1b;
                padding: 1rem;
                border-radius: 0.5rem;
                margin-bottom: 1rem;
            }
            .th-game-waiting {
                display: flex;
                flex-direction: column;
                align-items: center;
                gap: 1rem;
            }
            .th-game-spinner {
                width: 40px;
                height: 40px;
                border: 3px solid #e0e0e0;
                border-top-color: #6366f1;
                border-radius: 50%;
                animation: th-spin 1s linear infinite;
            }
            @keyframes th-spin {
                to { transform: rotate(360deg); }
            }
            .th-game-animation {
                transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
            }
            .th-game-flip {
                animation: th-flip 0.6s ease;
            }
            @keyframes th-flip {
                0% { transform: rotateY(0deg); }
                50% { transform: rotateY(90deg); }
                100% { transform: rotateY(0deg); }
            }
            .th-game-bounce {
                animation: th-bounce 0.5s ease;
            }
            @keyframes th-bounce {
                0%, 100% { transform: scale(1); }
                50% { transform: scale(1.2); }
            }
            .th-game-shake {
                animation: th-shake 0.5s ease;
            }
            @keyframes th-shake {
                0%, 100% { transform: translateX(0); }
                25% { transform: translateX(-5px); }
                75% { transform: translateX(5px); }
            }
        `;
    }

    protected injectStyles(): void {
        if (!this.container) return;

        const styleId = `th-game-styles-${this.id}`;
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = this.createStyles();
        document.head.appendChild(style);
    }
}
