# TattleHash Game Modules

This directory contains the game module interface contract and v1 placeholder implementations. Design studios can create premium versions by implementing the `GameModule` interface.

## Architecture

```
src/games/
├── types.ts          # Interface contract and type definitions
├── base.ts           # Base class with common functionality
├── api.ts            # API client for backend endpoints
├── crypto.ts         # Commit-reveal cryptographic utilities
├── coin-toss.ts      # Coin Toss game implementation
├── rps.ts            # Rock Paper Scissors implementation
├── pick-a-number.ts  # Pick a Number (Duel) implementation
└── index.ts          # Public exports
```

## The GameModule Interface

All game modules must implement this interface:

```typescript
interface GameModule {
    // Identification
    readonly id: GameMode;           // 'coin' | 'rps' | 'duel'
    readonly name: string;           // Display name
    readonly description: string;    // Short description
    readonly state: GameState;       // Current game state

    // Lifecycle
    initialize(config: GameConfig): void;
    destroy(): void;
    reset(): void;

    // Game flow
    createMatch(): Promise<void>;
    getChoices(): GameChoice[];
    submitChoice(choice: string): Promise<void>;
    checkOpponentCommit(): Promise<boolean>;
    reveal(): Promise<void>;
    determineWinner(): GameResult;

    // Rendering
    render(container: HTMLElement): () => void;
}
```

## Game State Machine

```
idle → creating → committing → waiting → revealing → resolved
                                   ↓
                                 error
```

| Phase | Description |
|-------|-------------|
| `idle` | No game in progress |
| `creating` | Creating match on server |
| `committing` | Player is making their choice |
| `waiting` | Waiting for opponent to commit/reveal |
| `revealing` | Revealing choice to server |
| `resolved` | Game complete, showing result |
| `error` | Something went wrong |

## Commit-Reveal Protocol

TattleHash uses a commit-reveal protocol for cryptographic fairness:

1. **Commit Phase**: Player generates random seed, creates `hash(seed:choice)`, sends hash to server
2. **Reveal Phase**: After both commit, players reveal `seed` and `choice`
3. **Verification**: Server verifies `hash(seed:choice)` matches original commitment

For **Coin Toss**, the choice is empty: `hash(seed:)`. The result is derived from combined entropy of both seeds plus server nonce.

## Creating a Custom Game Module

### Option 1: Extend BaseGameModule

```typescript
import { BaseGameModule } from './base';
import type { GameMode, GameChoice, GameResult } from './types';

export class MyCustomGame extends BaseGameModule {
    readonly id: GameMode = 'rps';  // Must match backend mode
    readonly name = 'My Custom RPS';
    readonly description = 'Premium RPS with fancy animations';

    getChoices(): GameChoice[] {
        return [
            { id: 'rock', label: 'Rock', icon: '🪨' },
            { id: 'paper', label: 'Paper', icon: '📄' },
            { id: 'scissors', label: 'Scissors', icon: '✂️' },
        ];
    }

    determineWinner(): GameResult {
        // Implement your winner logic
        // Access this._state.match and this._state.localCommit
    }

    protected renderUI(): void {
        // Implement your custom UI rendering
        // Access this.container for the DOM element
    }
}
```

### Option 2: Implement GameModule Directly

```typescript
import type { GameModule, GameConfig, GameState } from './types';
import { GameApiClient } from './api';
import { generateCommitData } from './crypto';

export class MyCustomGame implements GameModule {
    readonly id = 'rps' as const;
    readonly name = 'Premium RPS';
    readonly description = 'Deluxe RPS experience';

    private _state: GameState;
    private api: GameApiClient;
    private config: GameConfig;

    get state() { return this._state; }

    initialize(config: GameConfig): void {
        this.config = config;
        this.api = new GameApiClient(config.apiBaseUrl);
        // Setup your game
    }

    // Implement all interface methods...
}
```

## Backend API Integration

The game modules communicate with these backend endpoints:

### POST /game/create
Create a new match.

```typescript
// Request
{
    mode: 'coin' | 'rps' | 'duel',
    players: [playerAId, playerBId]
}

// Response
{
    ok: true,
    id: 'match-uuid',
    serverNonce: 'random-nonce-for-fairness'
}
```

### POST /game/commit
Submit a player's commitment.

```typescript
// Request
{
    matchId: 'match-uuid',
    player: 'A' | 'B',
    commit: 'sha256-hash'
}

// Response
{ ok: true }
```

### POST /game/reveal
Reveal a player's choice.

```typescript
// Request
{
    matchId: 'match-uuid',
    player: 'A' | 'B',
    seed: 'random-uuid',
    choice?: 'rock' | 'paper' | 'scissors' | '1'-'10'  // Optional for coin
}

// Response
{
    ok: true,
    result: 'win' | 'lose' | 'draw'  // Only after both reveal
}
```

## CSS Styling

The base class provides these CSS classes for styling:

| Class | Description |
|-------|-------------|
| `.th-game` | Main container |
| `.th-game-title` | Game title |
| `.th-game-desc` | Game description |
| `.th-game-phase` | Current phase indicator |
| `.th-game-arena` | Main game area |
| `.th-game-choices` | Choice button container |
| `.th-game-choice` | Individual choice button |
| `.th-game-btn` | Primary action button |
| `.th-game-result` | Result display |
| `.th-game-result.win/.lose/.draw` | Result variants |
| `.th-game-error` | Error display |
| `.th-game-waiting` | Loading state |
| `.th-game-spinner` | Loading spinner |

### Animation Classes

| Class | Effect |
|-------|--------|
| `.th-game-flip` | Card flip animation |
| `.th-game-bounce` | Bounce/scale animation |
| `.th-game-shake` | Shake animation |

## Usage Example

```typescript
import { createGame, type GameConfig } from '@tattlehash/games';

// Create game
const game = createGame('rps');

// Configure
const config: GameConfig = {
    mode: 'rps',
    apiBaseUrl: 'https://api.tattlehash.com',
    localPlayerId: 'user-123',
    opponentPlayerId: 'user-456',
    onStateChange: (state) => console.log('State:', state),
    onComplete: (result) => console.log('Result:', result),
    onError: (error) => console.error('Error:', error),
};

game.initialize(config);

// Render
const container = document.getElementById('game-container');
const cleanup = game.render(container);

// Later: cleanup
cleanup();
game.destroy();
```

## Type Exports

```typescript
// Core types
GameModule, GameMode, GamePhase, GameState
GameConfig, GameChoice, GameResult, GameError
GameOutcome, MatchData, CommitData, Player

// Response types
CreateMatchResponse, CommitResponse, RevealResponse, ApiErrorResponse

// Utilities
AnimationConfig, DEFAULT_ANIMATION, GAME_TIMEOUT_MS
```

## v2 Upgrade Path

When creating premium v2 modules:

1. **Keep the same `id`**: The backend uses mode IDs ('coin', 'rps', 'duel')
2. **Match the interface**: Implement all `GameModule` methods
3. **Use existing crypto**: Import from `./crypto` for commit-reveal
4. **Use existing API client**: Import from `./api` for server communication
5. **Add your own styles**: Override `renderUI()` with custom rendering
6. **Enhance animations**: Replace CSS animations with WebGL/Canvas/etc.

The v1 modules are designed to be completely replaceable. Simply swap the import:

```typescript
// v1
import { RPSGame } from './games/rps';

// v2 (drop-in replacement)
import { RPSGame } from './games-premium/rps';
```
