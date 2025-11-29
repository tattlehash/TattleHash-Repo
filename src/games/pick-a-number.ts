/**
 * Pick a Number Game Module (Duel Mode)
 *
 * Players each pick a number 1-10. Winner is determined by
 * combined entropy - closest to derived target number wins.
 */

import { BaseGameModule } from './base';
import type { GameMode, GameChoice, GameResult } from './types';
import { hashToNumber } from './crypto';

const NUMBER_RANGE = { min: 1, max: 10 };

/**
 * Generate choices for numbers 1-10.
 */
function generateNumberChoices(): GameChoice[] {
    const choices: GameChoice[] = [];
    for (let i = NUMBER_RANGE.min; i <= NUMBER_RANGE.max; i++) {
        choices.push({
            id: String(i),
            label: String(i),
            shortcut: i === 10 ? '0' : String(i),
        });
    }
    return choices;
}

const NUMBER_CHOICES = generateNumberChoices();

export class PickANumberGame extends BaseGameModule {
    readonly id: GameMode = 'duel';
    readonly name = 'Pick a Number';
    readonly description = 'Pick 1-10, closest to target wins';

    private selectedNumber: string | null = null;

    getChoices(): GameChoice[] {
        return NUMBER_CHOICES;
    }

    /**
     * Determine winner based on distance to target number.
     * Target is derived from combined entropy.
     */
    determineWinner(): GameResult {
        const match = this._state.match;
        const localCommit = this._state.localCommit;

        if (!match || !localCommit) {
            throw new Error('Cannot determine winner: missing data');
        }

        const localNumber = parseInt(localCommit.choice, 10);

        // For v1, simulate opponent choice and target
        const opponentNumber = Math.floor(Math.random() * 10) + 1;

        // Derive target from combined entropy (simulated for v1)
        const combinedHash = `${match.serverNonce}:${localCommit.seed}:${crypto.randomUUID()}`;
        const targetNumber = hashToNumber(combinedHash, NUMBER_RANGE.min, NUMBER_RANGE.max);

        const localDistance = Math.abs(localNumber - targetNumber);
        const opponentDistance = Math.abs(opponentNumber - targetNumber);

        let outcome: 'win' | 'lose' | 'draw';
        let winnerId: string | null;

        if (localDistance < opponentDistance) {
            outcome = 'win';
            winnerId = match.players.A.id;
        } else if (localDistance > opponentDistance) {
            outcome = 'lose';
            winnerId = match.players.B.id;
        } else {
            outcome = 'draw';
            winnerId = null;
        }

        return {
            outcome,
            localChoice: String(localNumber),
            opponentChoice: String(opponentNumber),
            winnerId,
            // Store target for display
            attestationHash: String(targetNumber),
        };
    }

    reset(): void {
        this.selectedNumber = null;
        super.reset();
    }

    protected renderUI(): void {
        if (!this.container) return;

        this.injectStyles();
        this.injectDuelStyles();

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
                content = this.renderRevealing();
                break;
            case 'resolved':
                content = this.renderResult(result!);
                break;
            case 'error':
                content = this.renderError(error!);
                break;
        }

        this.container.innerHTML = `
            <div class="th-game th-duel">
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

    private injectDuelStyles(): void {
        if (!this.container) return;

        const styleId = 'th-duel-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .th-duel-numbers {
                display: grid;
                grid-template-columns: repeat(5, 1fr);
                gap: 0.5rem;
                max-width: 300px;
                margin: 0 auto 1rem;
            }
            .th-duel-number {
                aspect-ratio: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.25rem;
                font-weight: 600;
                background: white;
                border: 2px solid #e0e0e0;
                border-radius: 0.5rem;
                cursor: pointer;
                transition: all 0.2s ease;
            }
            .th-duel-number:hover {
                border-color: #6366f1;
                transform: scale(1.05);
            }
            .th-duel-number.selected {
                background: #6366f1;
                color: white;
                border-color: #6366f1;
            }
            .th-duel-reveal {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 1rem;
                margin-bottom: 1rem;
            }
            .th-duel-card {
                width: 60px;
                height: 80px;
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 2rem;
                font-weight: bold;
                background: white;
                border: 2px solid #e0e0e0;
                border-radius: 0.5rem;
            }
            .th-duel-card.target {
                background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 100%);
                color: white;
                border-color: #f59e0b;
            }
            .th-duel-card.local {
                border-color: #6366f1;
            }
            .th-duel-card.opponent {
                border-color: #ef4444;
            }
            .th-duel-label {
                font-size: 0.75rem;
                text-transform: uppercase;
                color: #666;
                margin-top: 0.25rem;
            }
            .th-duel-player {
                text-align: center;
            }
        `;
        document.head.appendChild(style);
    }

    private renderIdle(): string {
        return `
            <div class="th-duel-reveal">
                <div class="th-duel-player">
                    <div class="th-duel-card">?</div>
                    <div class="th-duel-label">You</div>
                </div>
                <div class="th-duel-player">
                    <div class="th-duel-card target">?</div>
                    <div class="th-duel-label">Target</div>
                </div>
                <div class="th-duel-player">
                    <div class="th-duel-card">?</div>
                    <div class="th-duel-label">Opponent</div>
                </div>
            </div>
            <button class="th-game-btn" data-action="start">
                Start Duel
            </button>
        `;
    }

    private renderCommitting(): string {
        const numbersHtml = NUMBER_CHOICES.map(choice => `
            <button class="th-duel-number ${this.selectedNumber === choice.id ? 'selected' : ''}"
                    data-number="${choice.id}">
                ${choice.label}
            </button>
        `).join('');

        return `
            <p>Pick a number (1-10):</p>
            <div class="th-duel-numbers">
                ${numbersHtml}
            </div>
            <button class="th-game-btn"
                    data-action="commit"
                    ${!this.selectedNumber ? 'disabled' : ''}>
                Lock In Number
            </button>
        `;
    }

    private renderWaiting(message: string): string {
        return `
            <div class="th-duel-reveal">
                <div class="th-duel-player">
                    <div class="th-duel-card local">${this.selectedNumber || '?'}</div>
                    <div class="th-duel-label">You</div>
                </div>
                <div class="th-duel-player">
                    <div class="th-duel-card target">?</div>
                    <div class="th-duel-label">Target</div>
                </div>
                <div class="th-duel-player">
                    <div class="th-duel-card">?</div>
                    <div class="th-duel-label">Opponent</div>
                </div>
            </div>
            <div class="th-game-waiting">
                <div class="th-game-spinner"></div>
                <p>${message}</p>
            </div>
        `;
    }

    private renderRevealing(): string {
        return `
            <div class="th-duel-reveal">
                <div class="th-duel-player">
                    <div class="th-duel-card local th-game-shake">${this.selectedNumber || '?'}</div>
                    <div class="th-duel-label">You</div>
                </div>
                <div class="th-duel-player">
                    <div class="th-duel-card target th-game-shake">?</div>
                    <div class="th-duel-label">Target</div>
                </div>
                <div class="th-duel-player">
                    <div class="th-duel-card opponent th-game-shake">?</div>
                    <div class="th-duel-label">Opponent</div>
                </div>
            </div>
            <p>Calculating winner...</p>
        `;
    }

    private renderResult(result: GameResult): string {
        const targetNumber = result.attestationHash || '?';
        const resultClass = result.outcome;
        const resultText = result.outcome === 'win' ? 'You Win!'
            : result.outcome === 'lose' ? 'You Lose'
            : "It's a Draw!";

        return `
            <div class="th-duel-reveal">
                <div class="th-duel-player">
                    <div class="th-duel-card local th-game-bounce">${result.localChoice}</div>
                    <div class="th-duel-label">You</div>
                </div>
                <div class="th-duel-player">
                    <div class="th-duel-card target th-game-bounce">${targetNumber}</div>
                    <div class="th-duel-label">Target</div>
                </div>
                <div class="th-duel-player">
                    <div class="th-duel-card opponent th-game-bounce">${result.opponentChoice}</div>
                    <div class="th-duel-label">Opponent</div>
                </div>
            </div>
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

        // Number selection
        const numberBtns = this.container.querySelectorAll('[data-number]');
        numberBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                this.selectedNumber = target.dataset.number || null;
                this.renderUI();
            });
        });

        // Commit choice
        const commitBtn = this.container.querySelector('[data-action="commit"]');
        commitBtn?.addEventListener('click', async () => {
            if (this.selectedNumber) {
                await this.submitChoice(this.selectedNumber);
                // Auto-reveal for v1 (simulated opponent)
                setTimeout(() => this.reveal(), 1500);
            }
        });

        // Reset
        const resetBtn = this.container.querySelector('[data-action="reset"]');
        resetBtn?.addEventListener('click', () => this.reset());

        // Keyboard shortcuts (1-9, 0 for 10)
        document.addEventListener('keydown', this.handleKeydown.bind(this));
    }

    private handleKeydown(e: KeyboardEvent): void {
        if (this._state.phase !== 'committing') return;

        const key = e.key;
        if (key >= '1' && key <= '9') {
            this.selectedNumber = key;
            this.renderUI();
        } else if (key === '0') {
            this.selectedNumber = '10';
            this.renderUI();
        }
    }
}

/**
 * Create a new Pick a Number game instance.
 */
export function createPickANumberGame(): PickANumberGame {
    return new PickANumberGame();
}
