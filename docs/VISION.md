# TattleHash — Vision & Strategy Document

> **Purpose:** This document captures the complete vision for TattleHash. Any AI assistant or developer working on this codebase should read this first to understand the *why* behind every feature.
>
> **Owner:** Tony Hiscock (ashiscock@gmail.com)
> **Status:** Patent-pending (provisional application filed, 42 claims)

---

## 1. Mission

**TattleHash creates verifiable trust between strangers.**

We provide cryptographic attestation infrastructure that generates immutable, court-admissible evidence of what actually happened in peer-to-peer transactions. When disputes arise, TattleHash receipts answer the question: *"What really happened?"*

### Core Problems We Solve

| Problem | TattleHash Solution |
|---------|---------------------|
| P2P fraud (crypto OTC, marketplace scams) | Immutable evidence trails before money moves |
| "He said / she said" disputes | Cryptographic proof of commitments |
| No recourse for small transactions | Affordable attestation ($0.99-$2.99) |
| Trust requires reputation or escrow | Trust via verification, not history |

---

## 2. Market Opportunity

### Total Addressable Market: $19B+

| Segment | Opportunity |
|---------|-------------|
| P2P Marketplaces | Facebook Marketplace, Craigslist, OfferUp fraud prevention |
| Crypto/OTC Trading | Verification for peer-to-peer crypto deals |
| Freelancers/Gig Economy | Contract attestation, milestone verification |
| SME B2B Transactions | Lightweight alternative to escrow |

### Serviceable Obtainable Market: $150-250M

**Target:** $22M data ARR through platform fees + data monetization

### Target Data Buyers

These companies focus on on-chain analysis but lack P2P/OTC transaction data:
- Chainalysis
- Elliptic
- TRM Labs
- CipherTrace
- Nansen

**Our data fills their gap:** Off-chain P2P transaction patterns, fraud typologies, trust scores.

---

## 3. Product Architecture

### Transaction Modes

| Mode | Price | Description | Use Case |
|------|-------|-------------|----------|
| **Solo** | $0.99 | Single-party attestation | "I'm recording this for my records" |
| **Fire** | $1.99 | Fast mutual attestation | Quick P2P deals, both parties sign |
| **Gatekeeper** | $1.99 | Bidirectional verification + LLM monitoring | Higher-value deals needing verification |
| **Enforced** | $2.99 | Full escrow with threshold logic | Maximum protection, conditional release |

### Add-Ons & Tiers

| Product | Price | Description |
|---------|-------|-------------|
| **Pro Tier** | $9.99/mo | Unlimited attestations, priority support |
| **Proof-of-Human** | $0.49 | Humanity verification add-on |

### Gatekeeper Mode — Flagship Feature

Gatekeeper is the core differentiator. It provides:

**Bidirectional ZKP-Style Proofs:**
- Party A commits → generates proof hash (hidden from B)
- Party B commits → generates proof hash (hidden from A)  
- Neither can see other's commitment until both submitted
- Reveal phase verifies integrity
- Prevents front-running and manipulation

**Traffic Light States:**
| State | Meaning | Action |
|-------|---------|--------|
| 🟢 GREEN | Both parties verified, funds confirmed | Safe to proceed |
| 🟡 YELLOW | Partial verification, some flags | Proceed with caution |
| 🔴 RED | Verification failed or threshold not met | Do not proceed |

**LLM Monitoring Modes:**
| Mode | Behavior | Use Case |
|------|----------|----------|
| Exploratory Bot | Asks clarifying questions, surfaces concerns | First-time users, complex deals |
| Balanced Sentinel | Standard monitoring, flags anomalies | Default mode |
| Precision Guard | Strict verification, minimal tolerance | High-value transactions |

**Exact Threshold Logic:**
- Minimum/maximum USD amounts
- Required blockchain confirmations
- Allowed chains and assets
- Time-based expiry

### Gamification — Fee Splitting

When both parties want the other to pay fees, they can play:

| Game | Mechanic |
|------|----------|
| Coin Toss | Fair coin flip (commit-reveal protocol) |
| Rock-Paper-Scissors | Classic RPS with cryptographic fairness |
| Pick a Number | Closest to target wins |

Uses commit-reveal protocol to ensure neither party can cheat.

### Evidence-and-Forward (ENF)

Package evidence and forward to counterparty:
1. Initiator creates evidence bundle
2. System forwards to counterparty (email or wallet)
3. Counterparty signs to acknowledge OR declines
4. Both outcomes are recorded immutably

### Proof-of-Funds (POF)

Verify counterparty has funds before proceeding:
1. Initiator sets minimum USD threshold
2. Counterparty proves wallet ownership (signature challenge)
3. System checks on-chain balance
4. Result attested without revealing exact balance

---

## 4. Technical Architecture

### Infrastructure (Cloudflare Stack)

| Component | Purpose |
|-----------|---------|
| Workers | Edge compute, API endpoints |
| KV | Fast key-value storage for receipts |
| D1 | SQLite database for structured data |
| Durable Objects | Distributed locks, real-time game state |
| Queues | Async job processing |
| Cron | Periodic anchor batching |

### Multi-Chain Support

Attestations can anchor to:
- Ethereum (mainnet)
- Polygon
- BSC (Binance Smart Chain)
- Solana
- Arbitrum
- Optimism
- Base
- Bitcoin (via OP_RETURN or inscription)

### Anchor System

1. Attestations accumulate with `status: "pending"`
2. Cron triggers every 2 minutes
3. `AnchorLock` Durable Object ensures single processor
4. Batch into Merkle tree
5. Submit root hash to blockchain
6. Update attestations with `txHash` and `status: "anchored"`
7. Clients poll for confirmation status

### Dual LLM Agent Architecture

| Agent | Role |
|-------|------|
| Core Transaction Monitor | Real-time analysis of transaction patterns |
| Fraud Pattern Analyzer | Specialized in detecting scam signatures |
| Compliance Auditor | Regulatory flag detection |
| Custom Agents | Plug-and-play extensibility |

### Adaptive LLM Shielding

- **Auto Mode:** Adjusts caution level based on counterparty history
- **Scam Shield:** Scans URLs against threat databases via RAG
- **Risk Scoring:** Numeric score + human-readable flags

### Quantum-Resistant Signatures

For high-value, long-term attestations:
- CRYSTALS-Dilithium (FIPS 204)
- Future-proofing against quantum computing threats

---

## 5. Patent Strategy

### Current Status

- **Provisional Patent Application Filed**
- **42 Claims** covering core attestation mechanics
- **Continuation-in-Part Deadline:** October 2026

### Features to Fold into CIP

Before October 2026, file continuation-in-part covering:
1. Adaptive LLM shielding (Auto Mode, Scam Shield)
2. Gatekeeper bidirectional verification
3. Enforced mode threshold logic
4. Traffic light state machine

### Future PPAs Planned

| Feature | Timeline |
|---------|----------|
| Gamification (fee-splitting games) | 2026 |
| Referral/promo system | 2026 |
| Secure Audit Module (hardware) | 2026-2027 |

### Secure Audit Module (Future Hardware)

Edge device with micro-LLM for offline attestation:
- Backup when connectivity lost
- Applicable to: exchanges, autonomous vehicles, drones, robotics, supply chain
- Air-gapped attestation capability

---

## 6. Data Monetization Strategy

### Global Security Graph

Anonymized, aggregated data products:

| Product | Price | Buyer |
|---------|-------|-------|
| Trust Score API | $0.05-0.15/call | Platforms, exchanges |
| Fraud Typology Reports | $50K-250K/quarter | Chainalysis, law enforcement |
| Real-time Threat Feed | Subscription | Security vendors |

### Data Principles

1. **Privacy First:** Individual transactions anonymized
2. **Aggregate Value:** Patterns, not people
3. **Opt-In Premium:** Users can sell their own data for credits

### Retrievable Data Formats

For disputes and audits, export as:
- JSON (raw data)
- PDF dossiers (human-readable)
- Screenshots (visual evidence)
- IPFS links (decentralized storage)
- QR codes (wallet verification)

All designed to be **court-admissible** in multiple jurisdictions.

---

## 7. Growth Strategy

### Viral Mechanics

| Mechanism | Implementation |
|-----------|----------------|
| Referral Codes | Both parties get discount on first transaction |
| Promo Codes | Time-limited campaigns |
| Network Effects | More users = more trust data = better risk scoring |

### Early Adopter Strategy

1. **Free Beta:** First 1,000 users get free attestations
2. **Feedback Loop:** Direct channel to product decisions
3. **Case Studies:** Document successful dispute resolutions

### Platform Integrations (Future)

- Browser extension for marketplace sites
- Mobile SDKs (iOS/Android)
- Shopify/WooCommerce plugins
- Discord/Telegram bots

---

## 8. Build Priorities

### Priority Order (When in Doubt)

1. **Gatekeeper Mode** — Flagship differentiator
2. **Core Attestation Flow** — Must be rock-solid
3. **Anchor System** — Blockchain immutability
4. **Games** — Viral/engagement feature
5. **ENF** — Notification system
6. **POF** — Nice-to-have verification

### Non-Negotiables

| Principle | Implication |
|-----------|-------------|
| **Court-Admissible** | Never compromise data integrity or chain of custody |
| **Cryptographic Soundness** | Use proven algorithms, no shortcuts |
| **Timestamp Integrity** | Accurate, verifiable timestamps on everything |
| **Audit Trail** | Every state change logged |
| **Privacy by Design** | Minimize data collection, anonymize aggregates |

### API Design Principles

- Consistent JSON envelope: `{ ok: true/false, data/error, timestamp }`
- Machine-readable error codes for client handling
- Human-readable messages for display
- Stateless where possible, explicit state where necessary
- Platform-agnostic (iOS, Android, Web, Desktop all equal citizens)

---

## 9. Competitive Positioning

### What We're NOT

- Not an escrow service (we attest, not hold funds)
- Not a payment processor (we verify, not transfer)
- Not a reputation system (we prove specific events, not general trustworthiness)

### What We ARE

- **Evidence infrastructure** for trust between strangers
- **Verification layer** that sits alongside any transaction method
- **Data platform** that learns from transaction patterns

### Defensibility

1. **Patent Portfolio** — Core mechanics protected
2. **Network Effects** — More data = better risk scoring
3. **Integration Depth** — Embedded in user workflows
4. **Data Moat** — Unique P2P transaction dataset

---

## 10. Success Metrics

### Product Metrics

| Metric | Target |
|--------|--------|
| Attestations/month | 100K by month 12 |
| Dispute resolution rate | >90% resolved via TattleHash evidence |
| User retention (30-day) | >40% |

### Business Metrics

| Metric | Target |
|--------|--------|
| ARR | $22M by year 3 |
| Data revenue % | 30% of total revenue |
| CAC payback | <6 months |

### Technical Metrics

| Metric | Target |
|--------|--------|
| API uptime | 99.9% |
| Attestation latency | <500ms p99 |
| Anchor confirmation | <10 minutes average |

---

## 11. For AI Assistants & Developers

When working on this codebase:

1. **Read this document first** — Understand the vision before writing code
2. **Prioritize Gatekeeper** — It's the flagship feature
3. **Never compromise integrity** — Court-admissibility is non-negotiable
4. **Think about data** — Every feature should consider what data it generates
5. **Platform-agnostic APIs** — Mobile, web, desktop are all first-class
6. **Ask when uncertain** — Tony is available at ashiscock@gmail.com

### Key Technical Decisions Already Made

- Cloudflare Workers (edge compute)
- Multi-chain anchoring (not single-chain)
- Commit-reveal for fairness (not trusted server)
- LLM monitoring (not rules-only)
- Durable Objects for coordination (not external Redis)

### What's Still Open

- Specific blockchain for primary anchoring
- LLM provider (OpenAI vs Anthropic vs self-hosted)
- Mobile framework (React Native vs Flutter)
- Hardware partner for Secure Audit Module

---

*Last Updated: November 29, 2025*
*Document Version: 1.0*
