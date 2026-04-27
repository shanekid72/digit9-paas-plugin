# Digit9 PaaS Integration Plugin for Claude Code

A Claude Code plugin that turns integration with Digit9's Payments-as-a-Service API into a guided experience. Designed for **Licensed Financial Institutions (LFIs)** integrating cross-border remittance.

## What this gives you

- **Skills** that teach Claude how Digit9 expects partners to integrate. When you ask Claude "how do I sign a webhook" or "fix this 806500 error," it pulls in the right canonical pattern automatically.
- **Slash commands** for the common entry points — scaffold a new project, run a happy-path sandbox test, validate your integration code.
- **A live MCP server** that lets Claude call the Digit9 sandbox while you're coding. No more guessing at request shapes — Claude verifies against the real API.
- **Starter templates** for Java/Spring Boot and Node.js/TypeScript that follow Digit9's recommended patterns out of the box.

## Install

For pilot partners (private Git distribution):

```bash
claude plugin install git+https://github.com/digitnine/digit9-paas-plugin.git
```

Once GA, the install URL will move to:

```bash
claude plugin install https://plugins.digitnine.com/digit9-paas
```

## Quickstart

```bash
# Inside your project directory:
claude

# Then in the Claude session:
> /d9:scaffold
```

`/d9:scaffold` will ask for your sandbox credentials, scaffold a project in your chosen language, drop in a tuned `CLAUDE.md`, and verify connectivity. After that you can just talk to Claude — the right skill loads when you need it.

## Sandbox credentials

The plugin expects these env vars (the scaffold will create a `.env.example`):

```
D9_BASE_URL=https://drap-sandbox.digitnine.com
D9_CLIENT_ID=cdp_app
D9_CLIENT_SECRET=<from Digit9>
D9_USERNAME=<your sandbox agent>
D9_PASSWORD=<your sandbox password>
D9_SENDER=<your sender code>
D9_CHANNEL=Direct
D9_COMPANY=<your company code>
D9_BRANCH=<your branch code>
```

Reach out to your Digit9 integration contact for production credentials.

## Coverage (v0.1)

Happy path end-to-end for the **PaaS / Cross-Border Payments** product:

1. Auth (OAuth2 password grant, token refresh)
2. Onboarding via embedded web component (sender + KYC)
3. Master data (corridors, banks, branches)
4. Quote (with 10-minute TTL handling)
5. Create transaction (C2C and B2B; BANK / CASHPICKUP / WALLET)
6. Confirm + status polling (+ optional cancel)
7. Webhooks (HMAC verification, idempotency, reconciliation backfill)

Currently scaffolds: **Java/Spring Boot** and **Node/TypeScript**.

## Support

- API docs: <https://developer.digitnine.com>
- Sandbox issues: contact your Digit9 integration manager
- Plugin issues: file in the plugin repo
