---
description: Review the partner's integration code against Digit9 patterns and the anti-pattern lists in each skill. Produces a prioritized report — blockers, warnings, and nice-to-have improvements.
---

You are running the `/digit9-paas:d9-validate` command. Your job is to review the partner's existing integration code against the canonical patterns in the `digit9-paas` plugin's skills, and produce a prioritized findings report.

## Scope

Focus the review on files that touch Digit9. Look for:

- Any file under `src/d9/`, `src/main/java/com/partner/d9/`, or `src/integrations/digit9/`
- Webhook handlers (search for `webhook`, `digit9`, `D9` references)
- Configuration files (`application.yml`, `.env`, `.env.example`)
- Any `D9Client` / `Digit9Client` / `RemittanceClient` class

Skip business logic that doesn't touch Digit9.

## Anti-pattern checklist (drawn from the skills)

For each finding, classify as BLOCKER / WARNING / SUGGESTION.

### From `d9-auth`

- [ ] BLOCKER — Token fetched per-call (no caching)
- [ ] BLOCKER — Required headers (`sender`/`channel`/`company`/`branch`) missing or set per-call instead of via interceptor/filter
- [ ] BLOCKER — `client_secret` or other credentials hardcoded
- [ ] WARNING — No safety margin on token expiry (must refresh ≥30s before `expires_in`)
- [ ] WARNING — Access token logged in cleartext anywhere
- [ ] SUGGESTION — Refresh token never used; only password grant on every renewal

### From `d9-master-data`

- [ ] WARNING — Hardcoded bank lists / static enums for banks or corridors
- [ ] WARNING — No caching on masters lookups (called per-transaction)
- [ ] WARNING — Receiver shape not validated client-side against `receiving_mode`

### From `d9-quote`

- [ ] BLOCKER — Quote re-fetched silently on expiry without user confirmation
- [ ] WARNING — Quote TTL not surfaced in UI / no countdown
- [ ] BLOCKER — Floating-point math on amounts (use BigDecimal / decimal strings)
- [ ] SUGGESTION — Server-side expiry check missing (relies on client only)

### From `d9-transaction`

- [ ] BLOCKER — `agent_transaction_ref_number` generated *inside* the API call (not before)
- [ ] BLOCKER — Missing `account_type_code` for non-PK BANK transfers
- [ ] BLOCKER — IBAN missing for PK BANK transfers
- [ ] BLOCKER — Mixing C2C and B2B sender fields
- [ ] WARNING — Storing only one of `transaction_ref_number` / `agent_transaction_ref_number`
- [ ] SUGGESTION — No structured error parsing of 806500 `errors[]` body

### From `d9-status`

- [ ] BLOCKER — Polling without backoff or timeout cap
- [ ] WARNING — No reconciliation backfill (relying solely on webhooks)
- [ ] WARNING — Auto-retrying on `state=FAILED`
- [ ] SUGGESTION — UI ignores `sub_state` (only displays `state`)

### From `d9-webhooks`

- [ ] BLOCKER — Returning `200 OK` on signature failure (must be 401)
- [ ] BLOCKER — HMAC computed over parsed JSON instead of raw body bytes
- [ ] BLOCKER — No timestamp window check (replay vulnerability)
- [ ] BLOCKER — No idempotency dedupe by `Idempotency-Key`
- [ ] WARNING — Acknowledging before processing (loss-of-event risk on crash)
- [ ] WARNING — Slow webhook handler (>5s; will time out)
- [ ] SUGGESTION — Webhook secret not rotated in over 12 months

## Report format

Output a single markdown report in this shape:

```
# Digit9 Integration Review

**Project:** {{project name}}
**Reviewed:** {N} files

## Blockers ({count})
1. **{file}:{line}** — {anti-pattern} — {one-line fix}
   ```
   {short code excerpt}
   ```

## Warnings ({count})
...

## Suggestions ({count})
...

## What looks good
- {positive observation 1}
- {positive observation 2}

## Suggested next step
- {what to fix first}
```

Keep findings concrete: cite the file path and line number. For each, point at the relevant skill so the partner can read the canonical pattern (e.g. "see `d9-webhooks` § Verification — non-negotiable").

## Don't-do's

- Don't restate the entire skill in the report. Link to it by name.
- Don't flag 100% of the boilerplate. The partner asked for a review, not a re-implementation.
- Don't mark something a BLOCKER unless it's a security, correctness, or compliance issue. Style preferences are SUGGESTIONS at most.
- Don't rewrite the code unless the partner explicitly asks.
