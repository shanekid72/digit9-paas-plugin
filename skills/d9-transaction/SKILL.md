---
name: d9-transaction
description: Create a Digit9 PaaS remittance transaction from a quote. Triggers on createTransaction, transaction creation, sender object, receiver object, C2C vs B2B, service_type, agent_transaction_ref_number, transaction_ref_number, account_type_code, IBAN, UBO (Ultimate Beneficial Owner), 806500 UNPROCESSABLE_ENTITY, sender_id, receiver_id, source_of_income, purpose_of_txn, or any field-level error from a transaction submission. The most error-prone endpoint in the API.
---

# Digit9 PaaS — Create Transaction

`createTransaction` is the most error-prone endpoint in the PaaS surface. It accepts ~30 fields organized into three sub-objects (sender, receiver, transaction), the shapes of which vary by **service type** (C2C/B2B) and **receiving mode** (BANK/CASHPICKUP/WALLET). Get any of it wrong and you get `806500 UNPROCESSABLE_ENTITY` with a field-level reason. Get the corridor wrong and you get `40004 NOT_FOUND` because your quote expired.

This skill is the canonical reference for getting it right the first time.

## Endpoint

```
POST {D9_BASE_URL}/amr/paas/api/v1_0/paas/createtransaction
Authorization: Bearer <token>
sender / channel / company / branch  (the four context headers)
Content-Type: application/json
```

## Top-level request shape

```json
{
  "quote_id":      "q_38f1a2c5...",
  "service_type":  "C2C",                          // or "B2B"
  "agent_transaction_ref_number": "PARTNER_<UUID>", // your idempotency key
  "sender":   { /* shape depends on service_type */ },
  "receiver": { /* shape depends on receiving_mode */ },
  "transaction": {
    "source_of_income": "SLRY",                    // SLRY/BUSN/INVM/...
    "purpose_of_txn":   "SUPP",                    // SUPP/EDUC/SAVG/...
    "proofs": [ /* B2B only, conditional */ ]
  }
}
```

## Sender object — varies by `service_type`

### C2C (Consumer-to-Consumer)

```json
{
  "first_name":         "John",
  "last_name":          "Smith",
  "mobile_number":      "+971501234567",
  "nationality":        "AE",
  "date_of_birth":      "1985-04-15",
  "country_of_birth":   "GB",
  "sender_id": [
    { "id_code": "PASSPORT", "id_number": "GB1234567", "issue_date": "2019-01-01", "expiry_date": "2029-01-01", "issued_country": "GB" }
  ],
  "sender_address": [
    { "address_type": "RES", "address_line": "Apt 4B, Marina Plaza", "city": "Dubai", "postal_code": "00000", "country_code": "AE" }
  ]
}
```

### B2B (Business-to-Business)

```json
{
  "agent_customer_number":   "PARTNER_BIZ_42",
  "name":                    "Acme Trading LLC",
  "type_of_business":        "TRADING",
  "country_of_incorporation":"AE",
  "phone_number":            "+97142345678",
  "sender_id": [
    { "id_code": "TRN", "id_number": "100123456700003", "issue_date": "2018-01-01", "issued_country": "AE" }
  ],
  "sender_address": [
    { "address_type": "BIZ", "address_line": "Plot 12, JAFZA", "city": "Dubai", "country_code": "AE" }
  ],
  "sender_ubos": [
    { "first_name": "Jane", "last_name": "Doe", "designation": "DIRECTOR", "ownership_pct": 60, "nationality": "AE" }
  ]
}
```

**B2B-specific rules:**

- `name` (legal entity name) replaces `first_name`/`last_name`. Don't send both.
- `sender_ubos` array is required for B2B. Each UBO with ≥25% ownership must be listed (regulatory threshold — confirm with your compliance team).
- `proofs` array (incorporation cert, board resolution) may be required by your tenant — check with Digit9 ops if `806500` says "missing proofs."

Mismatched shape (e.g. C2C body in a B2B service_type, or vice versa) → `806500 UNPROCESSABLE_ENTITY`.

## Receiver object — varies by `receiving_mode`

The mode is set on the *quote*; the receiver shape on `createTransaction` must match. Use the cheat sheet in `d9-master-data` to validate before submission.

### BANK

```json
{
  "first_name":   "Priya",
  "last_name":    "Sharma",
  "mobile_number":"+919812345678",
  "nationality":  "IN",
  "relation_code":"FRND",
  "receiver_id":  [ { "id_code": "AADHAAR", "id_number": "1234-5678-9012", "issued_country": "IN" } ],
  "receiver_address": [
    { "address_type": "RES", "address_line": "12 MG Road", "city": "Mumbai", "postal_code": "400001", "country_code": "IN" }
  ],
  "bank_details": {
    "bank_id":           "IN_HDFC0000001",   // from masters
    "iso_code":          "HDFCINBB",         // from masters
    "branch_id":         "HDFC0000001",      // for BD/NP/LK
    "account_number":    "12345678901234",
    "account_type_code": "01",               // ← REQUIRED for non-PK
    "iban":              null                // ← REQUIRED for PK only
  }
}
```

**BANK rules — the ones that bite:**

- `account_type_code` is **mandatory** for non-PK BANK transfers. Sourced from `bank.account_types[]` via `d9-master-data`. The recent fix in `D9-DEV-PORTAL` (commit `cf0089b`) was specifically partners forgetting this for IN/BD/PH/AE/LK/NP.
- For Pakistan (`receiving_country_code: "PK"`), use `iban` instead of `account_number`. Format: `PK<2-digit check><24-char ID>`.
- `branch_id` is mandatory for Bangladesh, Nepal, Sri Lanka. Lookup via `/raas/masters/v1/banks/{bank_id}/branches`.

### CASHPICKUP

```json
{
  "first_name": "...",  "last_name": "...",  "mobile_number": "...",
  "nationality": "...", "relation_code": "...", "receiver_id": [...], "receiver_address": [...],
  "cashpickup_details": {
    "correspondent":             "RIA",
    "correspondent_id":          "RIA_001",
    "correspondent_location_id": "RIA_MUMBAI_001"
  }
}
```

Correspondent IDs come from a separate masters lookup — your Digit9 integration manager will share the supported list per country.

### WALLET

```json
{
  "first_name": "...",  "last_name": "...",  "mobile_number": "...",
  "nationality": "...", "relation_code": "...", "receiver_id": [...], "receiver_address": [...],
  "wallet_details": { "wallet_id": "PHL_GCASH_+639171234567" }
}
```

## Idempotency

`agent_transaction_ref_number` is **your** idempotency key. Pass the same value on retry → same response, no duplicate transaction. Generate it once when the user clicks "Confirm" and persist it in your DB *before* calling `createTransaction`. If you get a network timeout, retry with the same value — safe.

The system-generated `transaction_ref_number` (16 chars, in the response) is the canonical ID for *everything afterward* — confirm, enquire, cancel, webhook reconciliation. Store both: your ref for idempotency, theirs for queries.

## Response

Success:

```json
{
  "state":     "ACCEPTED",
  "sub_state": "TRANSACTION_CREATED",
  "data": {
    "transaction_ref_number":      "1234567890123456",
    "agent_transaction_ref_number":"PARTNER_<UUID>",
    "transaction_date":            "2026-04-27T10:18:32Z",
    "expires_at":                  "2026-04-29T10:18:32Z",
    "fx_rates":          { "...": "..." },
    "fee_details":       [ "..." ],
    "settlement_details":{ "...": "..." }
  }
}
```

The transaction is **created but not committed** — the partner must call `confirmTransaction` to actually send funds (see `d9-status`). The transaction expires (typically 24–48h) if not confirmed.

## Errors you'll see

| Code   | Meaning                                                    | What to do                                              |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------- |
| 806500 | UNPROCESSABLE_ENTITY — field-level validation failure      | Read the `errors[]` in body; surface to user            |
| 806600 | Business validation (e.g. KYC mismatch, sanctions hit)     | Surface generic "transaction blocked"; do not retry     |
| 40004  | NOT_FOUND — usually a stale `quote_id`                     | Re-quote (see `d9-quote`); never silently retry         |
| 40001  | UNAUTHORIZED — token expired                               | Refresh token; auth interceptor should handle this      |
| 40000  | BAD_REQUEST — missing context headers                      | Check `sender`/`channel`/`company`/`branch` are set     |
| 50000  | INTERNAL_SERVICE_ERROR                                     | Retry with backoff; if persistent, alert ops            |

## Canonical implementation

### Node / TypeScript

```ts
// src/d9/transaction.ts
import { D9Client } from './client';
import { v4 as uuid } from 'uuid';
import { isQuoteExpired, Quote } from './quote';

export type ServiceType = 'C2C' | 'B2B';

export interface CreateTxnInput {
  quote: Quote;
  serviceType: ServiceType;
  sender: SenderC2C | SenderB2B;
  receiver: ReceiverBank | ReceiverCashPickup | ReceiverWallet;
  sourceOfIncome: string;     // e.g. "SLRY"
  purposeOfTxn:   string;     // e.g. "SUPP"
}

export interface Transaction {
  transactionRefNumber:      string;
  agentTransactionRefNumber: string;
  expiresAt:                 Date;
  raw:                       unknown;
}

export async function createTransaction(d9: D9Client, input: CreateTxnInput): Promise<Transaction> {
  if (isQuoteExpired(input.quote)) {
    throw new Error('Quote expired before createTransaction; re-quote required.');
  }

  const agentRef = `PARTNER_${uuid()}`;

  const body = {
    quote_id:                      input.quote.quoteId,
    service_type:                  input.serviceType,
    agent_transaction_ref_number:  agentRef,
    sender:                        input.sender,    // already shaped per service_type
    receiver:                      input.receiver,  // already shaped per receiving_mode
    transaction: {
      source_of_income: input.sourceOfIncome,
      purpose_of_txn:   input.purposeOfTxn,
    },
  };

  const { data } = await d9.request<any>({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/createtransaction',
    data:   body,
  });

  if (data.state !== 'ACCEPTED') {
    throw new Error(`Unexpected state on createTransaction: ${data.state}/${data.sub_state}`);
  }

  return {
    transactionRefNumber:      data.data.transaction_ref_number,
    agentTransactionRefNumber: data.data.agent_transaction_ref_number,
    expiresAt:                 new Date(data.data.expires_at),
    raw:                       data,
  };
}
```

### Java / Spring Boot

```java
// src/main/java/com/partner/d9/TransactionService.java
@Service
public class TransactionService {
    private final D9Client client;

    public Transaction createTransaction(CreateTxnInput input) {
        if (QuoteService.isExpired(input.quote())) {
            throw new D9IntegrationException("Quote expired before createTransaction; re-quote required.");
        }

        var agentRef = "PARTNER_" + UUID.randomUUID();

        var body = Map.of(
            "quote_id",                     input.quote().quoteId(),
            "service_type",                 input.serviceType().name(),
            "agent_transaction_ref_number", agentRef,
            "sender",                       input.sender(),
            "receiver",                     input.receiver(),
            "transaction", Map.of(
                "source_of_income", input.sourceOfIncome(),
                "purpose_of_txn",   input.purposeOfTxn()));

        var resp = client.http().post()
            .uri("/amr/paas/api/v1_0/paas/createtransaction")
            .bodyValue(body)
            .retrieve()
            .onStatus(s -> s.value() == 422,
                      r -> r.bodyToMono(D9ErrorBody.class).map(D9UnprocessableException::new))
            .bodyToMono(CreateTxnResponse.class)
            .block();

        if (!"ACCEPTED".equals(resp.state())) {
            throw new D9IntegrationException("Unexpected state: " + resp.state() + "/" + resp.subState());
        }

        return new Transaction(
            resp.data().transactionRefNumber(),
            resp.data().agentTransactionRefNumber(),
            Instant.parse(resp.data().expiresAt()),
            resp);
    }
}
```

## Anti-patterns to flag

1. **Generating `agent_transaction_ref_number` inside the API call.** Generate it *before*, persist it, then call. Otherwise a network timeout means you can't retry idempotently — you don't know if the transaction was created.
2. **Mixing C2C and B2B fields in the same sender object.** Pick one shape based on `service_type` and stick to it.
3. **Skipping `account_type_code` for non-PK BANK.** Most common 806500. Always source from masters; never default.
4. **Silent quote re-acquisition on 40004.** That's hiding a UX bug — the user should see "quote expired, please confirm new rate" and explicitly approve.
5. **Storing only `agent_transaction_ref_number`.** You also need `transaction_ref_number` for status calls. Persist both, side by side.
6. **Treating ACCEPTED as final.** It's "created and validated, ready to confirm." Funds aren't moving until `confirmTransaction`.
7. **Floating-point amounts.** Use `BigDecimal` (Java) or string decimals (TS).

## Verification

Ask Claude to run an end-to-end create against sandbox via MCP:

> "Create a sandbox transaction for 100 AED → INR BANK using sender Jane Doe and receiver Priya Sharma."

Claude calls `d9_quote` → `d9_create_txn` and returns the parsed transaction with `transaction_ref_number`. Then run `d9-status` to confirm and track.
