/**
 * TattleHash Game Module Interface Contract
 *
 * This file defines the contract that all game modules must implement.
 * Premium versions can swap in by implementing this same interface.
 *
 * @version 1.0.0
 */

// ============================================================================
// Game States
// ============================================================================

export type GamePhase =
    | 'idle'           // No game in progress
    | 'creating'       // Creating match on server
    | 'committing'     // Player is making their choice
    | 'waiting'        // Waiting for opponent to commit/reveal
    | 'revealing'      // Revealing choice to server
    | 'resolved'       // Game complete, showing result
    | 'error';         // Something went wrong

export type GameOutcome = 'win' | 'lose' | 'draw';

// ============================================================================
// Player & Match Data
// ============================================================================

export interface Player {
    id: string;
    label: string;         // "You" or "Opponent" for display
    isLocal: boolean;      // Is this the local player?
}

export interface MatchData {
    id: string;
    serverNonce: string;
    mode: GameMode;
    players: {
        A: Player;
        B: Player;
    };
    localPlayer: 'A' | 'B';
    createdAt: number;
    expiresAt: number;
}

// ============================================================================
// Game Configuration
// ============================================================================

export type GameMode = 'coin' | 'rps' | 'duel';

export interface GameConfig {
    mode: GameMode;
    apiBaseUrl: string;
    localPlayerId: string;
    opponentPlayerId: string;
    onStateChange?: (state: GameState) => void;
    onComplete?: (result: GameResult) => void;
    onError?: (error: GameError) => void;
}

// ============================================================================
// Game State
// ============================================================================

export interface GameState {
    phase: GamePhase;
    match: MatchData | null;
    localCommit: CommitData | null;
    opponentCommitted: boolean;
    opponentRevealed: boolean;
    result: GameResult | null;
    error: GameError | null;
}

export interface CommitData {
    seed: string;
    choice: string;
    hash: string;
}

export interface GameResult {
    outcome: GameOutcome;
    localChoice: string;
    opponentChoice: string;
    winnerId: string | null;      // null for draw
    attestationHash?: string;     // Hash for attestation trail
}

export interface GameError {
    code: string;
    message: string;
    recoverable: boolean;
}

// ============================================================================
// Game Module Interface
// ============================================================================

/**
 * The core interface that all game modules must implement.
 * Design studios can create custom implementations while keeping this contract.
 */
export interface GameModule {
    /** Unique identifier for this game type */
    readonly id: GameMode;

    /** Display name for the game */
    readonly name: string;

    /** Short description for UI */
    readonly description: string;

    /** Current game state */
    readonly state: GameState;

    /**
     * Initialize the game module with configuration.
     * Must be called before any other methods.
     */
    initialize(config: GameConfig): void;

    /**
     * Create a new match on the server.
     * Transitions: idle -> creating -> committing
     */
    createMatch(): Promise<void>;

    /**
     * Get the available choices for this game type.
     * Returns empty array for games like coin toss that don't require choice.
     */
    getChoices(): GameChoice[];

    /**
     * Submit the local player's choice (commit phase).
     * Transitions: committing -> waiting
     */
    submitChoice(choice: string): Promise<void>;

    /**
     * Poll for opponent's commit status.
     * Call this periodically while in 'waiting' phase.
     */
    checkOpponentCommit(): Promise<boolean>;

    /**
     * Reveal the local player's choice.
     * Transitions: waiting -> revealing -> resolved
     */
    reveal(): Promise<void>;

    /**
     * Determine the winner after both players have revealed.
     * This is called automatically after reveal() if both have revealed.
     */
    determineWinner(): GameResult;

    /**
     * Reset the game to idle state.
     * Can be called at any time.
     */
    reset(): void;

    /**
     * Render the game UI to a container element.
     * Returns a cleanup function.
     */
    render(container: HTMLElement): () => void;

    /**
     * Destroy the game module and clean up resources.
     */
    destroy(): void;
}

// ============================================================================
// UI Components
// ============================================================================

export interface GameChoice {
    id: string;
    label: string;
    icon?: string;      // Emoji or icon class
    shortcut?: string;  // Keyboard shortcut
}

export interface AnimationConfig {
    /** Duration in milliseconds */
    duration: number;
    /** CSS easing function */
    easing: string;
    /** Whether to show particle effects (v2 feature) */
    particles: boolean;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface CreateMatchResponse {
    ok: boolean;
    id: string;
    serverNonce: string;
}

export interface CommitResponse {
    ok: boolean;
}

export interface RevealResponse {
    ok: boolean;
    result: string;
}

export interface ApiErrorResponse {
    ok: false;
    error: string;
    details?: Record<string, unknown>;
}

// ============================================================================
// Default Configurations
// ============================================================================

export const DEFAULT_ANIMATION: AnimationConfig = {
    duration: 300,
    easing: 'cubic-bezier(0.4, 0, 0.2, 1)',
    particles: false,
};

export const GAME_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
