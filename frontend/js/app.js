/**
 * TattleHash Frontend Application
 *
 * Shared JavaScript utilities and API functions
 */

// ============================================================================
// Configuration
// ============================================================================

const API_BASE = 'https://tattlehash-worker.ashiscock.workers.dev';

// ============================================================================
// Authentication Helpers
// ============================================================================

/**
 * Get the stored authentication token
 */
function getToken() {
    return localStorage.getItem('token');
}

/**
 * Get the stored user object
 */
function getUser() {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
}

/**
 * Check if user is authenticated
 */
function isAuthenticated() {
    return !!getToken();
}

/**
 * Clear authentication data and redirect to login
 */
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = 'login.html';
}

// ============================================================================
// API Request Helpers
// ============================================================================

/**
 * Make an authenticated API request
 */
async function fetchWithAuth(endpoint, options = {}) {
    const token = getToken();

    const defaultHeaders = {
        'Content-Type': 'application/json',
    };

    if (token) {
        defaultHeaders['Authorization'] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers: {
            ...defaultHeaders,
            ...options.headers,
        },
    });

    // Handle 401 - redirect to login
    if (response.status === 401) {
        logout();
        throw new Error('Session expired');
    }

    const data = await response.json();

    if (!response.ok) {
        throw new Error(data.message || `API error: ${response.status}`);
    }

    return data;
}

/**
 * POST request helper
 */
async function postWithAuth(endpoint, body) {
    return fetchWithAuth(endpoint, {
        method: 'POST',
        body: JSON.stringify(body),
    });
}

/**
 * PUT request helper
 */
async function putWithAuth(endpoint, body) {
    return fetchWithAuth(endpoint, {
        method: 'PUT',
        body: JSON.stringify(body),
    });
}

/**
 * DELETE request helper
 */
async function deleteWithAuth(endpoint) {
    return fetchWithAuth(endpoint, {
        method: 'DELETE',
    });
}

// ============================================================================
// Toast Notifications
// ============================================================================

/**
 * Show a toast notification
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) {
        console.warn('Toast container not found');
        return;
    }

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ',
    };

    toast.innerHTML = `
        <span style="font-size: 1.25rem;">${icons[type] || icons.info}</span>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Auto remove after 4 seconds
    setTimeout(() => {
        toast.style.animation = 'slide-in 0.3s ease-out reverse';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ============================================================================
// Formatting Helpers
// ============================================================================

/**
 * Format a date string
 */
function formatDate(dateString) {
    if (!dateString) return '--';

    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Relative time for recent dates
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    // Full date for older dates
    return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}

/**
 * Format a currency amount
 */
function formatCurrency(amount, currency = 'USD') {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency,
    }).format(amount);
}

/**
 * Truncate a wallet address
 */
function truncateAddress(address) {
    if (!address) return '--';
    if (address.length <= 12) return address;
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Truncate a hash
 */
function truncateHash(hash, startLen = 8, endLen = 6) {
    if (!hash) return '--';
    if (hash.length <= startLen + endLen + 3) return hash;
    return `${hash.slice(0, startLen)}...${hash.slice(-endLen)}`;
}

/**
 * Format a number with commas
 */
function formatNumber(num) {
    if (num === null || num === undefined) return '--';
    return num.toLocaleString();
}

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate email format
 */
function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

/**
 * Validate Ethereum address
 */
function isValidEthAddress(address) {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Validate password strength
 */
function isValidPassword(password) {
    return password && password.length >= 8;
}

// ============================================================================
// Clipboard Helpers
// ============================================================================

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text) {
    try {
        await navigator.clipboard.writeText(text);
        showToast('Copied to clipboard', 'success');
        return true;
    } catch (err) {
        console.error('Failed to copy:', err);
        showToast('Failed to copy', 'error');
        return false;
    }
}

// ============================================================================
// DOM Helpers
// ============================================================================

/**
 * Show an element
 */
function show(element) {
    if (typeof element === 'string') {
        element = document.getElementById(element);
    }
    if (element) {
        element.classList.remove('hidden');
    }
}

/**
 * Hide an element
 */
function hide(element) {
    if (typeof element === 'string') {
        element = document.getElementById(element);
    }
    if (element) {
        element.classList.add('hidden');
    }
}

/**
 * Toggle element visibility
 */
function toggle(element) {
    if (typeof element === 'string') {
        element = document.getElementById(element);
    }
    if (element) {
        element.classList.toggle('hidden');
    }
}

/**
 * Set loading state on a button
 */
function setButtonLoading(button, loading, originalText) {
    if (typeof button === 'string') {
        button = document.getElementById(button);
    }
    if (!button) return;

    if (loading) {
        button.disabled = true;
        button.dataset.originalText = button.textContent;
        button.textContent = 'Loading...';
    } else {
        button.disabled = false;
        button.textContent = originalText || button.dataset.originalText || 'Submit';
    }
}

// ============================================================================
// Web3 Helpers
// ============================================================================

/**
 * Check if MetaMask is installed
 */
function isMetaMaskInstalled() {
    return typeof window.ethereum !== 'undefined';
}

/**
 * Request account access from MetaMask
 */
async function connectMetaMask() {
    if (!isMetaMaskInstalled()) {
        throw new Error('MetaMask is not installed');
    }

    try {
        const accounts = await window.ethereum.request({
            method: 'eth_requestAccounts',
        });
        return accounts[0];
    } catch (error) {
        throw new Error('Failed to connect MetaMask');
    }
}

/**
 * Get current network ID
 */
async function getNetworkId() {
    if (!isMetaMaskInstalled()) return null;

    try {
        const chainId = await window.ethereum.request({
            method: 'eth_chainId',
        });
        return parseInt(chainId, 16);
    } catch {
        return null;
    }
}

/**
 * Switch to Polygon network
 */
async function switchToPolygon() {
    if (!isMetaMaskInstalled()) {
        throw new Error('MetaMask is not installed');
    }

    try {
        await window.ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x89' }], // Polygon Mainnet
        });
    } catch (switchError) {
        // This error code indicates that the chain has not been added to MetaMask
        if (switchError.code === 4902) {
            await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                    chainId: '0x89',
                    chainName: 'Polygon Mainnet',
                    nativeCurrency: {
                        name: 'MATIC',
                        symbol: 'MATIC',
                        decimals: 18,
                    },
                    rpcUrls: ['https://polygon-rpc.com/'],
                    blockExplorerUrls: ['https://polygonscan.com/'],
                }],
            });
        } else {
            throw switchError;
        }
    }
}

// ============================================================================
// URL Helpers
// ============================================================================

/**
 * Get URL parameter by name
 */
function getUrlParam(name) {
    const params = new URLSearchParams(window.location.search);
    return params.get(name);
}

/**
 * Update URL parameter without page reload
 */
function setUrlParam(name, value) {
    const url = new URL(window.location);
    if (value) {
        url.searchParams.set(name, value);
    } else {
        url.searchParams.delete(name);
    }
    window.history.replaceState({}, '', url);
}

// ============================================================================
// Local Storage Helpers
// ============================================================================

/**
 * Get item from localStorage with JSON parsing
 */
function getStorageItem(key, defaultValue = null) {
    try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
    } catch {
        return defaultValue;
    }
}

/**
 * Set item in localStorage with JSON stringification
 */
function setStorageItem(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
    } catch {
        return false;
    }
}

/**
 * Remove item from localStorage
 */
function removeStorageItem(key) {
    localStorage.removeItem(key);
}

// ============================================================================
// Debounce/Throttle
// ============================================================================

/**
 * Debounce function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

/**
 * Throttle function
 */
function throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}

// ============================================================================
// Initialization
// ============================================================================

// Log app initialization
console.log('%cTattleHash', 'color: #00d4ff; font-size: 24px; font-weight: bold;');
console.log('%cImmutable Evidence for the Digital Age', 'color: #a0a0a0; font-size: 12px;');
