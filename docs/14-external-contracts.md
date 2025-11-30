# External Contracts

> Specifications for all external service integrations.  
> Contract tests ensure mocks match reality.

---

## RPC Providers (Ethereum JSON-RPC)

### eth_getBalance

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "eth_getBalance",
  "params": ["0x742d35Cc6634C0532925a3b844Bc9e7595f8fE00", "latest"],
  "id": 1
}
```

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x4563918244f40000"
}
```

**Result:** Hex-encoded balance in wei.

**Error Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32602,
    "message": "Invalid params"
  }
}
```

### eth_call (ERC-20 balanceOf)

**Request:**
```json
{
  "jsonrpc": "2.0",
  "method": "eth_call",
  "params": [
    {
      "to": "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      "data": "0x70a08231000000000000000000000000742d35cc6634c0532925a3b844bc9e7595f8fe00"
    },
    "latest"
  ],
  "id": 1
}
```

**Data breakdown:**
- `0x70a08231` — balanceOf function selector
- Next 32 bytes — address padded to 32 bytes

**Response:**
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": "0x0000000000000000000000000000000000000000000000000000000005f5e100"
}
```

**Result:** 32-byte hex balance (100000000 = 100 USDC with 6 decimals).

### Provider Endpoints

| Network | Primary | Fallback |
|---------|---------|----------|
| ETH Mainnet | `${RPC_ETH_MAIN}` | `https://cloudflare-eth.com` |
| Base | `${RPC_BASE_MAIN}` | `https://base-mainnet.public.blastapi.io` |
| Polygon | `${WEB3_RPC_URL_POLYGON}` | `https://polygon-rpc.com` |
| Arbitrum | — | `https://arb1.arbitrum.io/rpc` |
| Optimism | — | `https://mainnet.optimism.io` |
| BSC | — | `https://bsc-dataseed.binance.org` |

### Rate Limits

| Provider | Limit |
|----------|-------|
| Cloudflare ETH | Unlimited (Cloudflare customer) |
| Public RPCs | ~10-50 req/sec |
| Blast API | 25 req/sec free tier |

### Retry Strategy

```typescript
async function rpcWithRetry(
  endpoints: string[],
  method: string,
  params: unknown[],
  maxRetries: number = 3
): Promise<string> {
  let lastError: Error | null = null;
  
  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await rpcCall(endpoint, method, params);
      } catch (e) {
        lastError = e as Error;
        // Exponential backoff
        await sleep(Math.pow(2, attempt) * 100);
      }
    }
  }
  
  throw lastError ?? new Error('All RPC endpoints failed');
}
```

---

## Stripe

### Pre-Authorization (Hold)

**Request:**
```typescript
const paymentIntent = await stripe.paymentIntents.create({
  amount: 199, // $1.99 in cents
  currency: 'usd',
  capture_method: 'manual', // Hold, don't capture
  payment_method: 'pm_...',
  confirm: true,
  metadata: {
    challenge_id: '...',
    user_id: '...',
  },
});
```

**Response:**
```json
{
  "id": "pi_...",
  "status": "requires_capture",
  "amount": 199,
  "amount_capturable": 199
}
```

### Capture

```typescript
const captured = await stripe.paymentIntents.capture('pi_...');
// status: "succeeded"
```

### Cancel (Release Hold)

```typescript
const canceled = await stripe.paymentIntents.cancel('pi_...');
// status: "canceled"
```

### Webhook Events

| Event | When |
|-------|------|
| `payment_intent.created` | Hold created |
| `payment_intent.succeeded` | Captured |
| `payment_intent.canceled` | Released |
| `payment_intent.payment_failed` | Card declined |

### Test Cards

| Number | Behavior |
|--------|----------|
| `4242424242424242` | Succeeds |
| `4000000000000002` | Declined |
| `4000000000009995` | Insufficient funds |

### Idempotency

```typescript
await stripe.paymentIntents.create(
  { ... },
  { idempotencyKey: `challenge_${challengeId}_stake_${userId}` }
);
```

---

## Resend (Email)

### Send Email

**Request:**
```typescript
const { data, error } = await resend.emails.send({
  from: 'TattleHash <noreply@tattlehash.com>',
  to: ['user@example.com'],
  subject: 'Challenge Accepted',
  html: '<p>Your challenge has been accepted...</p>',
});
```

**Response:**
```json
{
  "id": "email_id_..."
}
```

### Rate Limits

- Free tier: 100 emails/day
- Pro tier: 50,000 emails/month

### Templates

Store templates in code, not Resend dashboard:

```typescript
const templates = {
  challenge_accepted: (data: { title: string; counterparty: string }) => ({
    subject: `Challenge Accepted: ${data.title}`,
    html: `<p>${data.counterparty} has accepted your challenge...</p>`,
  }),
  verification_required: (data: { link: string }) => ({
    subject: 'Action Required: Verify Your Wallet',
    html: `<p>Please verify your wallet: <a href="${data.link}">Verify Now</a></p>`,
  }),
};
```

---

## Twilio (SMS)

### Send SMS

**Request:**
```typescript
const message = await client.messages.create({
  body: 'Your TattleHash verification code: 123456',
  from: process.env.TWILIO_FROM_NUMBER,
  to: '+1234567890',
});
```

**Response:**
```json
{
  "sid": "SM...",
  "status": "queued"
}
```

### Status Values

| Status | Meaning |
|--------|---------|
| `queued` | Accepted by Twilio |
| `sent` | Sent to carrier |
| `delivered` | Confirmed delivered |
| `failed` | Delivery failed |
| `undelivered` | Carrier rejected |

### Rate Limits

- Standard: 1 msg/sec per number
- High-throughput: 100 msg/sec

### Costs

- US: ~$0.0079/message
- International: Varies ($0.01 - $0.10)

---

## Contract Tests

Contract tests verify that our mocks match real service behavior.

### test/contracts/rpc.contract.spec.ts

```typescript
import { describe, it, expect } from 'vitest';

describe('RPC Contract', () => {
  // Only run against real RPC in CI with flag
  const LIVE_TEST = process.env.RPC_CONTRACT_TEST === 'true';
  
  it.skipIf(!LIVE_TEST)('eth_getBalance returns hex string', async () => {
    const response = await fetch('https://cloudflare-eth.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: ['0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045', 'latest'],
        id: 1,
      }),
    });
    
    const data = await response.json();
    
    expect(data.jsonrpc).toBe('2.0');
    expect(data.id).toBe(1);
    expect(data.result).toMatch(/^0x[0-9a-fA-F]+$/);
  });
  
  it.skipIf(!LIVE_TEST)('eth_call balanceOf returns 32-byte hex', async () => {
    // USDC contract on mainnet
    const response = await fetch('https://cloudflare-eth.com', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            data: '0x70a08231000000000000000000000000d8da6bf26964af9d7eed9e03e53415d37aa96045',
          },
          'latest',
        ],
        id: 1,
      }),
    });
    
    const data = await response.json();
    
    expect(data.result).toMatch(/^0x[0-9a-fA-F]{64}$/);
  });
});
```

### test/contracts/stripe.contract.spec.ts

```typescript
import { describe, it, expect } from 'vitest';
import Stripe from 'stripe';

describe('Stripe Contract', () => {
  const LIVE_TEST = process.env.STRIPE_CONTRACT_TEST === 'true';
  
  it.skipIf(!LIVE_TEST)('payment intent create returns expected shape', async () => {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
      apiVersion: '2023-10-16',
    });
    
    const intent = await stripe.paymentIntents.create({
      amount: 100,
      currency: 'usd',
      capture_method: 'manual',
      payment_method_types: ['card'],
    });
    
    expect(intent.id).toMatch(/^pi_/);
    expect(intent.status).toBe('requires_payment_method');
    expect(intent.capture_method).toBe('manual');
    expect(intent.amount).toBe(100);
  });
});
```

### Running Contract Tests

```bash
# Run only unit/integration tests (default)
npm run test

# Run contract tests against live services
RPC_CONTRACT_TEST=true npm run test -- test/contracts/rpc.contract.spec.ts
STRIPE_CONTRACT_TEST=true STRIPE_SECRET_KEY=sk_test_... npm run test -- test/contracts/stripe.contract.spec.ts
```

---

## Error Handling

### RPC Errors

| Code | Meaning | Action |
|------|---------|--------|
| `-32600` | Invalid request | Check request format |
| `-32601` | Method not found | Wrong method name |
| `-32602` | Invalid params | Check params |
| `-32603` | Internal error | Retry with backoff |
| `-32700` | Parse error | Check JSON syntax |

### Stripe Errors

| Type | Meaning | Action |
|------|---------|--------|
| `card_error` | Card declined | Show user error |
| `invalid_request_error` | Bad params | Fix request |
| `api_connection_error` | Network issue | Retry |
| `api_error` | Stripe issue | Retry with backoff |
| `rate_limit_error` | Too many requests | Back off |

### Handling Pattern

```typescript
try {
  const result = await externalService.call(...);
  return result;
} catch (error) {
  if (isRetryable(error)) {
    return await retryWithBackoff(() => externalService.call(...));
  }
  
  // Log and convert to internal error
  logError(error, { service: 'stripe', operation: 'capture' });
  throw { code: 'PAYMENT_CAPTURE_FAILED', details: error.message };
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Stripe.errors.StripeAPIError) {
    return ['api_connection_error', 'api_error', 'rate_limit_error']
      .includes(error.type);
  }
  return false;
}
```

---

## Timeouts

| Service | Timeout | Retry |
|---------|---------|-------|
| RPC | 10s | 3x with backoff |
| Stripe | 30s | 2x |
| Resend | 10s | 1x |
| Twilio | 10s | 1x |

```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 10000);

try {
  const response = await fetch(url, { 
    signal: controller.signal,
    ...options 
  });
  return response;
} finally {
  clearTimeout(timeoutId);
}
```
