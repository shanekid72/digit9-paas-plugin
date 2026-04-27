# {{PROJECT_NAME}}

Digit9 PaaS integration scaffolded by the `digit9-paas` Claude Code plugin.

- **Service type:** {{SERVICE_TYPE}}
- **Default corridor:** {{DEFAULT_CORRIDOR}}
- **Stack:** Node.js 18+, TypeScript, Express, axios

## First run

1. Copy `.env.example` to `.env` and fill in the sandbox credentials.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Verify auth works:
   ```bash
   npm run dev
   # In Claude:
   /d9:auth-check
   ```
4. Run the end-to-end happy path:
   ```bash
   /d9:test
   ```

## Layout

```
src/
├── index.ts              Express app — exposes /webhooks/digit9 and a sample remittance endpoint
├── d9/
│   ├── client.ts         Auth, token caching, the four required headers
│   ├── masters.ts        Banks, branches, corridors (with caching)
│   ├── quote.ts          Quote with 10-min TTL handling
│   ├── transaction.ts    createTransaction with idempotency
│   └── status.ts         confirm + enquire + cancel
└── webhooks/
    └── d9-receiver.ts    HMAC verification + idempotency
test/
└── integration/
    └── happy-path.test.ts End-to-end against sandbox (run on demand)
```

All Digit9 calls flow through `D9Client` — never call axios directly elsewhere.

## Common commands

```bash
npm run dev         # Hot-reloading dev server
npm run build       # Compile to dist/
npm test            # Run integration tests (requires .env to be filled)
npm run typecheck   # TS check, no emit
```

## Working with Claude

Read `CLAUDE.md` at the project root — it tells Claude which plugin skill to load for which task. When in doubt, just ask Claude to do the thing; the right pattern will be applied.
