# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This repo **is** the `digit9-paas` Claude Code plugin (not an app that uses one). Editing files here changes how Claude behaves for partner LFIs integrating Digit9's PaaS cross-border remittance API. The plugin is installed via Git/marketplace and consumed by other Claude Code sessions.

`CLAUDE.md.template` is **not** this file — it is rendered into a partner's project by the `/digit9-paas:d9-scaffold` command (placeholders like `{{PROJECT_NAME}}` are filled in there). Don't confuse the two; instructions for partners go in the template, instructions for plugin developers go here.

## Common commands

The plugin itself has no top-level build. The only thing to build is the bundled MCP server:

```bash
cd mcp/digit9-sandbox-server
npm install
npm run build      # compiles TS → dist/  (committed to the repo)
npm run typecheck  # tsc --noEmit
npm run dev        # tsx src/index.ts (for local iteration)
```

`dist/` is intentionally checked in so partners don't have to compile on install (`plugin.json` points `mcpServers.digit9-sandbox.args` at `dist/index.js`). After any change under `mcp/digit9-sandbox-server/src/`, rebuild and commit `dist/` in the same change.

There are no unit tests in this repo. The end-to-end test is the `/digit9-paas:d9-test` slash command run from a scaffolded partner project against the live sandbox — see `commands/d9-test.md` for the full pass/fail flow.

## High-level architecture

Three surfaces, all loosely coupled but **must stay aligned on Digit9 API shapes**:

1. **Skills** (`skills/<name>/SKILL.md`) — Markdown with YAML frontmatter (`name`, `description`). Claude auto-loads them when a user prompt matches the trigger keywords in `description`. Each skill is the canonical reference for one surface area: `d9-auth`, `d9-master-data`, `d9-quote`, `d9-transaction`, `d9-status`, `d9-webhooks`, `d9-onboard`. Skills include canonical Node and Java code samples and an "Anti-patterns" list consumed by `/digit9-paas:d9-validate`.

2. **MCP server** (`mcp/digit9-sandbox-server/`) — Node/TypeScript server (MCP over stdio) exposing eight tools (`d9_get_token`, `d9_get_corridors`, `d9_get_banks`, `d9_quote`, `d9_create_txn`, `d9_confirm_txn`, `d9_enquire_txn`, `d9_simulate_webhook`) that wrap real sandbox endpoints. All tools share a `D9Client` singleton (`src/client.ts`) which: fetches/caches the OAuth2 token (30-second safety margin), injects the four required context headers (`sender`, `channel`, `company`, `branch`) on every request via an axios interceptor, and normalizes errors into the `Digit9 <code>: <message> — <field>: <reason>` shape that callers see. Configuration is env-only (see `plugin.json` for the full list); `D9_WEBHOOK_SECRET` is optional and only needed for `d9_simulate_webhook`. Each tool file declares `name`, `description`, JSON-Schema `inputSchema`, and `execute(args)`; `index.ts` registers them all with the SDK's `Server`.

3. **Templates** (`templates/{node-ts,java-spring}/`) — Starter projects copied verbatim into a partner's directory by `/digit9-paas:d9-scaffold`. They contain placeholder tokens (`{{PROJECT_NAME}}`, `{{LANGUAGE}}`, `{{SERVICE_TYPE}}`, `{{DEFAULT_CORRIDOR}}`) substituted at scaffold time. The Node template is ESM + Express; the Java template is Spring Boot 3 with WebClient.

**Cross-cutting invariant:** when a Digit9 API shape changes (e.g., a field rename in `createtransaction`), update **all three** surfaces in the same change — the skill code sample, the MCP tool's `inputSchema` and request body, and the matching service in both templates. The skills act as the source of truth that human reviewers cite during `/digit9-paas:d9-validate`, so they are the most important to keep accurate.

**Source of truth for API shapes:** Digit9 ships a Postman collection (`DPS - PAASTestAgent.postman_collection.json`) with onboarding. When a skill and the Postman collection disagree, the collection wins — see the note at the top of `skills/d9-transaction/SKILL.md`. Don't invent field names from generic remittance docs; the sandbox rejects with `40000 BAD_REQUEST` and a `details` map naming the bad field.

## Slash commands

`commands/d9-*.md` files become `/digit9-paas:d9-*` (note the plugin-prefixed namespace — the partner-facing template README and the `CLAUDE.md.template` use the namespaced form). The four commands and their entry points:

- `/digit9-paas:d9-scaffold` — bootstrap a partner project; calls templates and `CLAUDE.md.template`.
- `/digit9-paas:d9-auth-check` — verify env vars + sandbox auth via `d9_get_token`.
- `/digit9-paas:d9-test` — full happy-path E2E (auth → masters → quote → create → confirm → poll → webhook sim).
- `/digit9-paas:d9-validate` — review partner integration code against each skill's anti-pattern list.

## Plugin distribution

`plugin.json` is the manifest (name, version, description, `mcpServers`). `.claude-plugin/marketplace.json` advertises this repo as a single-plugin marketplace so partners can `claude plugin install <marketplace-url>`. The pilot install path is `git+https://github.com/digitnine/digit9-paas-plugin.git`; GA will move to `https://plugins.digitnine.com/digit9-paas`. See `ROLLOUT_CHECKLIST.md` for the staged rollout (private repo → MCP build → self-test → pilots → GA).

## Conventions worth knowing

- The four context headers are injected once in `D9Client` — never set per-call. Same pattern in the skill code samples and both templates.
- `agent_customer_number` (sender field), not `agent_transaction_ref_number`, is the idempotency key on `createtransaction`. The system-generated 16-char `transaction_ref_number` is the canonical ID for everything afterward.
- Quote TTL is 10 minutes. Stale quotes return `40004 NOT_FOUND` on `createtransaction` — never silently retry; re-quote.
- Webhook signature: HMAC-SHA256 over the **raw body bytes**, not the parsed-then-stringified JSON. Failure is `401`, not `200`.
- Receiver `bank_details` shape varies by receiving country (IN: `routing_code`+`account_number`; PK: `iso_code`+`iban`; BD: `iso_code`+`account_number`). The cheat sheet is in `skills/d9-transaction/SKILL.md` — keep it in sync if Digit9 adds corridors.
- Error envelopes carry actionable info in `details` (object) or `errors` (array). The MCP `D9Client.normalizeAxiosError` formats both into the surfaced message; partner code samples must do the same.
