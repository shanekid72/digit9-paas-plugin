---
name: d9-master-data
description: Look up Digit9 PaaS master/reference data — supported corridors, banks, branches, account types. Triggers on master data, banks list, branches list, service corridor, country/currency validation, ISO codes, IBAN, account_type_code lookup, "what banks does Digit9 support in <country>", or any pre-quote validation work. Cache lookups locally; do not call these on every transaction.
---

# Digit9 PaaS — Master Data

Master data endpoints describe **what's possible**: which corridors are supported, which banks exist in a receiving country, which branches a bank has, and which account types each bank accepts. Partners use these to drive UI dropdowns, validate user input *before* hitting the quote endpoint, and avoid `806500 UNPROCESSABLE_ENTITY` failures on `createTransaction`.

These responses change rarely — cache aggressively.

## Endpoints

All require the standard auth (Bearer token + the four context headers — see `d9-auth`).

```
GET {D9_BASE_URL}/raas/masters/v1/service-corridor
GET {D9_BASE_URL}/raas/masters/v1/banks?receiving_country_code={code}&receiving_mode={mode}
GET {D9_BASE_URL}/raas/masters/v1/banks/{bank_id}
GET {D9_BASE_URL}/raas/masters/v1/banks/{bank_id}/branches
```

## Service corridor

The corridor list tells you which `(sending_country, receiving_country, receiving_currency, receiving_mode)` tuples are live. Always validate against this before exposing a corridor in your UI — quoting an unsupported corridor returns `40000 BAD_REQUEST` with no helpful message.

Response (shape):

```json
{
  "data": [
    {
      "sending_country_code":   "AE",
      "receiving_country_code": "IN",
      "receiving_currency_code":"INR",
      "receiving_modes":        ["BANK", "CASHPICKUP"]
    },
    { "...": "..." }
  ]
}
```

## Banks lookup

```
GET /raas/masters/v1/banks?receiving_country_code=IN&receiving_mode=BANK
```

Response (the fields that matter):

```json
{
  "data": [
    {
      "bank_id":   "IN_HDFC0000001",
      "bank_name": "HDFC Bank",
      "iso_code":  "HDFCINBB",
      "account_types": [
        { "account_type_code": "01", "account_type_name": "Savings" },
        { "account_type_code": "02", "account_type_name": "Current" }
      ]
    },
    { "...": "..." }
  ]
}
```

The fields a partner *must* retain per bank:

| Field                                      | Used for                                                 |
| ------------------------------------------ | -------------------------------------------------------- |
| `bank_id`                                  | The selected bank in `createTransaction.bank_details`    |
| `iso_code`                                 | Required in `bank_details.iso_code` (SWIFT/BIC)          |
| `account_types[].account_type_code`        | Required in `bank_details.account_type_code` for non-PK  |

## Branches lookup

```
GET /raas/masters/v1/banks/{bank_id}/branches
```

Returns `branch_id`, `branch_code`, `branch_name`, `address`, `city`. Required for receiving countries where branch-level routing matters (Bangladesh, Nepal, Sri Lanka in particular).

## Receiver-field cheat sheet by receiving_mode

This is the single most important table to internalize. The `createTransaction` endpoint will reject any receiver whose shape doesn't match the corridor's mode.

| Field                                | BANK | CASHPICKUP | WALLET |
| ------------------------------------ | :--: | :--------: | :----: |
| `first_name` / `last_name`           |  ✓   |     ✓      |   ✓    |
| `mobile_number`                      |  ✓   |     ✓      |   ✓    |
| `nationality`                        |  ✓   |     ✓      |   ✓    |
| `relation_code`                      |  ✓   |     ✓      |   ✓    |
| `receiver_id[]`                      |  ✓   |     ✓      |   ✓    |
| `receiver_address[]`                 |  ✓   |     ✓      |   ✓    |
| `bank_details.account_number`        |  ✓   |     —      |   —    |
| `bank_details.iso_code`              |  ✓   |     —      |   —    |
| `bank_details.account_type_code`     |  ✓†  |     —      |   —    |
| `bank_details.iban`                  |  PK  |     —      |   —    |
| `cashpickup_details.correspondent`   |  —   |     ✓      |   —    |
| `cashpickup_details.correspondent_id`|  —   |     ✓      |   —    |
| `cashpickup_details.correspondent_location_id` |  —  |  ✓      |  —     |
| `wallet_details.wallet_id`           |  —   |     —      |   ✓    |

† `account_type_code` is required for **non-PK** BANK transfers. For Pakistan, `iban` is required instead.

Use this table to drive client-side validation. Failing to enforce it turns into `806500 UNPROCESSABLE_ENTITY` on `createTransaction`, which is much harder to surface clearly to end users.

## Caching strategy

Master data changes maybe once a quarter (a new bank gets added, a corridor goes live). Don't fetch it per-transaction.

Recommended:

- **Service corridor:** cache 24 hours, in-process or Redis.
- **Banks list per (country, mode):** cache 24 hours.
- **Branches per bank:** cache 24 hours, lazy-loaded on first selection.
- **Cache busting:** add a manual `/admin/refresh-d9-masters` endpoint in your service so ops can clear if Digit9 announces a corridor change mid-day.

## Canonical implementation

### Node / TypeScript

```ts
// src/d9/masters.ts
import { D9Client } from './client';

const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> { value: T; fetchedAt: number; }
const cache = new Map<string, CacheEntry<any>>();

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.value;
  const value = await fetcher();
  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

export interface Bank {
  bankId: string;
  bankName: string;
  isoCode: string;
  accountTypes: { code: string; name: string }[];
}

export async function listBanks(
  d9: D9Client,
  receivingCountryCode: string,
  receivingMode: 'BANK' | 'CASHPICKUP' | 'WALLET',
): Promise<Bank[]> {
  return cached(`banks:${receivingCountryCode}:${receivingMode}`, async () => {
    const { data } = await d9.request<any>({
      method: 'GET',
      url:    '/raas/masters/v1/banks',
      params: { receiving_country_code: receivingCountryCode, receiving_mode: receivingMode },
    });
    return (data.data ?? []).map((b: any) => ({
      bankId:   b.bank_id,
      bankName: b.bank_name,
      isoCode:  b.iso_code,
      accountTypes: (b.account_types ?? []).map((a: any) => ({
        code: a.account_type_code, name: a.account_type_name,
      })),
    }));
  });
}

export async function listBranches(d9: D9Client, bankId: string) {
  return cached(`branches:${bankId}`, async () => {
    const { data } = await d9.request<any>({
      method: 'GET',
      url:    `/raas/masters/v1/banks/${encodeURIComponent(bankId)}/branches`,
    });
    return data.data ?? [];
  });
}
```

### Java / Spring Boot

```java
// src/main/java/com/partner/d9/MasterDataService.java
@Service
public class MasterDataService {
    private final D9Client client;
    private final Cache<String, List<Bank>>     bankCache;
    private final Cache<String, List<Branch>>   branchCache;

    public MasterDataService(D9Client client) {
        this.client = client;
        this.bankCache   = Caffeine.newBuilder().expireAfterWrite(Duration.ofHours(24)).build();
        this.branchCache = Caffeine.newBuilder().expireAfterWrite(Duration.ofHours(24)).build();
    }

    public List<Bank> listBanks(String receivingCountryCode, String receivingMode) {
        var key = receivingCountryCode + ":" + receivingMode;
        return bankCache.get(key, k -> fetchBanks(receivingCountryCode, receivingMode));
    }

    private List<Bank> fetchBanks(String country, String mode) {
        var resp = client.http().get()
            .uri(b -> b.path("/raas/masters/v1/banks")
                       .queryParam("receiving_country_code", country)
                       .queryParam("receiving_mode",         mode)
                       .build())
            .retrieve()
            .bodyToMono(BanksResponse.class)
            .block();
        return resp.data().stream().map(Bank::from).toList();
    }

    public List<Branch> listBranches(String bankId) {
        return branchCache.get(bankId, this::fetchBranches);
    }

    private List<Branch> fetchBranches(String bankId) {
        var resp = client.http().get()
            .uri("/raas/masters/v1/banks/{id}/branches", bankId)
            .retrieve()
            .bodyToMono(BranchesResponse.class)
            .block();
        return resp.data();
    }
}
```

## Anti-patterns to flag

1. **Hardcoded bank lists.** Banks come and go — don't ship a static enum. Always source from `/raas/masters/v1/banks`.
2. **No caching.** Calling masters on every transaction is wasteful and rate-limits you. Cache for at least an hour, ideally 24.
3. **Skipping mode validation client-side.** "We'll let the API tell us if the receiver is invalid" → user gets a generic error 30 seconds into their flow. Validate the receiver shape against the mode *before* you even call quote.
4. **Treating `account_type_code` as optional.** It's required for non-PK BANK. Don't default it to a guessed value — ask the user or block submission.
5. **Caching globally when corridors are partner-specific.** Some Digit9 deployments scope corridors per partner. Key your cache by partner identity, not just country/mode.

## Verification

Ask Claude to dump banks for India via the MCP tool `d9_get_banks`:

> "List the banks Digit9 supports in India for BANK mode."

Claude calls `d9_get_banks(country='IN', mode='BANK')` and returns the parsed list. Use the same tool to confirm before adding a new corridor to your UI.
