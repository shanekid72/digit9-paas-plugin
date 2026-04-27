---
description: Run an end-to-end happy-path smoke test against the Digit9 PaaS sandbox — auth, master data, quote, create transaction, confirm, enquire, and webhook simulation. Reports each step with timing.
---

You are running the `/d9:test` command. Your job is to walk a transaction through every stage of the Digit9 PaaS happy path against the sandbox, using the `digit9-sandbox` MCP server tools, and report a clean pass/fail summary.

## Preconditions to check first

- `.env` exists in the project root with the seven required `D9_*` variables filled in
- The `digit9-sandbox` MCP server is connected (it should be — it's bundled with the plugin)

If the env vars are missing, run `/d9:auth-check` first and stop.

## Pick canonical test inputs

Read `CLAUDE.md` for the project's `{{DEFAULT_CORRIDOR}}` (e.g. `AE→IN BANK`) and `{{SERVICE_TYPE}}` (C2C or B2B). Use those for the test. If neither is set, default to `AE→IN BANK` C2C.

Use sandbox-safe test PII:

- C2C sender: `John Smith`, `+971501234567`, AE, passport `GB1234567`
- B2B sender: `Acme Trading LLC`, agent_customer_number `TEST_BIZ_42`
- Receiver (IN BANK): `Priya Sharma`, `+919812345678`, IN, AADHAAR `1234-5678-9012`, HDFC Bank, account `12345678901234`, account_type_code `01`

## Steps to execute

For each step, log a one-line status: ✓ or ✗, key returned IDs, latency.

### 1. Authenticate

Call MCP tool `d9_get_token`. Fail loudly if no token comes back.

```
→ Auth ............ ✓ token obtained, expires in 300s (latency: 412ms)
```

### 2. Master data sanity check

Call `d9_get_corridors` and confirm AE→IN BANK is supported.
Call `d9_get_banks(country='IN', mode='BANK')` and confirm at least one bank.

```
→ Corridors ....... ✓ 47 supported (incl. AE→IN BANK)
→ Banks IN/BANK ... ✓ 23 banks (incl. HDFC0000001)
```

### 3. Quote

Call `d9_quote` with: sending_amount=100, AED→INR, BANK.
Capture `quote_id`, `expires_at`, `rate`, sum of OUR fees.

```
→ Quote ........... ✓ q_38f1...  rate=22.45  ourFees=AED 7.35  expires in 9:54
```

### 4. Create transaction

Call `d9_create_txn` with the quote_id, the chosen service_type, and the canonical sender/receiver objects.
Capture `transaction_ref_number` (16 chars).

```
→ CreateTxn ....... ✓ txn=1234567890123456  state=ACCEPTED
```

### 5. Confirm transaction

Call `d9_confirm_txn(txn_ref)`. Expect `state=IN_PROGRESS`.

```
→ ConfirmTxn ...... ✓ state=IN_PROGRESS  sub_state=READY_FOR_SETTLEMENT
```

### 6. Enquire / poll until terminal

Call `d9_enquire_txn(txn_ref)` every 5–10s until state is COMPLETED, FAILED, or CANCELLED, or 90 seconds elapse.

```
→ Enquire (4x) .... ✓ state=COMPLETED  sub_state=PAID  settlement=INR 2238.00
```

### 7. Webhook simulation

If `D9_WEBHOOK_SECRET` is set and a local webhook receiver URL is configured (look for `WEBHOOK_RECEIVER_URL` in env or default to `http://localhost:3000/webhooks/digit9`):

Call `d9_simulate_webhook` with a `transaction.status.changed` payload for the same `transaction_ref_number`. Confirm the partner endpoint returned 200.

```
→ Webhook sim ..... ✓ HMAC verified, 200 OK from receiver
```

If no receiver is running, skip with a note rather than failing the suite:

```
→ Webhook sim ..... — skipped (no receiver at http://localhost:3000)
```

## Final summary

Print a colored summary block:

```
=========================================================
  Digit9 PaaS Sandbox — End-to-End Test
=========================================================
  Corridor:    AE → IN BANK
  Service:     C2C
  Total time:  ~38 seconds
  Result:      ALL GREEN ✓
=========================================================
```

If any step failed, print which one and the error body. Do not continue past a failed step (e.g. don't try to confirm a transaction that wasn't created).

## Common failure modes — diagnose, don't just fail

| Symptom                                      | Likely cause                                    |
| -------------------------------------------- | ----------------------------------------------- |
| 401 invalid_grant on auth                    | Wrong username/password in `.env`               |
| 40000 BAD_REQUEST on any call                | Missing `sender`/`channel`/`company`/`branch`   |
| 40004 NOT_FOUND on createTxn                 | Quote expired (>10 min between quote and create)|
| 806500 on createTxn                          | Field shape mismatch — log the body's `errors[]`|
| Timeout on enquire after 90s                 | Sandbox slow; not a partner bug                 |

When a failure is diagnosable, suggest the fix in plain English: "Your quote took 11 minutes to use — the quote endpoint TTL is 10 minutes. Re-running the test in tight sequence should pass."
