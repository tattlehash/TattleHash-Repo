# Dependencies

> Pinned package versions for TattleHash.  
> Do not upgrade without testing thoroughly.

---

## Production Dependencies

```json
{
  "dependencies": {
    "@noble/hashes": "1.3.3",
    "@noble/secp256k1": "2.1.0",
    "zod": "3.23.8"
  }
}
```

### Why These Versions

| Package | Version | Reason |
|---------|---------|--------|
| `@noble/hashes` | 1.3.3 | Stable, audited, pure JS keccak256 |
| `@noble/secp256k1` | 2.1.0 | Stable, audited, EIP-191 signature recovery |
| `zod` | 3.23.8 | Latest stable, excellent TypeScript inference |

---

## Development Dependencies

```json
{
  "devDependencies": {
    "@cloudflare/workers-types": "4.20241106.0",
    "typescript": "5.6.3",
    "vitest": "2.1.4",
    "wrangler": "3.91.0"
  }
}
```

### Why These Versions

| Package | Version | Reason |
|---------|---------|--------|
| `@cloudflare/workers-types` | 4.20241106.0 | Matches wrangler, D1 types |
| `typescript` | 5.6.3 | Latest stable, good inference |
| `vitest` | 2.1.4 | Fast, Cloudflare-compatible |
| `wrangler` | 3.91.0 | D1 stable, queue support |

---

## Full package.json

```json
{
  "name": "tattlehash-worker",
  "version": "4.5.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "deploy:preview": "wrangler deploy --env preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:coverage": "vitest run --coverage",
    "typecheck": "tsc --noEmit",
    "lint": "eslint src/",
    "db:migrate:local": "wrangler d1 execute tattlehash-db --local --file=db/migrations/001_initial.sql",
    "db:migrate:prod": "wrangler d1 execute tattlehash-db --file=db/migrations/001_initial.sql"
  },
  "dependencies": {
    "@noble/hashes": "1.3.3",
    "@noble/secp256k1": "2.1.0",
    "zod": "3.23.8"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "4.20241106.0",
    "@types/node": "20.10.0",
    "@typescript-eslint/eslint-plugin": "6.13.0",
    "@typescript-eslint/parser": "6.13.0",
    "eslint": "8.54.0",
    "typescript": "5.6.3",
    "vitest": "2.1.4",
    "wrangler": "3.91.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

---

## Cloudflare Compatibility

### Workers Runtime

```toml
# wrangler.toml
compatibility_date = "2025-11-01"
compatibility_flags = ["nodejs_compat"]
```

### D1 Requirements

- D1 is GA as of October 2024
- Requires wrangler >= 3.22.0
- SQLite-compatible SQL syntax

### KV Requirements

- KV is stable
- TTL support for automatic expiration
- No special wrangler version requirements

---

## Crypto Library Notes

### @noble/hashes

Used for:
- `keccak256` (Ethereum hashing)
- `sha256` (general hashing)

```typescript
import { keccak_256 } from '@noble/hashes/sha3';
import { sha256 } from '@noble/hashes/sha256';
```

Why not Web Crypto?
- Web Crypto doesn't support keccak256 (Ethereum's hash)
- @noble/hashes is audited and used by major projects

### @noble/secp256k1

Used for:
- EIP-191 signature recovery
- Public key to address derivation

```typescript
import { recoverPublicKey, ProjectivePoint } from '@noble/secp256k1';
```

Why not ethers.js or viem?
- Much smaller bundle size
- No unnecessary features
- Cloudflare Workers optimized

---

## Version Upgrade Policy

### Critical (Security) Updates

If a security vulnerability is found:
1. Update immediately
2. Test all crypto operations
3. Deploy within 24 hours

### Minor Updates

For minor version bumps:
1. Review changelog
2. Run full test suite
3. Test in preview environment
4. Deploy after 48 hours monitoring

### Major Updates

For major version bumps:
1. Create branch for upgrade
2. Fix all breaking changes
3. Run full test suite
4. Test in preview for 1 week
5. Gradual production rollout

---

## Dependency Audit

Run monthly:

```bash
npm audit
npm outdated
```

Known acceptable advisories:
- None currently

---

## Alternative Packages

If a dependency becomes unmaintained:

| Current | Alternative |
|---------|-------------|
| `@noble/hashes` | `ethereum-cryptography` |
| `@noble/secp256k1` | `ethereum-cryptography` |
| `zod` | `valibot`, `yup` |
