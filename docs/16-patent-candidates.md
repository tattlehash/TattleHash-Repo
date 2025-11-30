# Patent Candidates

> Lightweight capture log for potential CIP (Continuation-In-Part) claims.  
> Add one-liners during build. Expand into full analysis post-build.  
> **CIP Deadline:** October 2026 (12 months from PPA filing)

---

## Existing PPA Coverage (October 2025)

Your TraceAI PPA already covers these 42 claims:

| Claim Group | Claims | Core Innovation |
|-------------|--------|-----------------|
| Hash-Chained Ledgers | 1-12 | I → C → FINAL commitment chain |
| Geo-Aware Quorum Selection | 13-22 | Region-aware endpoint selection |
| Error-Semantic Mode Switching | 23-32 | State transitions triggered by error types |
| Verification Threshold Logic | 33-38 | Privacy-preserving balance attestation |
| Intent Binding | 39-42 | Cryptographic binding of intent to outcome |

**Reference:** See `15-traceai-mapping.md` for code locations.

---

## Capture Log (Add During Build)

Format: `YYYY-MM-DD: Brief description (file/function reference)`

### Phase 2: Wallet Verification
```
<!-- Example entries — delete these and add real ones -->
<!-- 2025-12-01: EIP-191 challenge with chain-specific nonce binding (wallet/challenge.ts) -->
```

### Phase 3: Proof-of-Funds
```

```

### Phase 4: Challenge Lifecycle
```

```

### Phase 5: Fire + Enforced Modes
```

```

### Phase 6: Relay System
```

```

### Phase 7: Hardening
```

```

### Unexpected Discoveries
```
<!-- Things that emerged from edge cases, bugs, or "wait, that's clever" moments -->
```

---

## Quick Novelty Check

Before adding an entry, ask:

1. **Is it specific to TattleHash?** (Not just "we use EIP-191")
2. **Does it solve a problem differently than prior art?**
3. **Could a competitor not do this without our insight?**

If yes to all three → add it.

---

## Known CIP Candidates (From Design Phase)

These emerged from our design conversations but aren't in the PPA:

| Candidate | Description | Likely Novel? |
|-----------|-------------|---------------|
| Bidirectional ZKP Verification | Both parties verify simultaneously, neither sees actual balances | ✅ High |
| Mode-Agnostic State Machine | Same transitions handle multiple modes with pluggable verification | ⚠️ Medium |
| Configurable Timeout Cascade | User-defined timeouts with automatic state transitions + refunds | ⚠️ Medium |
| Signed Webhook Relay | HMAC-signed delivery with exponential backoff and dead-letter | ❌ Low (common) |
| Privacy-Preserving Balance Hash | Salt + threshold + timestamp → hash (never expose actual balance) | ✅ High |
| Parallel Verification Runner | Both parties' wallet + funds checks run concurrently with unified pass/fail | ⚠️ Medium |
| Intent Lock with Pre-Verification Gate | Verification must pass BEFORE intent_locked_at timestamp | ✅ High |

---

## Post-Build Analysis Template

After build, expand each candidate into:

```markdown
### [Candidate Name]

**One-liner:** 

**Problem it solves:**

**How prior art handles it:**

**Our approach (what's different):**

**Code location:**

**Reduction to practice date:**

**Recommend for CIP?** Yes / No / Needs more research
```

---

## Filing Timeline

| Date | Action |
|------|--------|
| Oct 2025 | PPA filed (42 claims) |
| Dec 2025 - Feb 2026 | Build Phases 1-4 (capture candidates) |
| Mar 2026 | Build complete, expand analysis |
| Apr-May 2026 | Review with patent counsel |
| Jun-Jul 2026 | Draft CIP claims |
| **Aug 2026** | **File CIP** (2 months buffer) |
| Oct 2026 | PPA 12-month deadline |

---

## Notes for Patent Counsel

When you're ready to file CIP, provide:

1. This document (expanded)
2. `15-traceai-mapping.md` (existing claims → code)
3. Git commit history showing implementation dates
4. Test coverage reports as reduction-to-practice evidence
5. Any deployment timestamps from Cloudflare dashboard
