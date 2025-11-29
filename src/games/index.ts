/**
 * TattleHash Game Modules
 *
 * This module provides the game interface contract and v1 placeholder implementations.
 * Design studios can create premium versions by implementing the GameModule interface.
 *
 * @example
 * ```typescript
 * import { createCoinTossGame, type GameConfig } from '@tattlehash/games';
 *
 * const game = createCoinTossGame();
 * game.initialize({
 *     mode: 'coin',
 *     apiBaseUrl: '/api',
 *     localPlayerId: 'user-123',
 *     opponentPlayerId: 'user-456',
 *     onComplete: (result) => console.log('Game finished:', result),
 * });
 *
 * const cleanup = game.render(document.getElementById('game-container')!);
 * ```
 */

// Core types and interfaces
export type {
    GameModule,
    GameMode,
    GamePhase,
    GameState,
    GameConfig,
    GameChoice,
    GameResult,
    GameError,
    GameOutcome,
    MatchData,
    CommitData,
    Player,
    AnimationConfig,
    CreateMatchResponse,
    CommitResponse,
    RevealResponse,
    ApiErrorResponse,
} from './types';

export { DEFAULT_ANIMATION, GAME_TIMEOUT_MS } from './types';

// Base class for custom implementations
export { BaseGameModule } from './base';

// API client
export { GameApiClient, GameApiError, createApiClient } from './api';

// Crypto utilities
export {
    generateSeed,
    sha256Hex,
    createCommitment,
    generateCommitData,
    verifyCommitment,
    combinedEntropy,
    hashToNumber,
    hashToCoinFlip,
} from './crypto';

// Game implementations
export { CoinTossGame, createCoinTossGame } from './coin-toss';
export { RPSGame, createRPSGame } from './rps';
export { PickANumberGame, createPickANumberGame } from './pick-a-number';

// Factory function to create games by mode
import type { GameModule, GameMode } from './types';
import { CoinTossGame } from './coin-toss';
import { RPSGame } from './rps';
import { PickANumberGame } from './pick-a-number';

/**
 * Create a game module instance by mode.
 *
 * @param mode - The game mode ('coin', 'rps', 'duel')
 * @returns A new game module instance
 * @throws Error if mode is invalid
 */
export function createGame(mode: GameMode): GameModule {
    switch (mode) {
        case 'coin':
            return new CoinTossGame();
        case 'rps':
            return new RPSGame();
        case 'duel':
            return new PickANumberGame();
        default:
            throw new Error(`Unknown game mode: ${mode}`);
    }
}

/**
 * Get all available game modes.
 */
export function getAvailableModes(): GameMode[] {
    return ['coin', 'rps', 'duel'];
}

/**
 * Get game metadata by mode.
 */
export function getGameInfo(mode: GameMode): { name: string; description: string } {
    const game = createGame(mode);
    return {
        name: game.name,
        description: game.description,
    };
}
