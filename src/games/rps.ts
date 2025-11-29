/**
 * Rock Paper Scissors Game Module
 *
 * Classic RPS with commit-reveal protocol for fairness.
 * Player commits hash(seed:choice), then reveals after opponent commits.
 */

import { BaseGameModule } from './base';
import type { GameMode, GameChoice, GameResult } from './types';

const RPS_CHOICES: GameChoice[] = [
    { id: 'rock', label: 'Rock', icon: '🪨', shortcut: 'r' },
    { id: 'paper', label: 'Paper', icon: '📄', shortcut: 'p' },
    { id: 'scissors', label: 'Scissors', icon: '✂️', shortcut: 's' },
];

/**
 * Determine RPS winner.
 * Returns: 1 if a wins, -1 if b wins, 0 for draw
 */
function rpsCompare(a: string, b: string): number {
    if (a === b) return 0;

    const wins: Record<string, string> = {
        rock: 'scissors',
        paper: 'rock',
        scissors: 'paper',
    };

    return wins[a] === b ? 1 : -1;
}

export class RPSGame extends BaseGameModule {
    readonly id: GameMode = 'rps';
    readonly name = 'Rock Paper Scissors';
    readonly description = 'Classic RPS with cryptographic fairness';

    private selectedChoice: string | null = null;

    getChoices(): GameChoice[] {
        return RPS_CHOICES;
    }

    /**
     * Determine winner based on RPS rules.
     * For v1, we simulate the opponent's choice.
     */
    determineWinner(): GameResult {
        const match = this._state.match;
        const localCommit = this._state.localCommit;

        if (!match || !localCommit) {
            throw new Error('Cannot determine winner: missing data');
        }

        const localChoice = localCommit.choice;

        // For v1, simulate opponent choice
        // In production, this comes from server after both reveal
        const choices = ['rock', 'paper', 'scissors'];
        const opponentChoice = choices[Math.floor(Math.random() * choices.length)];

        const comparison = rpsCompare(localChoice, opponentChoice);

        let outcome: 'win' | 'lose' | 'draw';
        let winnerId: string | null;

        if (comparison === 1) {
            outcome = 'win';
            winnerId = match.players.A.id;
        } else if (comparison === -1) {
            outcome = 'lose';
            winnerId = match.players.B.id;
        } else {
            outcome = 'draw';
            winnerId = null;
        }

        return {
            outcome,
            localChoice,
            opponentChoice,
            winnerId,
        };
    }

    reset(): void {
        this.selectedChoice = null;
        super.reset();
    }

    protected renderUI(): void {
        if (!this.container) return;

        this.injectStyles();
        this.injectRPSStyles();

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
            <div class="th-game th-rps">
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

    private injectRPSStyles(): void {
        if (!this.container) return;

        const styleId = 'th-rps-styles';
        if (document.getElementById(styleId)) return;

        const style = document.createElement('style');
        style.id = styleId;
        style.textContent = `
            .th-rps-versus {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 2rem;
                margin-bottom: 1rem;
            }
            .th-rps-hand {
                font-size: 3rem;
                transition: transform 0.3s ease;
            }
            .th-rps-hand.shake {
                animation: th-shake-hand 0.5s ease infinite;
            }
            @keyframes th-shake-hand {
                0%, 100% { transform: translateY(0); }
                50% { transform: translateY(-10px); }
            }
            .th-rps-vs {
                font-size: 1.5rem;
                font-weight: bold;
                color: #666;
            }
            .th-game-choice.selected {
                border-color: #6366f1;
                background: #eef2ff;
            }
        `;
        document.head.appendChild(style);
    }

    private renderIdle(): string {
        return `
            <div class="th-rps-versus">
                <div class="th-rps-hand">✊</div>
                <div class="th-rps-vs">VS</div>
                <div class="th-rps-hand">✊</div>
            </div>
            <button class="th-game-btn" data-action="start">
                Start Game
            </button>
        `;
    }

    private renderCommitting(): string {
        const choicesHtml = RPS_CHOICES.map(choice => `
            <button class="th-game-choice ${this.selectedChoice === choice.id ? 'selected' : ''}"
                    data-choice="${choice.id}">
                <span class="icon">${choice.icon}</span>
                ${choice.label}
            </button>
        `).join('');

        return `
            <p>Choose your move:</p>
            <div class="th-game-choices">
                ${choicesHtml}
            </div>
            <button class="th-game-btn"
                    data-action="commit"
                    ${!this.selectedChoice ? 'disabled' : ''}>
                Lock In Choice
            </button>
        `;
    }

    private renderWaiting(message: string): string {
        const choiceIcon = this.selectedChoice
            ? RPS_CHOICES.find(c => c.id === this.selectedChoice)?.icon || '❓'
            : '❓';

        return `
            <div class="th-rps-versus">
                <div class="th-rps-hand">${choiceIcon}</div>
                <div class="th-rps-vs">VS</div>
                <div class="th-rps-hand shake">❓</div>
            </div>
            <div class="th-game-waiting">
                <div class="th-game-spinner"></div>
                <p>${message}</p>
            </div>
        `;
    }

    private renderRevealing(): string {
        const choiceIcon = this.selectedChoice
            ? RPS_CHOICES.find(c => c.id === this.selectedChoice)?.icon || '❓'
            : '❓';

        return `
            <div class="th-rps-versus">
                <div class="th-rps-hand th-game-shake">${choiceIcon}</div>
                <div class="th-rps-vs">VS</div>
                <div class="th-rps-hand th-game-shake">❓</div>
            </div>
            <p>Revealing choices...</p>
        `;
    }

    private renderResult(result: GameResult): string {
        const localIcon = RPS_CHOICES.find(c => c.id === result.localChoice)?.icon || '❓';
        const opponentIcon = RPS_CHOICES.find(c => c.id === result.opponentChoice)?.icon || '❓';

        const resultClass = result.outcome;
        const resultText = result.outcome === 'win' ? 'You Win!'
            : result.outcome === 'lose' ? 'You Lose'
            : "It's a Draw!";

        return `
            <div class="th-rps-versus">
                <div class="th-rps-hand th-game-bounce">${localIcon}</div>
                <div class="th-rps-vs">VS</div>
                <div class="th-rps-hand th-game-bounce">${opponentIcon}</div>
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

        // Choice selection
        const choiceBtns = this.container.querySelectorAll('[data-choice]');
        choiceBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const target = e.currentTarget as HTMLElement;
                this.selectedChoice = target.dataset.choice || null;
                this.renderUI();
            });
        });

        // Commit choice
        const commitBtn = this.container.querySelector('[data-action="commit"]');
        commitBtn?.addEventListener('click', async () => {
            if (this.selectedChoice) {
                await this.submitChoice(this.selectedChoice);
                // Auto-reveal for v1 (simulated opponent)
                setTimeout(() => this.reveal(), 1500);
            }
        });

        // Reset
        const resetBtn = this.container.querySelector('[data-action="reset"]');
        resetBtn?.addEventListener('click', () => this.reset());

        // Keyboard shortcuts
        document.addEventListener('keydown', this.handleKeydown.bind(this));
    }

    private handleKeydown(e: KeyboardEvent): void {
        if (this._state.phase !== 'committing') return;

        const choice = RPS_CHOICES.find(c => c.shortcut === e.key.toLowerCase());
        if (choice) {
            this.selectedChoice = choice.id;
            this.renderUI();
        }
    }
}

/**
 * Create a new RPS game instance.
 */
export function createRPSGame(): RPSGame {
    return new RPSGame();
}
