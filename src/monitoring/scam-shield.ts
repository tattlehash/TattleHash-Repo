/**
 * Scam Shield - URL Analysis Module
 *
 * Analyzes URLs for phishing, malware, and scam indicators.
 * Implements pattern matching and optional external threat DB integration.
 */

import { execute, query, queryOne } from '../db';
import { Env } from '../types';
import type { LlmUrlScan, LlmThreatType, LlmUrlScanStatus } from '../db/types';
import { ScanUrlInput, MONITORING_DEFAULTS } from './types';

// ============================================================================
// Types
// ============================================================================

export interface UrlScanResult {
    url: string;
    domain: string;
    status: LlmUrlScanStatus;
    threat_type?: LlmThreatType;
    threat_score: number;
    indicators: UrlIndicator[];
    cached: boolean;
    scan_sources: string[];
}

export interface UrlIndicator {
    type: 'LOOKALIKE' | 'SUSPICIOUS_TLD' | 'RECENTLY_REGISTERED' | 'IP_ADDRESS' | 'SHORTENED' | 'PATTERN_MATCH';
    severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH';
    description: string;
    evidence?: string;
}

// ============================================================================
// Known Patterns
// ============================================================================

// Legitimate domains that are commonly impersonated
const LEGITIMATE_DOMAINS = [
    'paypal.com',
    'google.com',
    'facebook.com',
    'amazon.com',
    'apple.com',
    'microsoft.com',
    'coinbase.com',
    'binance.com',
    'kraken.com',
    'blockchain.com',
    'metamask.io',
    'ledger.com',
    'trezor.io',
    'opensea.io',
    'uniswap.org',
    'aave.com',
    'compound.finance',
    'escrow.com',
    'payoneer.com',
    'wise.com',
    'venmo.com',
    'zelle.com',
    'cashapp.com',
];

// Suspicious TLDs often used in scams
const SUSPICIOUS_TLDS = [
    '.xyz',
    '.top',
    '.club',
    '.work',
    '.click',
    '.link',
    '.info',
    '.biz',
    '.online',
    '.site',
    '.website',
    '.space',
    '.pw',
    '.tk',
    '.ml',
    '.ga',
    '.cf',
    '.gq',
];

// Known URL shorteners
const URL_SHORTENERS = [
    'bit.ly',
    'tinyurl.com',
    't.co',
    'goo.gl',
    'ow.ly',
    'is.gd',
    'buff.ly',
    'rebrand.ly',
    'short.io',
    'cutt.ly',
];

// Suspicious keywords in URLs
const SUSPICIOUS_KEYWORDS = [
    'verify',
    'secure',
    'update',
    'confirm',
    'account',
    'login',
    'signin',
    'wallet',
    'connect',
    'claim',
    'airdrop',
    'giveaway',
    'free',
    'bonus',
    'withdraw',
    'suspend',
    'locked',
    'urgent',
    'immediate',
];

// ============================================================================
// URL Scanning
// ============================================================================

/**
 * Scan a URL for threats
 */
export async function scanUrl(
    env: Env,
    input: ScanUrlInput
): Promise<UrlScanResult> {
    // Normalize URL
    const normalized = normalizeUrl(input.url);
    const domain = extractDomain(normalized);

    // Check cache
    const cached = await getCachedScan(env, normalized);
    if (cached) {
        return {
            url: input.url,
            domain,
            status: cached.status as LlmUrlScanStatus,
            threat_type: cached.threat_type as LlmThreatType | undefined,
            threat_score: cached.threat_score ?? 0,
            indicators: [],
            cached: true,
            scan_sources: cached.scan_sources ? JSON.parse(cached.scan_sources) : [],
        };
    }

    // Perform analysis
    const indicators = analyzeUrl(input.url, domain);

    // Calculate threat score
    const { threatScore, status, threatType } = calculateThreat(indicators);

    // Store result
    const scanId = crypto.randomUUID();
    const now = Date.now();

    await execute(
        env.TATTLEHASH_DB,
        `INSERT INTO llm_url_scans (
            id, url, domain, normalized_url, source_analysis_id,
            found_in_target_type, found_in_target_id, status,
            threat_type, threat_score, scan_sources, raw_results,
            first_seen_at, last_scanned_at, scan_count
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
            scanId,
            input.url,
            domain,
            normalized,
            input.context?.analysis_id ?? null,
            input.context?.target_type ?? null,
            input.context?.target_id ?? null,
            status,
            threatType ?? null,
            threatScore,
            JSON.stringify(['pattern_analysis']),
            JSON.stringify({ indicators }),
            now,
            now,
        ]
    );

    console.log(JSON.stringify({
        t: now,
        at: 'url_scanned',
        domain,
        status,
        threat_score: threatScore,
        indicators_count: indicators.length,
    }));

    return {
        url: input.url,
        domain,
        status,
        threat_type: threatType,
        threat_score: threatScore,
        indicators,
        cached: false,
        scan_sources: ['pattern_analysis'],
    };
}

/**
 * Batch scan multiple URLs
 */
export async function scanUrls(
    env: Env,
    urls: string[],
    context?: ScanUrlInput['context']
): Promise<UrlScanResult[]> {
    const results: UrlScanResult[] = [];

    for (const url of urls) {
        try {
            const result = await scanUrl(env, { url, context });
            results.push(result);
        } catch (error: any) {
            console.error(`Error scanning URL ${url}:`, error);
            results.push({
                url,
                domain: extractDomain(url),
                status: 'ERROR',
                threat_score: 0,
                indicators: [],
                cached: false,
                scan_sources: [],
            });
        }
    }

    return results;
}

/**
 * Extract URLs from text content
 */
export function extractUrls(text: string): string[] {
    const urlPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;
    const matches = text.match(urlPattern) || [];
    return [...new Set(matches)]; // Deduplicate
}

// ============================================================================
// Analysis Functions
// ============================================================================

/**
 * Analyze URL for suspicious indicators
 */
function analyzeUrl(url: string, domain: string): UrlIndicator[] {
    const indicators: UrlIndicator[] = [];

    // Check for IP address instead of domain
    if (isIpAddress(domain)) {
        indicators.push({
            type: 'IP_ADDRESS',
            severity: 'HIGH',
            description: 'URL uses IP address instead of domain name',
            evidence: domain,
        });
    }

    // Check for URL shortener
    if (isUrlShortener(domain)) {
        indicators.push({
            type: 'SHORTENED',
            severity: 'MEDIUM',
            description: 'URL uses shortening service which hides actual destination',
            evidence: domain,
        });
    }

    // Check for lookalike domains
    const lookalike = detectLookalike(domain);
    if (lookalike) {
        indicators.push({
            type: 'LOOKALIKE',
            severity: 'HIGH',
            description: `Domain appears to impersonate ${lookalike.legitimate}`,
            evidence: `"${domain}" looks like "${lookalike.legitimate}" (${lookalike.technique})`,
        });
    }

    // Check for suspicious TLD
    if (hasSuspiciousTld(domain)) {
        indicators.push({
            type: 'SUSPICIOUS_TLD',
            severity: 'MEDIUM',
            description: 'Domain uses TLD commonly associated with spam/scams',
            evidence: domain.substring(domain.lastIndexOf('.')),
        });
    }

    // Check for suspicious keywords in path
    const suspiciousKeywords = findSuspiciousKeywords(url);
    if (suspiciousKeywords.length > 0) {
        indicators.push({
            type: 'PATTERN_MATCH',
            severity: suspiciousKeywords.length > 2 ? 'HIGH' : 'MEDIUM',
            description: 'URL contains suspicious keywords',
            evidence: suspiciousKeywords.join(', '),
        });
    }

    // Check for excessive subdomains
    const subdomainCount = countSubdomains(domain);
    if (subdomainCount > 3) {
        indicators.push({
            type: 'PATTERN_MATCH',
            severity: 'LOW',
            description: 'URL has unusual number of subdomains',
            evidence: `${subdomainCount} subdomain levels`,
        });
    }

    return indicators;
}

/**
 * Detect lookalike domains
 */
function detectLookalike(domain: string): { legitimate: string; technique: string } | null {
    const normalizedDomain = domain.toLowerCase();

    for (const legitimate of LEGITIMATE_DOMAINS) {
        const normalizedLegitimate = legitimate.toLowerCase();

        // Check for character substitution (homoglyphs)
        if (isHomoglyphMatch(normalizedDomain, normalizedLegitimate)) {
            return { legitimate, technique: 'character substitution' };
        }

        // Check for typosquatting
        if (isTyposquat(normalizedDomain, normalizedLegitimate)) {
            return { legitimate, technique: 'typosquatting' };
        }

        // Check for prefix/suffix additions
        if (hasSuspiciousAffix(normalizedDomain, normalizedLegitimate)) {
            return { legitimate, technique: 'suspicious prefix/suffix' };
        }
    }

    return null;
}

/**
 * Check for homoglyph character substitution
 */
function isHomoglyphMatch(domain: string, legitimate: string): boolean {
    // Common homoglyph substitutions
    const homoglyphs: Record<string, string[]> = {
        'a': ['4', '@', 'а'], // last is Cyrillic
        'e': ['3', 'е'], // last is Cyrillic
        'i': ['1', 'l', '!', 'і'], // last is Cyrillic
        'o': ['0', 'о'], // last is Cyrillic
        'l': ['1', 'I', '|'],
        's': ['5', '$'],
        'g': ['9', 'q'],
        'b': ['8', '6'],
    };

    // Normalize domain by replacing homoglyphs
    let normalized = domain;
    for (const [char, replacements] of Object.entries(homoglyphs)) {
        for (const replacement of replacements) {
            normalized = normalized.replace(new RegExp(replacement, 'g'), char);
        }
    }

    // Check if normalized matches legitimate (without TLD)
    const legitimateBase = legitimate.replace(/\.[^.]+$/, '');
    const domainBase = normalized.replace(/\.[^.]+$/, '');

    return domainBase === legitimateBase && domain !== legitimate;
}

/**
 * Check for typosquatting
 */
function isTyposquat(domain: string, legitimate: string): boolean {
    const domainBase = domain.replace(/\.[^.]+$/, '');
    const legitimateBase = legitimate.replace(/\.[^.]+$/, '');

    // Calculate Levenshtein distance
    const distance = levenshteinDistance(domainBase, legitimateBase);

    // If very similar but not exact, likely typosquat
    return distance > 0 && distance <= 2 && domainBase.length >= 4;
}

/**
 * Check for suspicious prefix/suffix
 */
function hasSuspiciousAffix(domain: string, legitimate: string): boolean {
    const legitimateBase = legitimate.replace(/\.[^.]+$/, '');
    const domainBase = domain.replace(/\.[^.]+$/, '');

    const suspiciousAffixes = [
        'secure-', 'login-', 'verify-', 'update-', 'account-',
        '-secure', '-login', '-verify', '-support', '-help',
        'real', 'official', 'original', 'true', 'actual',
    ];

    // Check if domain contains legitimate name with suspicious affixes
    for (const affix of suspiciousAffixes) {
        if (domainBase === `${affix}${legitimateBase}` ||
            domainBase === `${legitimateBase}${affix}` ||
            domainBase.includes(`${affix}${legitimateBase}`) ||
            domainBase.includes(`${legitimateBase}${affix}`)) {
            return true;
        }
    }

    return false;
}

/**
 * Calculate threat score and status
 */
function calculateThreat(indicators: UrlIndicator[]): {
    threatScore: number;
    status: LlmUrlScanStatus;
    threatType?: LlmThreatType;
} {
    if (indicators.length === 0) {
        return { threatScore: 0, status: 'CLEAN' };
    }

    // Calculate score based on indicator severities
    const severityWeights: Record<string, number> = {
        HIGH: 30,
        MEDIUM: 15,
        LOW: 5,
        INFO: 2,
    };

    let score = indicators.reduce((sum, ind) =>
        sum + (severityWeights[ind.severity] ?? 0), 0);

    score = Math.min(100, score);

    // Determine status
    let status: LlmUrlScanStatus;
    let threatType: LlmThreatType | undefined;

    if (score >= 60) {
        status = 'MALICIOUS';
        threatType = indicators.some(i => i.type === 'LOOKALIKE') ? 'PHISHING' : 'SCAM';
    } else if (score >= 30) {
        status = 'SUSPICIOUS';
        threatType = 'UNKNOWN';
    } else {
        status = 'CLEAN';
    }

    return { threatScore: score, status, threatType };
}

// ============================================================================
// Utility Functions
// ============================================================================

function normalizeUrl(url: string): string {
    try {
        const parsed = new URL(url);
        // Remove trailing slashes, lowercase hostname
        return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`;
    } catch {
        return url.toLowerCase();
    }
}

function extractDomain(url: string): string {
    try {
        const parsed = new URL(url);
        return parsed.hostname.toLowerCase();
    } catch {
        // Fallback: extract domain from string
        const match = url.match(/(?:https?:\/\/)?([^\/\s]+)/);
        return match ? match[1].toLowerCase() : url;
    }
}

function isIpAddress(domain: string): boolean {
    const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern = /^\[?([a-fA-F0-9:]+)\]?$/;
    return ipv4Pattern.test(domain) || ipv6Pattern.test(domain);
}

function isUrlShortener(domain: string): boolean {
    return URL_SHORTENERS.some(shortener =>
        domain === shortener || domain.endsWith('.' + shortener)
    );
}

function hasSuspiciousTld(domain: string): boolean {
    return SUSPICIOUS_TLDS.some(tld => domain.endsWith(tld));
}

function findSuspiciousKeywords(url: string): string[] {
    const lowerUrl = url.toLowerCase();
    return SUSPICIOUS_KEYWORDS.filter(keyword => lowerUrl.includes(keyword));
}

function countSubdomains(domain: string): number {
    return domain.split('.').length - 2;
}

function levenshteinDistance(a: string, b: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }

    return matrix[b.length][a.length];
}

async function getCachedScan(env: Env, normalizedUrl: string): Promise<LlmUrlScan | null> {
    return queryOne<LlmUrlScan>(
        env.TATTLEHASH_DB,
        `SELECT * FROM llm_url_scans
         WHERE normalized_url = ?
         AND last_scanned_at > ?
         ORDER BY last_scanned_at DESC
         LIMIT 1`,
        [normalizedUrl, Date.now() - MONITORING_DEFAULTS.URL_SCAN_CACHE_TTL_MS]
    );
}
