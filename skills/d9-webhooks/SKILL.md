---
name: d9-webhooks
description: Receive and process Digit9 webhooks. Triggers on webhook receiver, webhook handler, transaction.status.changed, customer.status.changed, X-Signature verification, HMAC-SHA256, Idempotency-Key header, webhook retries, webhook deduplication, reconciliation, "funds settled but webhook not received". Pairs with d9-status for the polling/webhook hybrid that's required for production reliability.
---

# Digit9 PaaS — Webhooks

Webhooks are how Digit9 tells the partner asynchronously about transaction and customer state changes. They're how a partner avoids polling forever and learns about delayed events (e.g., a CASHPICKUP getting collected three hours after creation).

**Webhooks are a hint, not a contract.** Network drops, your endpoint goes down, your firewall throttles — Digit9 retries 3 times then stops. The partner's source of truth is `enquire-transaction`. Use webhooks to *accelerate* updates, but always reconcile.

## Events you'll receive

| Event                       | Fired when                                        | Maps to skill |
| --------------------------- | ------------------------------------------------- | ------------- |
| `transaction.status.changed`| Transaction state/sub_state changes               | d9-status     |
| `customer.status.changed`   | Customer KYC/AML status changes (post-onboarding) | d9-onboard    |

## Payload shape (`transaction.status.changed`)

```json
{
  "event_type":                  "transaction.status.changed",
  "timestamp":                   "2026-04-27T10:23:14Z",
  "transaction_ref_number":      "1234567890123456",
  "agent_transaction_ref_number":"PARTNER_xxx",
  "state":                       "COMPLETED",
  "sub_state":                   "PAID",
  "data": {
    "fx_rates":           { "rate": "22.45000000", "...": "..." },
    "fee_details":        [ "..." ],
    "settlement_details": {
      "settled_amount":  { "value": "2238.00", "currency": "INR" },
      "settlement_date": "2026-04-27"
    }
  }
}
```

## Headers

| Header             | Value                                                   |
| ------------------ | ------------------------------------------------------- |
| `X-Signature`      | `HMAC-SHA256(raw_body, partner_shared_secret)` as hex   |
| `X-Timestamp`      | ISO 8601 UTC; reject if older than ±5 minutes (replay)  |
| `Idempotency-Key`  | UUID — dedupe by this on your side                      |
| `Content-Type`     | `application/json`                                      |

The shared secret is per-partner, delivered out-of-band by your Digit9 integration manager. Store as `D9_WEBHOOK_SECRET` env var.

## Verification — non-negotiable

**Verify signature on every request before any state change.** A request that fails signature should be rejected with `401 Unauthorized`, not `200 OK` with a comment. Returning 200 to unsigned requests means anyone can replay arbitrary state transitions into your system.

Steps:

1. Read raw body bytes (not parsed JSON — parse-then-stringify rewrites whitespace and breaks the HMAC).
2. Read `X-Signature` and `X-Timestamp` headers.
3. Reject if `|now - X-Timestamp| > 5 minutes`.
4. Compute `HMAC-SHA256(raw_body, D9_WEBHOOK_SECRET)`.
5. Constant-time compare against `X-Signature` (use `crypto.timingSafeEqual` / `MessageDigest.isEqual`).
6. Only after pass: parse the body, dedupe by `Idempotency-Key`, then process.

## Idempotency

Digit9 retries failed deliveries 3 times with exponential backoff. The partner's endpoint **will** see duplicates (e.g., your endpoint timed out after processing succeeded → Digit9 retries → you process again).

Keep a log of `Idempotency-Key` values you've already processed. On a duplicate, return `200 OK` immediately without re-processing. A small Redis or even Postgres table works:

```sql
CREATE TABLE d9_webhook_log (
  idempotency_key  UUID         PRIMARY KEY,
  event_type       VARCHAR(64)  NOT NULL,
  received_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  payload          JSONB        NOT NULL
);
```

## Reconciliation backfill — required

Webhooks miss. Set up a scheduled job (nightly is fine; hourly for higher volumes):

```
For every transaction in the partner DB where:
  state ∉ {COMPLETED, FAILED, CANCELLED}
  AND age > 30 minutes:
    call enquire-transaction
    if API state is terminal:
      update local state
      log "reconciled via backfill"
```

This catches the long tail of webhook delivery failures. Without it, you'll have transactions stuck "in progress" in your DB forever.

## Canonical implementation

### Node / TypeScript (Express)

```ts
// src/webhooks/d9-receiver.ts
import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

const SECRET = process.env.D9_WEBHOOK_SECRET!;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

// IMPORTANT: capture raw body for HMAC; do NOT use express.json() before this
export const rawBodyMiddleware = express.raw({ type: 'application/json' });

export function verifySignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.header('X-Signature') ?? '';
  const timestamp = req.header('X-Timestamp') ?? '';
  if (!signature || !timestamp) return res.status(401).send('missing signature headers');

  const ts = Date.parse(timestamp);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
    return res.status(401).send('timestamp out of range');
  }

  const expected = crypto
    .createHmac('sha256', SECRET)
    .update(req.body)               // raw Buffer
    .digest('hex');

  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected,  'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).send('signature mismatch');
  }
  next();
}

const seen = new Set<string>(); // replace with persistent store

export const d9WebhookHandler = async (req: Request, res: Response) => {
  const idemKey = req.header('Idempotency-Key') ?? '';
  if (!idemKey) return res.status(400).send('missing Idempotency-Key');
  if (seen.has(idemKey)) return res.status(200).send('duplicate, ignored');
  seen.add(idemKey);

  const payload = JSON.parse(req.body.toString('utf8'));

  switch (payload.event_type) {
    case 'transaction.status.changed':
      await onTransactionStatusChanged(payload);
      break;
    case 'customer.status.changed':
      await onCustomerStatusChanged(payload);
      break;
    default:
      console.warn('unknown event_type:', payload.event_type);
  }
  res.status(200).send('ok');
};

// Wire it up:
//   app.post('/webhooks/digit9', rawBodyMiddleware, verifySignature, d9WebhookHandler);
```

### Java / Spring Boot

```java
// src/main/java/com/partner/d9/webhook/D9WebhookController.java
@RestController
@RequestMapping("/webhooks")
public class D9WebhookController {

    @Value("${d9.webhook.secret}") private String secret;
    private static final long MAX_SKEW_MS = 5 * 60_000;

    private final WebhookProcessor processor;
    private final IdempotencyStore  idempotency;

    public D9WebhookController(WebhookProcessor processor, IdempotencyStore idempotency) {
        this.processor   = processor;
        this.idempotency = idempotency;
    }

    @PostMapping(value = "/digit9", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<String> receive(
        @RequestHeader("X-Signature") String signature,
        @RequestHeader("X-Timestamp") String timestamp,
        @RequestHeader("Idempotency-Key") String idemKey,
        @RequestBody  byte[] rawBody
    ) throws Exception {

        // 1. timestamp window
        var ts = Instant.parse(timestamp);
        if (Math.abs(Duration.between(ts, Instant.now()).toMillis()) > MAX_SKEW_MS) {
            return ResponseEntity.status(401).body("timestamp out of range");
        }

        // 2. HMAC verify
        var mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        var expected = mac.doFinal(rawBody);
        var actual   = HexFormat.of().parseHex(signature);
        if (!MessageDigest.isEqual(expected, actual)) {
            return ResponseEntity.status(401).body("signature mismatch");
        }

        // 3. idempotency
        if (!idempotency.markIfNew(idemKey)) {
            return ResponseEntity.ok("duplicate, ignored");
        }

        // 4. process
        processor.process(new String(rawBody, StandardCharsets.UTF_8));
        return ResponseEntity.ok("ok");
    }
}
```

## Anti-patterns to flag

1. **Returning 200 on signature failure.** Reject with 401. Returning 200 means Digit9 stops retrying *and* you've accepted unsigned data.
2. **Verifying against parsed JSON instead of raw body.** Frameworks normalize whitespace, key ordering, etc. Always HMAC over the raw bytes.
3. **No timestamp window check.** Replay attacks become trivial without one. ±5 minutes is the standard.
4. **Trusting webhooks alone, no reconciliation backfill.** 3 retries is not a guarantee. Always run a polling backfill.
5. **Storing the shared secret in code or unencrypted config.** Always env-driven; rotate annually.
6. **Acknowledging before processing.** If you 200 then crash, Digit9 thinks you got it. Process first, ack second. (Use the dedupe table to handle the worst-case retry-after-process-success.)
7. **Slow webhook handlers.** Digit9 will time out around 10s. Acknowledge fast, push heavy work to a queue.

## Verification

The MCP server exposes `d9_simulate_webhook`. Ask Claude:

> "Send a fake `transaction.status.changed` webhook for state COMPLETED to my local handler at http://localhost:3000/webhooks/digit9."

The tool builds a payload, signs it correctly with `D9_WEBHOOK_SECRET`, and POSTs it to the partner's local endpoint. Lets the partner develop the receiver without standing up a public tunnel.
