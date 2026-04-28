---
name: d9-transaction
description: Create a Digit9 PaaS remittance transaction from a quote. Triggers on createTransaction, transaction creation, sender object, receiver object, C2C vs B2B, service_type, agent_customer_number, transaction_ref_number, account_type_code, IBAN, UBO (Ultimate Beneficial Owner), 806500 UNPROCESSABLE_ENTITY, sender_id, receiver_id, source_of_income, purpose_of_txn, or any field-level error from a transaction submission. The most error-prone endpoint in the API.
---

# Digit9 PaaS — Create Transaction

`createTransaction` is the most error-prone endpoint in the PaaS surface. It accepts a top-level body with sender + receiver + transaction sub-objects, the receiver shape varying by **receiving country**. Get any of it wrong and the sandbox returns `40000` with a `details` map naming the bad field. Get the corridor wrong (or wait too long) and you get `40004 NOT_FOUND` because your quote expired.

This skill is the canonical reference. The shapes here are taken verbatim from the PAASTestAgent Postman collection that Digit9 ships with onboarding (`DPS - PAASTestAgent.postman_collection.json`) — when this skill and the collection disagree, the collection wins.

## Endpoint

```
POST {D9_BASE_URL}/amr/paas/api/v1_0/paas/createtransaction
Authorization: Bearer <token>
sender / channel / company / branch  (the four context headers — see d9-auth)
Content-Type: application/json
```

## Top-level request shape

`type`, `instrument`, `source_of_income`, `purpose_of_txn`, and `message` live at the **top level** — not nested inside `transaction`. The `transaction` object only carries `quote_id`.

```json
{
  "type":             "SEND",
  "instrument":       "REMITTANCE",
  "source_of_income": "SLRY",
  "purpose_of_txn":   "SAVG",
  "message":          "Agency transaction",
  "sender":           { /* see "Sender object" */ },
  "receiver":         { /* see "Receiver object — varies by receiving country" */ },
  "transaction": {
    "quote_id": "5706126111718670"
  }
}
```

There is **no top-level `service_type`** field and **no `agent_transaction_ref_number`** in the canonical happy-path body. Idempotency is keyed off `agent_customer_number` on the sender (your stable customer ID), and Digit9 derives the rest from the quote.

## Sender object

The Postman collection shows one sender shape across all corridors — keyed off `agent_customer_number`. Use this for the standard agency transaction:

```json
{
  "agent_customer_number": "987612349876",
  "mobile_number":         "+971508359468",
  "first_name":            "George",
  "last_name":             "Micheal",
  "date_of_birth":         "1995-08-22",
  "country_of_birth":      "IN",
  "nationality":           "IN",
  "sender_id": [
    {
      "id_code":       "4",
      "id":            "784199191427626",
      "issued_on":     "2022-10-31",
      "valid_through": "2030-11-01"
    }
  ],
  "sender_address": [
    {
      "address_type": "PRESENT",
      "address_line": "Sheikh Zayed Road, Tower 3",
      "post_code":    "710",
      "town_name":    "DUBAI",
      "country_code": "AE"
    }
  ]
}
```

**Sender field rules — the ones that bite:**

- `agent_customer_number` is your stable identifier for this sender — persist it, reuse it across that customer's future transactions. It's how Digit9 matches repeat senders for monitoring and limits.
- `sender_id[].id_code` is **numeric**, not a string label. The Postman example uses `"4"` (Emirates ID, 15-digit ID number) for AE-origin senders — that is the only value verified end-to-end against the live sandbox by this plugin. Other values you'll see cited (e.g. `"15"` for non-Emirates government IDs) are **not verified** — do not assume; fetch the live enum via `GET /amr/paas/api/v1_0/paas/codes?code=id_types` and validate against that.

#### id_code values are tenant-configured

The codes accepted for `id_types` are tenant-configured. Always fetch the live enum at runtime via `GET /amr/paas/api/v1_0/paas/codes?code=id_types` and validate the partner-supplied `id_code` against that response, not against examples in this skill. The only `id_code` value confirmed end-to-end against the sandbox in this plugin's test harness is `"4"` (Emirates ID); every other value should be validated against the live `/paas/codes?code=id_types` enum before sending.
- `sender_id[].id` (the actual ID number) is named `id`, **not** `id_number`.
- Date fields are `issued_on` / `valid_through` (`YYYY-MM-DD`), **not** `issue_date` / `expiry_date`. `valid_through` must be in the future or today — past dates fail with `40000`.
- `sender_address[].address_type` is `"PRESENT"` (current) or `"PERMANENT"` — not `"RES"` / `"BIZ"`.
- Postal code is `post_code`, city is `town_name` — not `postal_code` / `city`.

### B2B sender

The PAASTestAgent Postman collection does **not** include a B2B example — every transaction in it uses the consumer-style sender above. If your tenant is configured for B2B (legal entity sender + UBO list), ask Digit9 ops for the canonical B2B body shape rather than guessing. The names sometimes cited in older docs (`name`, `type_of_business`, `country_of_incorporation`, `sender_ubos[]`, plus a `TRN` in `sender_id`) **are not verified against the current sandbox** — confirm against a current Postman example before shipping.

## Receiver object — varies by receiving country

The shape is keyed off the **receiving country**, which is baked into the quote. The Postman collection ships three concrete examples (IN, PK, BD), all `receiving_mode: "BANK"`. Use the matching one.

### IN — bank transfer (NEFT/IMPS, IFSC routing)

```json
{
  "first_name":     "Anija FirstName",
  "last_name":      "Anija Lastname",
  "mobile_number":  "+919586741500",
  "date_of_birth":  "1990-08-22",
  "gender":         "F",
  "nationality":    "IN",
  "relation_code":  "32",
  "receiver_address": [
    {
      "address_type": "PRESENT",
      "address_line": "12 MG Road",
      "town_name":    "THRISSUR",
      "country_code": "IN"
    }
  ],
  "bank_details": {
    "account_type_code": "1",
    "routing_code":      "FDRL0001033",
    "account_number":    "99345724439934"
  }
}
```

- `routing_code` is the **IFSC**. No `iso_code`, no `bank_id`.
- `account_type_code` is numeric-as-string (`"1"` = savings; full enum via `/paas/codes?code=account_types`).

### PK — bank transfer (IBAN routing)

```json
{
  "first_name":    "Anija FirstName",
  "last_name":     "Anija Lastname",
  "mobile_number": "+923001234567",
  "date_of_birth": "1990-08-22",
  "gender":        "F",
  "nationality":   "PK",
  "relation_code": "32",
  "receiver_address": [
    {
      "address_type": "PRESENT",
      "address_line": "Block 5, F-7",
      "town_name":    "ISLAMABAD",
      "country_code": "PK"
    }
  ],
  "bank_details": {
    "account_type_code": "1",
    "iso_code":          "ALFHPKKAXXX",
    "iban":              "PK12ABCD1234567891234567"
  }
}
```

- PK uses **`iban`** (24 chars after the `PK<2-digit-check>`) — **not** `account_number`.
- Routing is via **`iso_code`** (the SWIFT/BIC) — no `routing_code`.

### BD — bank transfer (SWIFT routing + account number)

```json
{
  "first_name":    "Anija FirstName",
  "last_name":     "Anija Lastname",
  "mobile_number": "+8801712345678",
  "date_of_birth": "1990-08-22",
  "gender":        "F",
  "nationality":   "BD",
  "relation_code": "32",
  "receiver_address": [
    {
      "address_type": "PRESENT",
      "address_line": "House 12, Road 4, Dhanmondi",
      "town_name":    "DHAKA",
      "country_code": "BD"
    }
  ],
  "bank_details": {
    "account_type_code": "1",
    "iso_code":          "ABBLBDDH201",
    "account_number":    "9934572443993487"
  }
}
```

- BD uses **`iso_code`** (SWIFT, often with a 3-digit branch suffix like `ABBLBDDH201`) **plus** `account_number`. No `routing_code`, no `iban`.

### Cheat sheet — receiver bank routing per country

| Country | `routing_code` | `iso_code` | `account_number` | `iban` |
| ------- | -------------- | ---------- | ---------------- | ------ |
| IN      | ✓ (IFSC)       | —          | ✓                | —      |
| PK      | —              | ✓ (SWIFT)  | —                | ✓      |
| BD      | —              | ✓ (SWIFT)  | ✓                | —      |
| Others  | confirm with Digit9 ops; the collection has no example | | | |

`relation_code` is numeric (e.g. `"32"` = friend, `"01"` = spouse — verify enum via `/paas/codes?code=relations`).

### CASHPICKUP and WALLET

The PAASTestAgent collection has **no CASHPICKUP or WALLET examples**. Older docs name `cashpickup_details.{correspondent, correspondent_id, correspondent_location_id}` and `wallet_details.{wallet_id}`, but those shapes are **not verified against the current sandbox**. If your tenant supports cash pickup or wallet payout, ask Digit9 ops for a current Postman example before implementing — don't guess from generic docs.

## Idempotency

Idempotency is keyed off `sender.agent_customer_number` plus the `quote_id`. Calling `createtransaction` a second time with the same `agent_customer_number` against the same `quote_id` returns the existing transaction (same `transaction_ref_number`). On a network timeout, retry with the same body — safe.

The system-generated `transaction_ref_number` (16 chars, in the response) is the canonical ID for **everything afterward** — confirm, enquire, cancel, webhook reconciliation. Persist both: your `agent_customer_number` (for replay matching) and theirs (for queries).

## Response

Success — note `state: "ACCEPTED"`, `sub_state: "ORDER_ACCEPTED"`:

```json
{
  "status":      "success",
  "status_code": 200,
  "data": {
    "state":     "ACCEPTED",
    "sub_state": "ORDER_ACCEPTED",
    "transaction_ref_number":   "5706126111718670",
    "agent_ref_number":         "5706126111718670",
    "delivery_ref_number":      "5706126111718670",
    "transaction_date":         "2026-04-27T17:44:05.761+04:00",
    "expires_at":               "2026-04-27T19:44:05.761+04:00",
    "receiving_country_code":   "IN",
    "receiving_currency_code":  "INR",
    "sending_country_code":     "AE",
    "sending_currency_code":    "AED",
    "sending_amount":           100,
    "receiving_amount":         2442.15,
    "total_payin_amount":       107.35,
    "transfer_mode":            "NEFT",
    "fx_rates":                 [ /* SELL rates both directions */ ],
    "fee_details":              [ /* COMMISSION, TAX, ... */ ],
    "settlement_details":       [ /* values per charge_type */ ]
  }
}
```

The transaction is **created and reserved** but **not committed** — the partner must call `confirmtransaction` to actually move funds (see `d9-status`). The transaction expires at `expires_at` (typically ~2h from create) if not confirmed.

## Errors you'll see

The sandbox wraps every error in this envelope:

```json
{
  "status":      "failure",
  "status_code": 400,
  "error_code":  40000,
  "message":     "Payload parameter is missing or corrupt",
  "details":     { "sender.sender_id[0].valid_through": "Invalid value, must be in the future or the present" }
}
```

**`details` is where the actionable info lives.** A wrapper that drops it (or surfaces only `message`) will hide the real reason behind a generic-looking 400 — always log and surface `details`.

| Code   | Meaning                                                    | What to do                                              |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------- |
| 40000  | Field-level validation failed, OR missing context headers  | Read `details` map; surface to user                     |
| 806500 | UNPROCESSABLE_ENTITY (business validation, e.g. limit)     | Read `errors[]` if present; surface generic reject      |
| 806600 | Compliance reject (KYC mismatch, sanctions hit)            | Surface generic "transaction blocked"; do not retry     |
| 40004  | NOT_FOUND — usually a stale `quote_id`                     | Re-quote (see `d9-quote`); never silently retry         |
| 40001  | UNAUTHORIZED — token expired                               | Refresh token; auth interceptor should handle this      |
| 50000  | INTERNAL_SERVICE_ERROR                                     | Retry with backoff; if persistent, alert ops            |

### Misleading errors

A `40000` whose `details` map names a `sender_id` field path with the message `"required data is missing"` **usually means the value isn't in the accepted enum**, not that the field is literally absent from the request body.

Concrete example, captured live: sending `{"id_code": "15", "id": "GB1234567", ...}` returned

```
sender.sender_id.idcode: [COM] Invalid request: required data is missing
```

even though `id_code` was present. The same body with `id_code: "4"` (Emirates ID — the verbatim Postman example) succeeded and returned `transaction_ref_number=5706126111845722`. The sandbox phrases enum-rejection as "required data is missing" — when you see that on a `sender_id` path, first check the value against `/paas/codes?code=id_types` before you go hunting for a missing field.

## Canonical implementation

### Node / TypeScript

```ts
// src/d9/transaction.ts
import { D9Client } from './client';
import { isQuoteExpired, Quote } from './quote';

export interface SenderId {
  id_code:       string;     // numeric-as-string, from /paas/codes?code=id_types
  id:            string;
  issued_on:     string;     // YYYY-MM-DD
  valid_through: string;     // YYYY-MM-DD, must be today or later
}

export interface Address {
  address_type: 'PRESENT' | 'PERMANENT';
  address_line: string;
  post_code:    string;
  town_name:    string;
  country_code: string;
}

export interface Sender {
  agent_customer_number: string;
  mobile_number:         string;
  first_name:            string;
  last_name:             string;
  date_of_birth:         string;     // YYYY-MM-DD
  country_of_birth:      string;
  nationality:           string;
  sender_id:             SenderId[];
  sender_address:        Address[];
}

export type ReceiverBankIN = { account_type_code: string; routing_code: string; account_number: string };
export type ReceiverBankPK = { account_type_code: string; iso_code: string; iban: string };
export type ReceiverBankBD = { account_type_code: string; iso_code: string; account_number: string };

export interface Receiver {
  first_name:       string;
  last_name:        string;
  mobile_number:    string;
  date_of_birth:    string;
  gender:           'M' | 'F';
  nationality:      string;
  relation_code:    string;             // from /paas/codes?code=relations
  receiver_address: Address[];
  bank_details:     ReceiverBankIN | ReceiverBankPK | ReceiverBankBD;
}

export interface CreateTxnInput {
  quote:          Quote;
  sender:         Sender;
  receiver:       Receiver;
  sourceOfIncome: string;       // e.g. "SLRY"
  purposeOfTxn:   string;       // e.g. "SAVG"
  message?:       string;       // free-text, defaults to "Agency transaction"
}

export interface Transaction {
  transactionRefNumber: string;
  expiresAt:            Date;
  raw:                  unknown;
}

export async function createTransaction(d9: D9Client, input: CreateTxnInput): Promise<Transaction> {
  if (isQuoteExpired(input.quote)) {
    throw new Error('Quote expired before createTransaction; re-quote required.');
  }

  const body = {
    type:             'SEND',
    instrument:       'REMITTANCE',
    source_of_income: input.sourceOfIncome,
    purpose_of_txn:   input.purposeOfTxn,
    message:          input.message ?? 'Agency transaction',
    sender:           input.sender,
    receiver:         input.receiver,
    transaction:      { quote_id: input.quote.quoteId },
  };

  const { data } = await d9.request<any>({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/createtransaction',
    data:   body,
  });

  if (data.data?.state !== 'ACCEPTED') {
    throw new Error(`Unexpected state on createTransaction: ${data.data?.state}/${data.data?.sub_state}`);
  }

  return {
    transactionRefNumber: data.data.transaction_ref_number,
    expiresAt:            new Date(data.data.expires_at),
    raw:                  data,
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

        var body = Map.of(
            "type",             "SEND",
            "instrument",       "REMITTANCE",
            "source_of_income", input.sourceOfIncome(),
            "purpose_of_txn",   input.purposeOfTxn(),
            "message",          input.message() != null ? input.message() : "Agency transaction",
            "sender",           input.sender(),
            "receiver",         input.receiver(),
            "transaction",      Map.of("quote_id", input.quote().quoteId()));

        var resp = client.http().post()
            .uri("/amr/paas/api/v1_0/paas/createtransaction")
            .bodyValue(body)
            .retrieve()
            .onStatus(s -> s.value() == 400,
                      r -> r.bodyToMono(D9ErrorBody.class).map(D9ValidationException::new))
            .bodyToMono(CreateTxnResponse.class)
            .block();

        if (!"ACCEPTED".equals(resp.data().state())) {
            throw new D9IntegrationException(
                "Unexpected state: " + resp.data().state() + "/" + resp.data().subState());
        }

        return new Transaction(
            resp.data().transactionRefNumber(),
            Instant.parse(resp.data().expiresAt()),
            resp);
    }
}
```

## Anti-patterns to flag

1. **Putting `source_of_income` / `purpose_of_txn` inside `transaction`.** They are top-level. Same for `type`, `instrument`, `message`. Only `quote_id` lives in `transaction`.
2. **Using `bank_id` / `branch_id` for the receiver.** Those fields do not appear in the canonical bodies. Use `routing_code` (IN), `iso_code` + `iban` (PK), or `iso_code` + `account_number` (BD).
3. **Using `id_number` / `issue_date` / `expiry_date` on `sender_id`.** Names are `id` / `issued_on` / `valid_through`.
4. **Past `valid_through` date on a sender ID.** Sandbox rejects with `40000` — `valid_through` must be today or later. Watch out for stale fixtures from old Postman runs.
5. **Treating `details` as optional in the error path.** The `details` map (or `errors[]` for some endpoints) is the only way to know which field was rejected. Always log and surface it.
6. **Treating `ACCEPTED` as final.** It's "created and reserved, ready to confirm." Funds aren't moving until `confirmtransaction`.
7. **Skipping `account_type_code` for non-PK BANK.** Most common 40000. Always source from `/paas/codes?code=account_types`; never default.
8. **Floating-point amounts.** Use `BigDecimal` (Java) or string decimals (TS).

## Verification

Ask Claude to run an end-to-end create against sandbox via MCP:

> "Create a sandbox AE→IN BANK transaction for 100 AED."

Claude calls `d9_quote` → `d9_create_txn` and returns the parsed transaction with `transaction_ref_number`. Then run `d9-status` to confirm and track. Or run the bundled `/digit9-paas:d9-test` command for the full happy path.
