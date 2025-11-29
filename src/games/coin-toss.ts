/**
 * Coin Toss Game Module
 *
 * A simple fair coin flip using combined entropy from both players.
 * No choice required - outcome is derived from combined seeds.
 */

import { BaseGameModule } from './base';
import type { GameMode, GameChoice, GameResult } from './types';
import { combinedEntropy, hashToCoinFlip } from './crypto';

export class CoinTossGame extends BaseGameModule {
    readonly id: GameMode = 'coin';
    readonly name = 'Coin Toss';
    readonly description = 'Fair 50/50 flip using combined entropy';

    /**
     * Coin toss has no choices - outcome is derived from seeds.
     */
    getChoices(): GameChoice[] {
        return [];
    }

    /**
     * For coin toss, we auto-submit an empty choice.
     * The commitment is just hash(seed:)
     */
    async submitChoice(_choice: string = ''): Promise<void> {
        return super.submitChoice('');
    }

    /**
     * Determine winner based on combined entropy.
     * For v1, we simulate the opponent's seed.
     */
    determineWinner(): GameResult {
        const match = this._state.match;
        const localCommit = this._state.localCommit;

        if (!match || !localCommit) {
            throw new Error('Cannot determine winner: missing data');
        }

        // For v1, simulate opponent seed
        // In production, this would come from the server after reveal
        const opponentSeed = crypto.randomUUID();

        // Derive result from combined entropy (synchronous for v1)
        const combinedHash = `${match.serverNonce}:${localCommit.seed}:${opponentSeed}`;
        const firstByte = parseInt(combinedHash.slice(0, 2), 16) || 0;
        const coinResult = firstByte % 2 === 0 ? 'heads' : 'tails';

        // Local player is always caller, wins on heads
        const localWins = coinResult === 'heads';

        return {
            outcome: localWins ? 'win' : 'lose',
            localChoice: 'heads',
            opponentChoice: 'tails',
            winnerId: localWins
                ? match.players.A.id
                : match.players.B.id,
        };
    }

    protected renderUI(): void {
        if (!this.container) return;

        this.injectStyles();

        const { phase, result, error } = this._state;

        let content = '';

        switch (phase) {
            case 'idle':
                content = this.renderIdle();
                break;
            case 'creating':
                content = this.renderWaiting('Creating match...');
                break;
            case 'committing':
                content = this.renderCommitting();
                break;
            case 'waiting':
                content = this.renderWaiting('Waiting for opponent...');
                break;
            case 'revealing':
                content = this.renderWaiting('Revealing...');
                break;
            case 'resolved':
                content = this.renderResult(result!);
                break;
            case 'error':
                content = this.renderError(error!);
                break;
        }

        this.container.innerHTML = `
            <div class="th-game th-coin-toss">
                <div class="th-game-title">${this.name}</div>
                <div class="th-game-desc">${this.description}</div>
                <div class="th-game-phase">${phase}</div>
                <div class="th-game-arena">
                    ${content}
                </div>
            </div>
        `;

        this.attachEventListeners();
    }

    private renderIdle(): string {
        return `
            <div class="th-coin-display">🪙</div>
            <button class="th-game-btn" data-action="start">
                Flip Coin
            </button>
        `;
    }

    private renderCommitting(): string {
        return `
            <div class="th-coin-display th-game-bounce">🪙</div>
            <p>Ready to flip?</p>
            <button class="th-game-btn" data-action="commit">
                Commit & Flip
            </button>
        `;
    }

    private renderWaiting(message: string): string {
        return `
            <div class="th-game-waiting">
                <div class="th-game-spinner"></div>
                <p>${message}</p>
            </div>
        `;
    }

    private renderResult(result: GameResult): string {
        const isWin = result.outcome === 'win';
        const coinFace = isWin ? '🎉' : '😔';
        const resultClass = result.outcome;
        const resultText = isWin ? 'You Win!' : 'You Lose';

        return `
            <div class="th-coin-display th-game-flip">${coinFace}</div>
            <div class="th-game-result ${resultClass}">
                ${resultText}
            </div>
            <button class="th-game-btn" data-action="reset">
                Play Again
            </button>
        `;
    }

    private renderError(error: { code: string; message: string }): string {
        return `
            <div class="th-game-error">
                <strong>Error:</strong> ${error.message}
            </div>
            <button class="th-game-btn" data-action="reset">
                Try Again
            </button>
        `;
    }

    private attachEventListeners(): void {
        if (!this.container) return;

        // Start game
        const startBtn = this.container.querySelector('[data-action="start"]');
        startBtn?.addEventListener('click', () => this.createMatch());

        // Commit (auto-submits empty choice for coin toss)
        const commitBtn = this.container.querySelector('[data-action="commit"]');
        commitBtn?.addEventListener('click', async () => {
            await this.submitChoice('');
            // Auto-reveal for v1 (simulated opponent)
            setTimeout(() => this.reveal(), 1000);
        });

        // Reset
        const resetBtn = this.container.querySelector('[data-action="reset"]');
        resetBtn?.addEventListener('click', () => this.reset());
    }
}

/**
 * Create a new Coin Toss game instance.
 */
export function createCoinTossGame(): CoinTossGame {
    return new CoinTossGame();
}
