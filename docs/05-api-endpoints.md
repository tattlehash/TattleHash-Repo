# API Endpoints Reference

> Complete endpoint specification for TattleHash API.  
> Base URL: `https://api.tattlehash.com`

---

## Existing Endpoints (v4.4 — Unchanged)

| Method | Path | Handler | Description |
|--------|------|---------|-------------|
| GET | `/health` | `getHealth` | Liveness check |
| POST | `/attest` | `postAttest` | Create attestation |
| GET | `/receipt/:id` | `getReceipt` | Get receipt by ID |
| POST | `/admin/sweep` | `postSweep` | Admin cleanup job |
| POST | `/__tests` | `runAllTests` | Test runner (guarded) |
| POST | `/gatekeeper` | `handleGatekeeperCreate` | v1: Create gate |
| POST | `/gate/:id` | `handleGateVerify` | v1: Verify gate |
| GET | `/gate/:id` | `handleGateGet` | v1: Get gate receipt |

---

## New Endpoints (Gatekeeper v2)

### Wallet Verification

#### POST `/gatekeeper/v2/wallet/challenge`

Create a wallet ownership challenge for the user to sign.

**Request:**
```json
{
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  "chain_id": "eip155:1",
  "user_id": "550e8400-e29b-41d4-a716-446655440000"  // optional
}
```

**Response (200):**
```json
{
  "challenge_id": "550e8400-e29b-41d4-a716-446655440001",
  "message": "TattleHash Wallet Verification\n\nAddress: 0x742d35cc6634c0532925a3b844bc9e7595f8fe00\nChain: eip155:1\nNonce: a1b2c3d4e5f6\nExpires at: 2025-11-28T13:00:00Z\nPurpose: gatekeeper_wallet_ownership",
  "expires_at": "2025-11-28T13:00:00Z"
}
```

**Errors:**
- `400 E1001` — Invalid wallet address
- `400 E1002` — Invalid chain ID

---

#### POST `/gatekeeper/v2/wallet/verify`

Verify a signed challenge to prove wallet ownership.

**Request:**
```json
{
  "challenge_id": "550e8400-e29b-41d4-a716-446655440001",
  "signature": "0x1234...abcd"
}
```

**Response (200):**
```json
{
  "status": "VERIFIED",
  "wallet_address": "0x742d35cc6634c0532925a3b844bc9e7595f8fe00",
  "verified_at": "2025-11-28T12:05:00Z"
}
```

**Errors:**
- `400 E1003` — Challenge not found
- `400 E1004` — Challenge expired
- `400 E1005` — Signature verification failed
- `400 E1006` — Address mismatch

---

### Funds Verification

#### POST `/gatekeeper/v2/funds/check`

Check if a wallet meets a minimum balance threshold.

**Request:**
```json
{
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  "network": "eth-mainnet",
  "asset_type": "NATIVE",
  "min_balance": "1000000000000000000",  // 1 ETH in wei
  "challenge_id": "550e8400-e29b-41d4-a716-446655440002",  // optional
  "user_id": "550e8400-e29b-41d4-a716-446655440000"  // optional
}
```

**For ERC-20 tokens:**
```json
{
  "wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
  "network": "eth-mainnet",
  "asset_type": "ERC20",
  "token_address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",  // USDC
  "min_balance": "1000000000",  // 1000 USDC (6 decimals)
  "challenge_id": "550e8400-e29b-41d4-a716-446655440002"
}
```

**Response (200):**
```json
{
  "status": "PASSED",
  "proof_type": "OPAQUE_V1",
  "provider": "cloudflare-eth",
  "checked_at": "2025-11-28T12:05:00Z"
}
```

**Note:** Balance is never exposed. Only PASSED/FAILED status.

**Errors:**
- `400 E2001` — Invalid wallet address
- `400 E2002` — Unsupported network
- `400 E2003` — token_address required for ERC20
- `400 E2004` — RPC error
- `200` with `status: "FAILED"` — Balance below threshold (not an error)

---

## Challenge Endpoints

#### POST `/challenges`

Create a new challenge.

**Request (Solo Mode):**
```json
{
  "mode": "SOLO",
  "title": "ETH balance attestation",
  "description": "Proving I have sufficient ETH for trade"
}
```

**Request (Gatekeeper Mode):**
```json
{
  "mode": "GATEKEEPER",
  "title": "P2P ETH trade",
  "description": "Selling 2 ETH for $5000 USDC",
  "counterparty_user_id": "550e8400-e29b-41d4-a716-446655440099",
  "expires_at": "2025-11-29T12:00:00Z",
  "gatekeeper_requirements": {
    "creator": {
      "wallet_address": "0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00",
      "network": "eth-mainnet",
      "funds_checks": [
        {
          "asset_type": "NATIVE",
          "min_balance": "2000000000000000000",
          "currency_symbol": "ETH"
        }
      ]
    },
    "counterparty": {
      "wallet_address": "0x1234567890abcdef1234567890abcdef12345678",
      "network": "eth-mainnet",
      "funds_checks": [
        {
          "asset_type": "ERC20",
          "token_address": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          "min_balance": "5000000000",
          "currency_symbol": "USDC"
        }
      ]
    }
  }
}
```

**Request (Fire Mode):**
```json
{
  "mode": "FIRE",
  "title": "BTC price prediction",
  "description": "BTC will be above $100k by Dec 31",
  "counterparty_user_id": "550e8400-e29b-41d4-a716-446655440099",
  "fire_config": {
    "honesty_bond_amount": "10000000",
    "currency_code": "USD",
    "resolution_strategy": "ORACLE",
    "oracle_source": "chainlink_btc_usd"
  }
}
```

**Request (Enforced Mode with custom timeouts):**
```json
{
  "mode": "ENFORCED",
  "title": "Freelance milestone payment",
  "description": "Payment for website redesign",
  "counterparty_user_id": "550e8400-e29b-41d4-a716-446655440099",
  "enforced_config": {
    "accept_timeout_seconds": 3600,
    "response_timeout_seconds": 172800,
    "dispute_timeout_seconds": 604800
  }
}
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "mode": "GATEKEEPER",
  "status": "DRAFT",
  "title": "P2P ETH trade",
  "description": "Selling 2 ETH for $5000 USDC",
  "creator_user_id": "550e8400-e29b-41d4-a716-446655440000",
  "counterparty_user_id": "550e8400-e29b-41d4-a716-446655440099",
  "expires_at": "2025-11-29T12:00:00Z",
  "created_at": "2025-11-28T12:00:00Z",
  "updated_at": "2025-11-28T12:00:00Z"
}
```

**Errors:**
- `400 E3001` — Invalid mode
- `400 E3002` — SOLO mode cannot have counterparty
- `400 E3003` — FIRE mode requires fire_config
- `400 E3004` — Invalid timeout values

---

#### GET `/challenges/:id`

Get challenge details.

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "mode": "GATEKEEPER",
  "status": "INTENT_LOCKED",
  "title": "P2P ETH trade",
  "description": "Selling 2 ETH for $5000 USDC",
  "creator_user_id": "550e8400-e29b-41d4-a716-446655440000",
  "counterparty_user_id": "550e8400-e29b-41d4-a716-446655440099",
  "expires_at": "2025-11-29T12:00:00Z",
  "created_at": "2025-11-28T12:00:00Z",
  "updated_at": "2025-11-28T12:30:00Z",
  "initiator_hash": "0xabc123...",
  "counter_hash": "0xdef456...",
  "final_hash": "0x789ghi..."
}
```

**Errors:**
- `404 E3010` — Challenge not found

---

#### POST `/challenges/:id/accept`

Accept a challenge as counterparty.

**Request:**
```json
{
  "wallet_address": "0x1234567890abcdef1234567890abcdef12345678"
}
```

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "status": "AWAITING_GATEKEEPER",
  "message": "Challenge accepted. Gatekeeper verification in progress."
}
```

**Errors:**
- `404 E3010` — Challenge not found
- `400 E3011` — Invalid status for acceptance
- `403 E3012` — Not the designated counterparty
- `400 E3013` — Challenge expired

---

#### POST `/challenges/:id/resolve`

Resolve a challenge with an outcome.

**Request:**
```json
{
  "outcome": "CREATOR_WIN",
  "resolution_data": {
    "oracle_value": "105000",
    "timestamp": "2025-12-31T23:59:59Z"
  }
}
```

**Response (200):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "status": "COMPLETED",
  "resolved_at": "2025-12-31T23:59:59Z",
  "final_hash": "0x789ghi..."
}
```

**Errors:**
- `404 E3010` — Challenge not found
- `400 E3020` — Invalid status for resolution
- `400 E3021` — Invalid outcome

---

## Proof Endpoints

#### GET `/proof/:id`

Get a shareable proof page for an attestation.

**Response (200 HTML):**
Returns a rendered HTML page showing:
- Challenge details
- Verification status
- Commitment hashes (I, C, FINAL)
- QR code for verification
- Timestamp and expiry

**Response (200 JSON with Accept: application/json):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440003",
  "status": "COMPLETED",
  "mode": "GATEKEEPER",
  "title": "P2P ETH trade",
  "initiator_hash": "0xabc123...",
  "counter_hash": "0xdef456...",
  "final_hash": "0x789ghi...",
  "created_at": "2025-11-28T12:00:00Z",
  "resolved_at": "2025-11-28T14:00:00Z",
  "verification_url": "https://api.tattlehash.com/proof/550e8400-e29b-41d4-a716-446655440003"
}
```

---

## Webhook Endpoints

#### POST `/webhooks`

Register a webhook endpoint.

**Request:**
```json
{
  "url": "https://partner.example.com/tattlehash-webhook",
  "description": "Production webhook endpoint"
}
```

**Response (201):**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440010",
  "url": "https://partner.example.com/tattlehash-webhook",
  "secret": "whsec_abc123...",
  "is_active": true,
  "created_at": "2025-11-28T12:00:00Z"
}
```

---

#### GET `/webhooks`

List registered webhook endpoints.

**Response (200):**
```json
{
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440010",
      "url": "https://partner.example.com/tattlehash-webhook",
      "description": "Production webhook endpoint",
      "is_active": true,
      "created_at": "2025-11-28T12:00:00Z"
    }
  ]
}
```

---

#### DELETE `/webhooks/:id`

Delete a webhook endpoint.

**Response (204):** No content

---

## Authentication

All endpoints (except `/health` and `/proof/:id`) require authentication:

**Header:**
```
Authorization: Bearer <api_key>
```

**For user context (challenges, webhooks):**
The API key is associated with a user account. User ID is derived from the key.

**For anonymous verification (wallet/funds checks):**
API key optional. Results not linked to a user unless `user_id` provided.

---

## Rate Limiting

| Endpoint Category | Limit |
|-------------------|-------|
| `/health` | Unlimited |
| `/gatekeeper/v2/*` | 60/min/IP |
| `/challenges/*` | 30/min/user |
| `/webhooks/*` | 10/min/user |

**Headers returned:**
```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 45
X-RateLimit-Reset: 1701180000
```

---

## Error Response Format

All errors follow this structure:

```json
{
  "error": {
    "code": "E1005",
    "message": "Signature verification failed",
    "details": {
      "recovered_address": "0xabc...",
      "expected_address": "0xdef..."
    }
  }
}
```

HTTP status codes:
- `400` — Bad request / validation error
- `401` — Authentication required
- `403` — Forbidden
- `404` — Resource not found
- `409` — Conflict (invalid state transition)
- `410` — Gone (expired)
- `429` — Rate limited
- `500` — Internal server error
