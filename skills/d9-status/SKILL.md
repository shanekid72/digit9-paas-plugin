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

**Response** (envelope is `{status, status_code, data: {...}}`):

```json
{
  "status":      "success",
  "status_code": 200,
  "data": {
    "transaction_ref_number": "5706126111718670",
    "state":                  "IN_PROGRESS",
    "sub_state":              "PAYMENT_SETTLED",
    "agent_ref_number":       "5706126111718670",
    "delivery_ref_number":    "5706126111718670"
  }
}
```

After confirm, the transaction is **irrevocable** in the sense that the partner has committed to settle. State will progress: `IN_PROGRESS` → `COMPLETED` (or `FAILED`) without further partner action. The partner's job is now to **observe**.

`confirmtransaction` is idempotent on `transaction_ref_number` — calling it twice returns the same response and does not double-execute.

**Errors:**

- `40004 NOT_FOUND` — invalid `transaction_ref_number` (wrong/typoed) or transaction expired before confirm.
- `40005 METHOD_NOT_ALLOWED` — already confirmed (idempotent reply usually returns 200; if you see 40005 you're confirming after expiry).
- `806600` — transaction blocked by business rule (post-create AML hit, etc.); not recoverable.

## Enquire transaction (status poll)

```
GET {D9_BASE_URL}/amr/paas/api/v1_0/paas/enquire-transaction
       ?transaction_ref_number=5706126111718670
```

The Postman collection only documents `transaction_ref_number` as the query parameter — the system-generated 16-char ID returned by `createtransaction`. Persist it the moment create returns, because there's no documented fallback lookup-by-customer-ref in the canonical collection.

**Response — full shape from a real sandbox enquire** (envelope is `{status, status_code, data: {...}}`; `state`/`sub_state` live **inside** `data`):

```json
{
  "status":      "success",
  "status_code": 200,
  "data": {
    "state":             "IN_PROGRESS",
    "sub_state":         "TXN_PREPARED",
    "transaction_date":  "2026-04-27T17:44:05.761+04:00",
    "transaction_gmt_date": "2026-04-27T13:44:05.761Z",
    "type":              "SEND",
    "instrument":        "REMITTANCE",
    "source_of_income":  "SLRY",
    "purpose_of_txn":    "SAVG",
    "message":           "Agency transaction",

    "sender": {
      "agent_customer_id": "987612349876",
      "customer_number":   "7842434024767283",
      "first_name":        "GEORGE",
      "last_name":         "MICHEAL",
      "mobile_number":     "+971508359468",
      "date_of_birth":     "1995-08-22",
      "country_of_birth":  "IN",
      "nationality":       "IN"
    },

    "receiver": {
      "first_name":    "ANIJA FIRSTNAME",
      "last_name":     "ANIJA LASTNAME",
      "mobile_number": "+919586741500",
      "nationality":   "IN",
      "relation_code": "32",
      "bank_details": {
        "account_type":      "1",
        "account_num":       "99345724439934",
        "iso_code":          "FDRLINBBOPS",
        "routing_code":      "FDRL0001033",
        "account_category":  "UNDEFINED",
        "transfer_mode":     "NEFT"
      }
    },

    "transaction": {
      "quote_id":                 "5706126111718670",
      "transaction_ref_number":   "5706126111718670",
      "agent_ref_number":         "5706126111718670",
      "delivery_ref_number":      "5706126111718670",
      "receiving_mode":           "BANK",
      "payment_mode":             "AP",
      "sending_country_code":     "AE",
      "receiving_country_code":   "IN",
      "sending_currency_code":    "AED",
      "receiving_currency_code":  "INR",
      "sending_amount":           100,
      "receiving_amount":         2442.15,
      "total_payin_amount":       107.35,
      "tax_invoice_no":           "78410026000000005401",
      "fx_rates":                 [ /* SELL rates both directions */ ],
      "fee_details":              [ /* COMMISSION, TAX */ ],
      "settlement_details":       [ /* values per charge_type */ ]
    }
  }
}
```

**Field-name gotchas in the enquire response** (different from createtransaction):

- `bank_details.account_num` (not `account_number`) and `bank_details.account_type` (not `account_type_code`).
- `sender.agent_customer_id` (not `agent_customer_number`); a separate system-generated `customer_number` is also returned.
- `state` and `sub_state` are inside `data` — the create-transaction response uses the same shape, but partners building DB schemas often miss this and end up storing nulls.

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

`sub_state` provides finer detail. The set below is what the sandbox actually returns on the AE→IN BANK happy path (verified end-to-end via `/digit9-paas:d9-test`); other corridors and error paths add more sub-states which Digit9 ops can enumerate on request.

| state         | sub_state               | Meaning                                            |
| ------------- | ----------------------- | -------------------------------------------------- |
| INITIATED     | QUOTE_CREATED           | Quote created, transaction not yet                 |
| ACCEPTED      | ORDER_ACCEPTED          | createtransaction returned, awaiting confirm       |
| IN_PROGRESS   | PAYMENT_SETTLED         | confirmtransaction acknowledged the commitment     |
| IN_PROGRESS   | TXN_PREPARED            | Backend handoff complete, awaiting payout rail     |
| IN_PROGRESS   | PAYOUT_INITIATED        | Funds dispatched to receiver bank/agent            |
| COMPLETED     | PAID                    | Funds delivered (BANK)                             |
| COMPLETED     | PICKED_UP               | (CASHPICKUP) collected by recipient                |
| FAILED        | PAYMENT_FAILED          | Bank rejected; funds returned                      |
| CANCELLED     | REVERSAL_INITIATED      | Cancellation in progress                           |

**Don't hard-code the sub_state list as an exhaustive enum** — Digit9 occasionally adds new sub-states on the IN_PROGRESS path. Drive logic off `state`; treat unknown `sub_state` as opaque-but-loggable.

## Sandbox vs production timing

Enquire typically stays at `state=IN_PROGRESS / sub_state=TXN_PREPARED` for **60–120 seconds** in sandbox before reaching a terminal state (and occasionally longer under load). Production settles in seconds. **Polling logic should not time out under 5 minutes when developing against sandbox** — anything shorter will produce false-negative "stuck" reports against perfectly healthy sandbox transactions.

Note that `confirmtransaction` may return `sub_state=PAYMENT_SETTLED` immediately even though `enquire` reflects `sub_state=TXN_PREPARED` for a while afterward — these are two different views (partner-side commitment vs payout-side state), not a contradiction. Don't write logic that asserts the two responses agree at any given moment; trust enquire as the source of truth for payout state.

## Polling cadence

- **First poll:** ~5 seconds after confirm.
- **Subsequent:** every 10 seconds for the first 2 minutes, then every 30s.
- **Stop:** when `state ∈ {COMPLETED, FAILED, CANCELLED}` or after 30 minutes (escalate to ops). In sandbox, do not give up before 5 minutes — see "Sandbox vs production timing" above.

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

// Digit9 wraps every response in {status, status_code, data: {...}}.
// Helpers below unwrap so callers see the inner data directly.
async function unwrap<T>(p: Promise<{ data: { data: T } }>): Promise<T> {
  return (await p).data.data;
}

export async function confirmTransaction(d9: D9Client, txnRef: string) {
  return unwrap<any>(d9.request({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/confirmtransaction',
    data:   { transaction_ref_number: txnRef },
  }));
}

export async function enquireTransaction(d9: D9Client, txnRef: string) {
  return unwrap<any>(d9.request({
    method: 'GET',
    url:    '/amr/paas/api/v1_0/paas/enquire-transaction',
    params: { transaction_ref_number: txnRef },
  }));
}

export async function cancelTransaction(d9: D9Client, txnRef: string, reason: string, remarks?: string) {
  return unwrap<any>(d9.request({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/canceltransaction',
    data:   { transaction_ref_number: txnRef, cancel_reason: reason, remarks },
  }));
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
            // EnquireResponse maps the {status, status_code, data: {state, ...}} envelope —
            // state lives on r.data(), not r itself.
            if (TERMINAL.contains(r.data().state())) return r;
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
