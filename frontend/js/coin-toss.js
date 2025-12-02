/**
 * Coin Toss Animation Component
 *
 * Handles the coin flip animation and result display for Gatekeeper fee-splitting.
 */

class CoinTossAnimation {
    constructor(containerId, options = {}) {
        this.container = document.getElementById(containerId);
        this.options = {
            flipDuration: 2500,      // 2.5 seconds
            bounceDuration: 500,     // 0.5 seconds for bounce
            apiBase: API_BASE || '',
            onComplete: null,
            ...options
        };
        this.state = null;
        this.isCreator = false;
    }

    /**
     * Initialize the coin toss display for a challenge
     */
    async init(challengeId, userId) {
        this.challengeId = challengeId;
        this.userId = userId;

        try {
            const response = await fetch(`${this.options.apiBase}/challenges/${challengeId}/coin-toss`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to load coin toss data');
            }

            this.state = await response.json();
            this.render();
        } catch (error) {
            this.renderError(error.message);
        }
    }

    /**
     * Render based on current state
     */
    render() {
        if (!this.state) return;

        switch (this.state.status) {
            case 'pending':
                this.renderPending();
                break;
            case 'waiting_counterparty':
                this.renderWaiting();
                break;
            case 'ready':
                this.renderReady();
                break;
            case 'flipped':
                this.renderResult();
                break;
            default:
                this.renderError('Unknown coin toss status');
        }
    }

    /**
     * Render waiting for counterparty state
     */
    renderPending() {
        this.container.innerHTML = `
            <div class="coin-toss-modal">
                <div class="coin-toss-content">
                    <div class="coin-pending">
                        <div class="coin-icon-large">
                            <div class="coin ${this.state.creator_call}"></div>
                        </div>
                        <h2 class="coin-toss-title">Coin Toss Pending</h2>
                        <p class="coin-toss-subtitle">You called: <strong>${this.state.creator_call.toUpperCase()}</strong></p>
                        <p class="coin-toss-message">Waiting for counterparty to accept...</p>
                        <div class="coin-toss-info">
                            <p>When they accept, the coin will be flipped using blockchain randomness.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render waiting state (creator view)
     */
    renderWaiting() {
        this.container.innerHTML = `
            <div class="coin-toss-modal">
                <div class="coin-toss-content">
                    <div class="coin-waiting">
                        <div class="coin-icon-large pulse">
                            <div class="coin ${this.state.creator_call}"></div>
                        </div>
                        <h2 class="coin-toss-title">Waiting for Counterparty</h2>
                        <p class="coin-toss-subtitle">You called: <strong>${this.state.creator_call.toUpperCase()}</strong></p>
                        <p class="coin-toss-message">Your counterparty gets: <strong>${this.state.counterparty_call.toUpperCase()}</strong></p>
                        <div class="coin-toss-info">
                            <p>The flip will happen when they accept the attestation.</p>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render ready state - trigger flip animation
     */
    renderReady() {
        this.container.innerHTML = `
            <div class="coin-toss-modal">
                <div class="coin-toss-content">
                    <div class="coin-flip-container" id="flip-container">
                        <div class="coin-flipping" id="flipping-coin">
                            <div class="coin heads front"></div>
                            <div class="coin tails back"></div>
                        </div>
                        <p class="flip-status" id="flip-status">Flipping...</p>
                    </div>
                </div>
            </div>
        `;

        // Start the flip animation
        this.startFlipAnimation();
    }

    /**
     * Start the coin flip animation
     */
    startFlipAnimation() {
        const coin = document.getElementById('flipping-coin');
        const status = document.getElementById('flip-status');

        // Add animation class
        coin.classList.add('animate');

        // After flip completes, show result
        setTimeout(() => {
            status.textContent = 'Landing...';
        }, this.options.flipDuration - 500);

        setTimeout(() => {
            // Poll for result
            this.pollForResult();
        }, this.options.flipDuration);
    }

    /**
     * Poll for the coin toss result
     */
    async pollForResult() {
        try {
            const response = await fetch(`${this.options.apiBase}/challenges/${this.challengeId}/coin-toss`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to get result');
            }

            this.state = await response.json();

            if (this.state.status === 'flipped') {
                this.renderResult();
            } else {
                // Keep polling
                setTimeout(() => this.pollForResult(), 1000);
            }
        } catch (error) {
            this.renderError(error.message);
        }
    }

    /**
     * Render the result with sponsor framing
     */
    renderResult() {
        const isSponsor = this.state.sponsor === (this.isCreator ? 'creator' : 'counterparty');
        const resultClass = isSponsor ? 'sponsor' : 'sponsored';
        const feeFormatted = `$${(this.state.fee_amount_cents / 100).toFixed(2)}`;

        const resultHtml = isSponsor ? `
            <div class="coin-result ${resultClass}">
                <div class="result-coin">
                    <div class="coin ${this.state.result} large bounce"></div>
                </div>
                <div class="result-badge">${this.state.result.toUpperCase()}</div>
                <h2 class="result-title">You're Sponsoring This Attestation</h2>
                <p class="result-message">Your call was ${this.isCreator ? this.state.creator_call : this.state.counterparty_call}. The flip landed on ${this.state.result}.</p>
                <p class="result-amount">Amount charged: ${feeFormatted}</p>
                <div class="result-verification">
                    <p class="verification-label">Provably Fair</p>
                    <p class="verification-hash">Block #${this.state.block_number}</p>
                    <a href="${this.state.verification_url}" target="_blank" class="btn btn-ghost btn-sm">Verify Result</a>
                </div>
                ${this.renderShareButtons(true)}
            </div>
        ` : `
            <div class="coin-result ${resultClass}">
                <div class="result-coin">
                    <div class="coin ${this.state.result} large bounce"></div>
                </div>
                <div class="result-badge">${this.state.result.toUpperCase()}</div>
                <h2 class="result-title">Sponsored by Your Counterparty</h2>
                <p class="result-message">Your call was ${this.isCreator ? this.state.creator_call : this.state.counterparty_call}. The flip landed on ${this.state.result}.</p>
                <p class="result-amount sponsored-amount">Your fee: $0.00</p>
                <div class="result-verification">
                    <p class="verification-label">Provably Fair</p>
                    <p class="verification-hash">Block #${this.state.block_number}</p>
                    <a href="${this.state.verification_url}" target="_blank" class="btn btn-ghost btn-sm">Verify Result</a>
                </div>
                ${this.renderShareButtons(false)}
            </div>
        `;

        this.container.innerHTML = `
            <div class="coin-toss-modal">
                <div class="coin-toss-content">
                    ${resultHtml}
                </div>
            </div>
        `;

        // Add bounce animation to coin
        setTimeout(() => {
            const coin = this.container.querySelector('.coin.large');
            if (coin) coin.classList.add('bounce');
        }, 100);

        // Callback
        if (this.options.onComplete) {
            this.options.onComplete(this.state);
        }
    }

    /**
     * Render share buttons
     */
    renderShareButtons(isSponsor) {
        if (!this.state.share) return '';

        const shareData = isSponsor ? this.state.share.sponsor_share : this.state.share.sponsored_share;
        const tweetText = encodeURIComponent(shareData.text);
        const tweetUrl = encodeURIComponent(shareData.url);
        const copyText = `${shareData.text} ${shareData.url}`.replace(/'/g, "\\'");

        return `
            <div class="share-buttons">
                <p class="share-label">Share Result</p>
                <div class="share-btn-group">
                    <a href="https://twitter.com/intent/tweet?text=${tweetText}&url=${tweetUrl}"
                       target="_blank"
                       class="btn btn-ghost btn-sm share-btn">
                        Share on X
                    </a>
                    <button onclick="navigator.clipboard.writeText('${copyText}').then(() => showToast('Link copied!', 'success'))"
                            class="btn btn-ghost btn-sm share-btn">
                        Copy Link
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Render error state
     */
    renderError(message) {
        this.container.innerHTML = `
            <div class="coin-toss-modal">
                <div class="coin-toss-content">
                    <div class="coin-error">
                        <div class="error-icon">!</div>
                        <h2 class="error-title">Error</h2>
                        <p class="error-message">${message}</p>
                        <button onclick="location.reload()" class="btn btn-primary">Try Again</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Set whether the current user is the creator
     */
    setIsCreator(isCreator) {
        this.isCreator = isCreator;
    }

    /**
     * Trigger the flip animation manually (for demo/testing)
     */
    async triggerFlip() {
        this.renderReady();
    }

    /**
     * Show result directly (skip animation)
     */
    showResult(resultData) {
        this.state = resultData;
        this.renderResult();
    }
}

/**
 * Create a modal overlay for the coin toss
 */
function showCoinTossModal(challengeId, userId, isCreator = true) {
    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.id = 'coin-toss-overlay';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
        <div class="modal-backdrop" onclick="closeCoinTossModal()"></div>
        <div id="coin-toss-container" class="modal-container"></div>
    `;
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    // Initialize coin toss animation
    const coinToss = new CoinTossAnimation('coin-toss-container', {
        onComplete: (result) => {
            console.log('Coin toss complete:', result);
        }
    });
    coinToss.setIsCreator(isCreator);
    coinToss.init(challengeId, userId);

    return coinToss;
}

/**
 * Close the coin toss modal
 */
function closeCoinTossModal() {
    const overlay = document.getElementById('coin-toss-overlay');
    if (overlay) {
        overlay.remove();
        document.body.style.overflow = '';
    }
}

// Export for use in other scripts
if (typeof window !== 'undefined') {
    window.CoinTossAnimation = CoinTossAnimation;
    window.showCoinTossModal = showCoinTossModal;
    window.closeCoinTossModal = closeCoinTossModal;
}
