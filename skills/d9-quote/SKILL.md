---
name: d9-quote
description: Fetch a Digit9 PaaS remittance quote — exchange rates, fees, settlement details, with a 10-minute TTL. Triggers on quote requests, FX rate parsing, fee calculation (COMMISSION/TAX/TRANSFER_FEE/FX_FEE), quote_id handling, expires_at, "stale quote" errors, or anything that returns sub_state=QUOTE_CREATED. Required reading before createTransaction.
---

# Digit9 PaaS — Quote

A quote locks an FX rate and fee schedule for a proposed transaction. The partner uses the returned `quote_id` to create the actual transaction. **Quotes expire 10 minutes after creation** — this is the most common source of `40004 NOT_FOUND` on `createTransaction`.

## Endpoint

```
POST {D9_BASE_URL}/amr/paas/api/v1_0/paas/quote
Authorization: Bearer <token>
sender / channel / company / branch  (the four context headers — see d9-auth)
Content-Type: application/json
```

## Request body — minimum required fields

```json
{
  "sending_country_code":   "AE",
  "sending_currency_code":  "AED",
  "receiving_country_code": "IN",
  "receiving_currency_code":"INR",
  "sending_amount":         100,
  "receiving_mode":         "BANK",
  "type":                   "SEND",
  "instrument":             "REMITTANCE"
}
```

Notes:

- `receiving_mode` ∈ `{BANK, CASHPICKUP, WALLET}`. The downstream `createTransaction` will require mode-specific receiver fields — see `d9-transaction`.
- `sending_amount` is what the sender pays in the sending currency. To quote by *receiving* amount, use `receiving_amount` instead and omit `sending_amount`.
- The corridor (sending_country, receiving_country, currency pair, mode) must be supported. Use `d9-master-data` to enumerate corridors before exposing them in your UI.

## Response shape (the bits that matter)

```json
{
  "state":     "INITIATED",
  "sub_state": "QUOTE_CREATED",
  "data": {
    "quote_id":             "q_38f1a2c5...",
    "transaction_gmt_date": "2026-04-27T10:15:00Z",
    "expires_at":           "2026-04-27T10:25:00Z",
    "fx_rates": {
      "rate":                 "22.45000000",
      "base_currency_code":   "AED",
      "counter_currency_code":"INR",
      "type":                 "SELL"
    },
    "fee_details": [
      { "type": "COMMISSION",   "model": "OUR",  "currency_code": "AED", "amount": "5.00",  "description": "Service fee" },
      { "type": "TRANSFER_FEE", "model": "OUR",  "currency_code": "AED", "amount": "2.00",  "description": "Transfer fee" },
      { "type": "TAX",          "model": "OUR",  "currency_code": "AED", "amount": "0.35",  "description": "VAT" }
    ],
    "settlement_details": { "...": "..." }
  }
}
```

What the partner has to retain:

| Field                       | Why                                                  |
| --------------------------- | ---------------------------------------------------- |
| `data.quote_id`             | Required input to `createTransaction`                |
| `data.expires_at`           | Drive UI countdown / re-quote logic                  |
| `data.fx_rates.rate`        | Display to user; recompute payout for review         |
| `data.fee_details[]`        | Sum the `OUR`-model fees for total partner cost      |

## Fee model semantics

The `model` field on each fee says **who pays**:

- `OUR`  — partner (and ultimately the sender) pays this fee. Add to total cost.
- `BENE` — beneficiary pays (deducted from receive amount).
- `FLAT` / `PERCENTAGE` — describe how the amount was computed; not a payer signal.

When showing a cost breakdown to the sender, sum `amount` over fees where `model == "OUR"`.

## The 10-minute TTL — handle it deliberately

The quote is valid for 10 minutes from `transaction_gmt_date`. After that, `createTransaction` fails with `40004 NOT_FOUND`.

**Required UX:**

1. Render `expires_at` as a countdown (e.g. "Quote valid for 9:47").
2. At T-60s, warn the user.
3. At T=0, disable the "Confirm & Send" button. Offer a "Refresh quote" action.
4. Never silently re-quote on the user's behalf if the rate moved — show the new rate and require explicit confirmation.

**Server-side:** if a partner backend is brokering the flow, store `quote_id` and `expires_at` together. Reject `createTransaction` requests where `now() >= expires_at` *before* hitting the API — fail fast with a clear "quote_expired" error rather than a 40004.

## Idempotency note

The quote endpoint **is not idempotent**. Submitting the same body twice returns two distinct `quote_id`s with two separate 10-minute windows. Don't replay quote requests as a fallback strategy — cache and reuse.

## Canonical implementation

### Node / TypeScript

```ts
// src/d9/quote.ts
import { D9Client } from './client';

export interface QuoteRequest {
  sendingCountry: string;   // e.g. "AE"
  sendingCurrency: string;  // e.g. "AED"
  receivingCountry: string; // e.g. "IN"
  receivingCurrency: string;// e.g. "INR"
  sendingAmount: number;
  receivingMode: 'BANK' | 'CASHPICKUP' | 'WALLET';
}

export interface Quote {
  quoteId: string;
  expiresAt: Date;
  rate: string;
  ourFeesTotal: number;
  raw: unknown;
}

export async function fetchQuote(d9: D9Client, q: QuoteRequest): Promise<Quote> {
  const { data } = await d9.request<any>({
    method: 'POST',
    url: '/amr/paas/api/v1_0/paas/quote',
    data: {
      sending_country_code:    q.sendingCountry,
      sending_currency_code:   q.sendingCurrency,
      receiving_country_code:  q.receivingCountry,
      receiving_currency_code: q.receivingCurrency,
      sending_amount:          q.sendingAmount,
      receiving_mode:          q.receivingMode,
      type:                    'SEND',
      instrument:              'REMITTANCE',
    },
  });

  if (data.sub_state !== 'QUOTE_CREATED') {
    throw new Error(`Unexpected quote sub_state: ${data.sub_state}`);
  }

  const ourFees = (data.data.fee_details ?? [])
    .filter((f: any) => f.model === 'OUR')
    .reduce((sum: number, f: any) => sum + Number(f.amount), 0);

  return {
    quoteId:      data.data.quote_id,
    expiresAt:    new Date(data.data.expires_at),
    rate:         data.data.fx_rates.rate,
    ourFeesTotal: ourFees,
    raw:          data,
  };
}

export function isQuoteExpired(q: Quote, safetyMs = 5_000): boolean {
  return Date.now() + safetyMs >= q.expiresAt.getTime();
}
```

### Java / Spring Boot

```java
// src/main/java/com/partner/d9/QuoteService.java
@Service
public class QuoteService {
    private final D9Client client;

    public QuoteService(D9Client client) { this.client = client; }

    public Quote fetchQuote(QuoteRequest req) {
        var body = Map.of(
            "sending_country_code",    req.sendingCountry(),
            "sending_currency_code",   req.sendingCurrency(),
            "receiving_country_code",  req.receivingCountry(),
            "receiving_currency_code", req.receivingCurrency(),
            "sending_amount",          req.sendingAmount(),
            "receiving_mode",          req.receivingMode(),
            "type",                    "SEND",
            "instrument",              "REMITTANCE");

        var resp = client.http().post()
            .uri("/amr/paas/api/v1_0/paas/quote")
            .bodyValue(body)
            .retrieve()
            .bodyToMono(QuoteResponse.class)
            .block();

        if (!"QUOTE_CREATED".equals(resp.subState())) {
            throw new D9IntegrationException("Unexpected sub_state: " + resp.subState());
        }

        var ourFees = resp.data().feeDetails().stream()
            .filter(f -> "OUR".equals(f.model()))
            .map(f -> new BigDecimal(f.amount()))
            .reduce(BigDecimal.ZERO, BigDecimal::add);

        return new Quote(
            resp.data().quoteId(),
            Instant.parse(resp.data().expiresAt()),
            resp.data().fxRates().rate(),
            ourFees,
            resp);
    }

    public static boolean isExpired(Quote q) {
        return Instant.now().plusSeconds(5).isAfter(q.expiresAt());
    }
}
```

## Anti-patterns to flag

1. **Re-quoting in a tight loop to "keep it fresh."** Each call creates a new quote on the backend. Cache and respect the 10-minute window.
2. **Auto-replacing the quote silently when it expires.** The user's decision to send is bound to a specific rate — re-quoting without consent is a UX bug at best, a regulatory issue at worst.
3. **Treating the quote_id as a transaction ID.** It isn't. The transaction ID comes from `createTransaction` (see `d9-transaction`).
4. **Floating-point math on amounts.** Use `BigDecimal` (Java) / string-based decimal handling (TS). Money rounded wrong at the quote stage propagates through settlement.
5. **Trusting client-side expiry alone.** Always re-validate expiry on the partner backend before forwarding to `createTransaction`.

## Verification

Ask Claude to run a sample quote against sandbox via the MCP server tool `d9_quote`:

> "Quote me 100 AED to INR via BANK against the sandbox."

Claude will call `d9_quote`, return the parsed quote, and show the expiry. Compare against the OpenAPI spec at `D9-DEV-PORTAL/public/paas-api-spec.json` if response shape ever drifts.
