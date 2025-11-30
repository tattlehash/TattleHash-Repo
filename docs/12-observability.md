# Observability

> Logging, tracing, and metrics strategy.  
> Every operation should be traceable from request to completion.

---

## Logging

### Log Format

All logs use structured JSON:

```typescript
interface LogEntry {
  t: number;          // Unix timestamp (ms)
  level: 'debug' | 'info' | 'warn' | 'error';
  at: string;         // Location/action identifier
  request_id?: string; // Correlation ID
  user_id?: string;   // User context
  challenge_id?: string;
  duration_ms?: number;
  error?: string;
  [key: string]: unknown;
}
```

### Log Helper

```typescript
// src/lib/logger.ts

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  request_id?: string;
  user_id?: string;
  challenge_id?: string;
  [key: string]: unknown;
}

let globalContext: LogContext = {};

export function setLogContext(ctx: LogContext): void {
  globalContext = { ...globalContext, ...ctx };
}

export function clearLogContext(): void {
  globalContext = {};
}

export function log(
  level: LogLevel,
  at: string,
  data: Record<string, unknown> = {}
): void {
  const entry = {
    t: Date.now(),
    level,
    at,
    ...globalContext,
    ...data,
  };
  
  const output = JSON.stringify(entry);
  
  switch (level) {
    case 'debug':
      console.debug(output);
      break;
    case 'info':
      console.log(output);
      break;
    case 'warn':
      console.warn(output);
      break;
    case 'error':
      console.error(output);
      break;
  }
}

// Convenience methods
export const logger = {
  debug: (at: string, data?: Record<string, unknown>) => log('debug', at, data),
  info: (at: string, data?: Record<string, unknown>) => log('info', at, data),
  warn: (at: string, data?: Record<string, unknown>) => log('warn', at, data),
  error: (at: string, data?: Record<string, unknown>) => log('error', at, data),
};
```

### Usage Examples

```typescript
// Request start
setLogContext({ request_id: crypto.randomUUID() });
logger.info('request_start', { method: 'POST', path: '/challenges' });

// Business logic
logger.info('challenge_created', { 
  challenge_id: id, 
  mode: 'GATEKEEPER' 
});

// External call
const start = Date.now();
try {
  const result = await rpcCall(...);
  logger.info('rpc_success', { 
    provider: 'cloudflare-eth',
    duration_ms: Date.now() - start 
  });
} catch (e) {
  logger.error('rpc_failure', { 
    provider: 'cloudflare-eth',
    error: e.message,
    duration_ms: Date.now() - start 
  });
}

// Request end
logger.info('request_end', { status: 200, duration_ms: totalTime });
clearLogContext();
```

---

## Request Tracing

### Request ID Middleware

```typescript
// src/middleware/trace.ts

export async function withTracing(
  request: Request,
  handler: () => Promise<Response>
): Promise<Response> {
  const requestId = request.headers.get('X-Request-ID') || crypto.randomUUID();
  const start = Date.now();
  
  setLogContext({ request_id: requestId });
  
  logger.info('request_start', {
    method: request.method,
    path: new URL(request.url).pathname,
  });
  
  try {
    const response = await handler();
    
    logger.info('request_end', {
      status: response.status,
      duration_ms: Date.now() - start,
    });
    
    // Add request ID to response
    const headers = new Headers(response.headers);
    headers.set('X-Request-ID', requestId);
    
    return new Response(response.body, {
      status: response.status,
      headers,
    });
  } catch (error) {
    logger.error('request_error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      duration_ms: Date.now() - start,
    });
    throw error;
  } finally {
    clearLogContext();
  }
}
```

### Trace Context Propagation

For external calls, propagate request ID:

```typescript
async function rpcCall(endpoint: string, method: string, params: unknown[]): Promise<string> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Request-ID': globalContext.request_id || '',
    },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  // ...
}
```

---

## Metrics

### Key Metrics

| Metric | Type | Labels |
|--------|------|--------|
| `request_total` | Counter | `method`, `path`, `status` |
| `request_duration_ms` | Histogram | `method`, `path` |
| `wallet_verification_total` | Counter | `status` (VERIFIED, EXPIRED, FAILED) |
| `funds_check_total` | Counter | `status`, `network` |
| `challenge_created_total` | Counter | `mode` |
| `challenge_status_changes_total` | Counter | `from`, `to`, `mode` |
| `rpc_requests_total` | Counter | `provider`, `method`, `success` |
| `rpc_duration_ms` | Histogram | `provider` |
| `stripe_operations_total` | Counter | `operation`, `success` |

### In-Memory Metrics (Simple)

For MVP, use in-memory counters exposed via `/metrics`:

```typescript
// src/lib/metrics.ts

interface Metric {
  name: string;
  type: 'counter' | 'histogram';
  help: string;
  values: Map<string, number>;
}

const metrics = new Map<string, Metric>();

function getOrCreateMetric(
  name: string,
  type: 'counter' | 'histogram',
  help: string
): Metric {
  if (!metrics.has(name)) {
    metrics.set(name, { name, type, help, values: new Map() });
  }
  return metrics.get(name)!;
}

export function incCounter(
  name: string,
  labels: Record<string, string>,
  help: string = ''
): void {
  const metric = getOrCreateMetric(name, 'counter', help);
  const key = labelsToKey(labels);
  metric.values.set(key, (metric.values.get(key) || 0) + 1);
}

export function observeHistogram(
  name: string,
  value: number,
  labels: Record<string, string>,
  help: string = ''
): void {
  // Simplified: just track sum and count for average
  const metric = getOrCreateMetric(name, 'histogram', help);
  const sumKey = labelsToKey(labels) + '_sum';
  const countKey = labelsToKey(labels) + '_count';
  metric.values.set(sumKey, (metric.values.get(sumKey) || 0) + value);
  metric.values.set(countKey, (metric.values.get(countKey) || 0) + 1);
}

function labelsToKey(labels: Record<string, string>): string {
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

export function getMetricsText(): string {
  const lines: string[] = [];
  
  for (const metric of metrics.values()) {
    lines.push(`# HELP ${metric.name} ${metric.help}`);
    lines.push(`# TYPE ${metric.name} ${metric.type}`);
    
    for (const [key, value] of metric.values) {
      if (key) {
        lines.push(`${metric.name}{${key}} ${value}`);
      } else {
        lines.push(`${metric.name} ${value}`);
      }
    }
  }
  
  return lines.join('\n');
}
```

### /metrics Endpoint

```typescript
// src/handlers/metrics.ts

import { getMetricsText } from '../lib/metrics';

export async function getMetrics(req: Request, env: Env): Promise<Response> {
  // Optional: require auth for metrics
  const authHeader = req.headers.get('Authorization');
  if (env.METRICS_TOKEN && authHeader !== `Bearer ${env.METRICS_TOKEN}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  return new Response(getMetricsText(), {
    headers: { 'Content-Type': 'text/plain' },
  });
}
```

### Usage

```typescript
// In handlers
incCounter('request_total', { method: 'POST', path: '/challenges', status: '201' });
observeHistogram('request_duration_ms', duration, { method: 'POST', path: '/challenges' });

// In RPC client
incCounter('rpc_requests_total', { provider: 'cloudflare-eth', method: 'eth_getBalance', success: 'true' });
observeHistogram('rpc_duration_ms', duration, { provider: 'cloudflare-eth' });
```

---

## Error Tracking

### Error Storage

Store errors in KV for debugging:

```typescript
// src/lib/error-tracking.ts

export async function trackError(
  env: Env,
  error: Error | unknown,
  context: Record<string, unknown>
): Promise<void> {
  const errorId = crypto.randomUUID();
  
  const errorRecord = {
    id: errorId,
    timestamp: new Date().toISOString(),
    error: error instanceof Error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : { message: String(error) },
    context,
  };
  
  await env.TATTLEHASH_ERROR_KV.put(
    `error:${errorId}`,
    JSON.stringify(errorRecord),
    { expirationTtl: 60 * 60 * 24 * 7 } // 7 days
  );
  
  logger.error('error_tracked', { error_id: errorId, ...context });
}
```

### Error List Endpoint (Admin)

```typescript
export async function listErrors(req: Request, env: Env): Promise<Response> {
  const { keys } = await env.TATTLEHASH_ERROR_KV.list({ prefix: 'error:' });
  
  const errors = await Promise.all(
    keys.slice(0, 50).map(async ({ name }) => {
      const data = await env.TATTLEHASH_ERROR_KV.get(name, 'json');
      return data;
    })
  );
  
  return ok({ errors: errors.filter(Boolean) });
}
```

---

## Health Check

### Deep Health Check

```typescript
// src/handlers/health.ts

interface HealthStatus {
  status: 'ok' | 'degraded' | 'unhealthy';
  version: string;
  checks: {
    kv: 'ok' | 'error';
    d1: 'ok' | 'error';
    rpc: 'ok' | 'error';
  };
  timestamp: string;
}

export async function getHealth(env: Env): Promise<Response> {
  const checks = {
    kv: await checkKV(env),
    d1: await checkD1(env),
    rpc: await checkRPC(env),
  };
  
  const allOk = Object.values(checks).every(c => c === 'ok');
  const anyError = Object.values(checks).some(c => c === 'error');
  
  const status: HealthStatus = {
    status: allOk ? 'ok' : anyError ? 'unhealthy' : 'degraded',
    version: '4.5.0',
    checks,
    timestamp: new Date().toISOString(),
  };
  
  return new Response(JSON.stringify(status), {
    status: status.status === 'unhealthy' ? 503 : 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function checkKV(env: Env): Promise<'ok' | 'error'> {
  try {
    await env.GATE_KV.put('health-check', 'ok', { expirationTtl: 60 });
    await env.GATE_KV.get('health-check');
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkD1(env: Env): Promise<'ok' | 'error'> {
  try {
    await env.TATTLEHASH_DB.prepare('SELECT 1').first();
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkRPC(env: Env): Promise<'ok' | 'error'> {
  try {
    const endpoint = env.RPC_ETH_MAIN || 'https://cloudflare-eth.com';
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
    });
    if (!response.ok) return 'error';
    return 'ok';
  } catch {
    return 'error';
  }
}
```

---

## Cloudflare Analytics

Cloudflare provides built-in analytics:

- **Workers Analytics** — Request count, CPU time, errors
- **Logpush** — Stream logs to external services

### Enable Logpush (Optional)

For production, push logs to:
- Datadog
- Splunk
- S3/R2
- Elasticsearch

Configure via Cloudflare Dashboard or API.

---

## Alerting (Future)

### Alert Conditions

| Condition | Threshold | Action |
|-----------|-----------|--------|
| Error rate | > 1% for 5 min | Page on-call |
| p99 latency | > 1000ms for 5 min | Slack alert |
| Health check failure | 3 consecutive | Page on-call |
| RPC failures | > 10% for 5 min | Slack alert |

### Integration Options

- **Cloudflare Notifications** — Built-in alerting
- **PagerDuty** — Incident management
- **Opsgenie** — Alerting
- **Slack** — Notifications

---

## Dashboard Queries

### Key Queries

```sql
-- Requests by endpoint (D1 audit log)
SELECT path, COUNT(*) as count, AVG(duration_ms) as avg_duration
FROM request_log
WHERE timestamp > datetime('now', '-1 hour')
GROUP BY path
ORDER BY count DESC;

-- Challenge status distribution
SELECT status, COUNT(*) as count
FROM challenges
GROUP BY status;

-- Verification success rate
SELECT 
  status,
  COUNT(*) as count,
  COUNT(*) * 100.0 / SUM(COUNT(*)) OVER () as pct
FROM wallet_verification_challenges
WHERE created_at > datetime('now', '-24 hours')
GROUP BY status;
```

### Grafana Dashboard (Future)

If using Grafana with Prometheus:

```yaml
# prometheus.yml
scrape_configs:
  - job_name: 'tattlehash'
    static_configs:
      - targets: ['api.tattlehash.com']
    metrics_path: '/metrics'
    bearer_token: '${METRICS_TOKEN}'
```
