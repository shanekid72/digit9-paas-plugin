---
name: d9-status
description: Confirm, track, and (rarely) cancel a Digit9 PaaS transaction. Triggers on confirmTransaction, enquire-transaction, cancelTransaction, transaction status, polling, state machine, COMPLETED/IN_PROGRESS/FAILED/CANCELLED, sub_state, settlement_date, payout status, "is the transaction settled", reconciliation polling. After createTransaction (see d9-transaction), this skill carries the transaction to a terminal state.
---

# Digit9 PaaS — Confirm, Track, Cancel

After `createTransaction` returns `ACCEPTED`, the transaction is reserved but **not paid out**. The partner must:

1. Call `confirmTransaction` — irrevocable commitment.
2. Track via `enquire-transaction` polling and/or webhooks until terminal state.
3. Optionally call `cancelTransaction` before settlement (rare, narrow window).

## Confirm transaction

```
POST {D9_BASE_URL}/amr/paas/api/v1_0/paas/confirmtransaction
```

**Body:**

```json
{ "transaction_ref_number": "1234567890123456" }
```

**Response:**

```json
{
  "state":     "IN_PROGRESS",
  "sub_state": "READY_FOR_SETTLEMENT",
  "data": {
    "transaction_ref_number": "1234567890123456",
    "confirmation_date":      "2026-04-27T10:19:01Z"
  }
}
```

After confirm, the transaction is **irrevocable** in the sense that the partner has committed to settle. State will progress: `IN_PROGRESS` → `COMPLETED` (or `FAILED`) without further partner action. The partner's job is now to **observe**.

`confirmTransaction` is idempotent on `transaction_ref_number` — calling it twice returns the same response and does not double-execute.

**Errors:**

- `40004 NOT_FOUND` — invalid `transaction_ref_number` (wrong/typoed) or transaction expired before confirm.
- `40005 METHOD_NOT_ALLOWED` — already confirmed (idempotent reply usually returns 200; if you see 40005 you're confirming after expiry).
- `806600` — transaction blocked by business rule (post-create AML hit, etc.); not recoverable.

## Enquire transaction (status poll)

```
GET {D9_BASE_URL}/amr/paas/api/v1_0/paas/enquire-transaction
       ?transaction_ref_number=1234567890123456
       [&agent_transaction_ref_number=PARTNER_xxx]
```

Either reference works (use `transaction_ref_number`; `agent_transaction_ref_number` is a fallback if the partner lost the system ID).

**Response (the fields that matter):**

```json
{
  "state":     "COMPLETED",
  "sub_state": "PAID",
  "data": {
    "transaction_ref_number":      "1234567890123456",
    "agent_transaction_ref_number":"PARTNER_xxx",
    "transaction_date":            "2026-04-27T10:18:32Z",
    "settlement_date":             "2026-04-27T10:23:14Z",
    "fx_rates":          { "rate": "22.45000000", "...": "..." },
    "fee_details":       [ "..." ],
    "settlement_details":{ "settled_amount": { "value": "2238.00", "currency": "INR" } },

    "bank_details":      { "clearing_status": "CLEARED" },        // BANK only
    "cashpickup_details":{ "status": "PICKED_UP", "pickup_date": "2026-04-27T10:30:00Z" }, // CASHPICKUP only
    "wallet_details":    { "topup_status": "CREDITED" }            // WALLET only
  }
}
```

## State machine

```
INITIATED ─── (createTxn) ──▶ ACCEPTED ─── (confirmTxn) ──▶ IN_PROGRESS
                                                              │
                                          (auto)              │
                                              ▼               ▼
                                          COMPLETED       FAILED
                                              │
                                              ▼
                                            (terminal)

ACCEPTED ─── (cancelTxn before confirm or before settlement) ──▶ CANCELLED
```

Terminal states: `COMPLETED`, `FAILED`, `CANCELLED`. Stop polling once you hit one.

`sub_state` provides finer detail. Common ones:

| state         | sub_state               | Meaning                                 |
| ------------- | ----------------------- | --------------------------------------- |
| INITIATED     | QUOTE_CREATED           | Quote created, transaction not yet     |
| ACCEPTED      | TRANSACTION_CREATED     | createTxn returned, awaiting confirm   |
| ACCEPTED      | READY_FOR_PICKUP        | (CASHPICKUP) created and ready         |
| IN_PROGRESS   | READY_FOR_SETTLEMENT    | Confirmed, awaiting payout             |
| IN_PROGRESS   | PAYOUT_INITIATED        | Funds dispatched to receiver bank/agent|
| COMPLETED     | PAID                    | Funds delivered                        |
| COMPLETED     | PICKED_UP               | (CASHPICKUP) collected by recipient    |
| FAILED        | PAYMENT_FAILED          | Bank rejected; funds returned          |
| CANCELLED     | REVERSAL_INITIATED      | Cancellation in progress               |

## Polling cadence

- **First poll:** ~5 seconds after confirm.
- **Subsequent:** every 10 seconds for the first 2 minutes, then every 30s.
- **Stop:** when `state ∈ {COMPLETED, FAILED, CANCELLED}` or after 30 minutes (escalate to ops).

**Even better — use webhooks instead of polling for the primary path** (see `d9-webhooks`), and reserve polling for reconciliation backfill of any transactions where webhook delivery failed.

## Cancel transaction (narrow window)

```
POST {D9_BASE_URL}/amr/paas/api/v1_0/paas/canceltransaction
```

```json
{
  "transaction_ref_number": "1234567890123456",
  "cancel_reason":          "R6",                     // standard reason code
  "remarks":                "Customer requested reversal"
}
```

Allowed only while `state == IN_PROGRESS` and funds haven't yet settled. Once `sub_state == PAYOUT_INITIATED`, cancel typically fails with `40005 METHOD_NOT_ALLOWED`.

Common cancel reason codes: `R6` (customer request), `R7` (suspected fraud), `R8` (compliance).

## Canonical implementation

### Node / TypeScript

```ts
// src/d9/status.ts
import { D9Client } from './client';

export type State = 'INITIATED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
const TERMINAL: ReadonlySet<State> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export async function confirmTransaction(d9: D9Client, txnRef: string) {
  const { data } = await d9.request<any>({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/confirmtransaction',
    data:   { transaction_ref_number: txnRef },
  });
  return data;
}

export async function enquireTransaction(d9: D9Client, txnRef: string) {
  const { data } = await d9.request<any>({
    method: 'GET',
    url:    '/amr/paas/api/v1_0/paas/enquire-transaction',
    params: { transaction_ref_number: txnRef },
  });
  return data;
}

export async function cancelTransaction(d9: D9Client, txnRef: string, reason: string, remarks?: string) {
  const { data } = await d9.request<any>({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/canceltransaction',
    data:   { transaction_ref_number: txnRef, cancel_reason: reason, remarks },
  });
  return data;
}

export async function pollUntilTerminal(
  d9: D9Client,
  txnRef: string,
  opts: { initialDelayMs?: number; maxDurationMs?: number } = {},
): Promise<{ state: State; raw: any }> {
  const initial = opts.initialDelayMs ?? 5_000;
  const maxDur  = opts.maxDurationMs  ?? 30 * 60_000;
  const start   = Date.now();
  await delay(initial);

  while (Date.now() - start < maxDur) {
    const r = await enquireTransaction(d9, txnRef);
    if (TERMINAL.has(r.state)) return { state: r.state, raw: r };
    const elapsed = Date.now() - start;
    await delay(elapsed < 120_000 ? 10_000 : 30_000);
  }
  throw new Error(`Transaction ${txnRef} did not reach terminal state within ${maxDur}ms`);
}

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
```

### Java / Spring Boot

```java
// src/main/java/com/partner/d9/StatusService.java
@Service
public class StatusService {
    private static final Set<String> TERMINAL = Set.of("COMPLETED", "FAILED", "CANCELLED");
    private final D9Client client;

    public StatusService(D9Client client) { this.client = client; }

    public ConfirmResponse confirm(String txnRef) {
        return client.http().post()
            .uri("/amr/paas/api/v1_0/paas/confirmtransaction")
            .bodyValue(Map.of("transaction_ref_number", txnRef))
            .retrieve()
            .bodyToMono(ConfirmResponse.class)
            .block();
    }

    public EnquireResponse enquire(String txnRef) {
        return client.http().get()
            .uri(b -> b.path("/amr/paas/api/v1_0/paas/enquire-transaction")
                       .queryParam("transaction_ref_number", txnRef).build())
            .retrieve()
            .bodyToMono(EnquireResponse.class)
            .block();
    }

    public EnquireResponse pollUntilTerminal(String txnRef) {
        var start = Instant.now();
        try { Thread.sleep(5_000); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
        while (Duration.between(start, Instant.now()).toMinutes() < 30) {
            var r = enquire(txnRef);
            if (TERMINAL.contains(r.state())) return r;
            var ms = Duration.between(start, Instant.now()).toMillis() < 120_000 ? 10_000L : 30_000L;
            try { Thread.sleep(ms); } catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
        }
        throw new D9IntegrationException("Transaction " + txnRef + " did not terminate in 30 minutes");
    }
}
```

## Anti-patterns to flag

1. **Polling without backoff or cap.** Tight loops will get you rate-limited. Always 5s → 10s → 30s → cap at 30 minutes.
2. **Trusting webhook alone with no polling.** Webhooks have 3 retries then give up. Run a nightly job that enquires every non-terminal transaction (see `d9-webhooks` for the reconciliation pattern).
3. **Treating IN_PROGRESS as failure after a short timeout.** Cross-border can take minutes. Don't show "transaction failed" until you actually see `state=FAILED`.
4. **Catching FAILED and auto-retrying.** A failed transaction is the user's funds returned. Don't silently re-attempt — surface the failure and require explicit re-initiation.
5. **Calling cancel speculatively.** It's not a "pause." Once payout is initiated, cancel rejects with 40005. Use sparingly and audit every call.
6. **Ignoring `sub_state`.** `state` alone misses important detail. UI should reflect `sub_state` for transparency (e.g., "Funds dispatched to bank" vs. "Awaiting bank settlement").

## Verification

The MCP server exposes `d9_confirm_txn` and `d9_enquire_txn`. Ask Claude:

> "Confirm transaction 1234567890123456 against sandbox and poll until terminal."

Claude will confirm, poll on the cadence above, and report the final state with timing.
