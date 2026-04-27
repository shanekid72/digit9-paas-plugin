---
description: Bootstrap a new Digit9 PaaS partner integration project — picks a language, scaffolds boilerplate, wires up sandbox credentials, and verifies connectivity.
---

You are running the `/d9:scaffold` command for a partner about to integrate with Digit9 PaaS. Your job is to bootstrap their project so they can start writing business logic, not boilerplate.

## Step 1 — Confirm we're in the right place

Check the current working directory. If it already contains a substantial project (a `package.json` with their own dependencies, a `pom.xml` with their groupId, source files outside of any D9-related folder), pause and ask the user:

> "This directory looks like an existing project. Should I scaffold the Digit9 integration as a sub-folder (e.g. `./d9-integration/`) or are you sure you want to scaffold at the root?"

Default to scaffolding into `./d9-integration/` if they confirm an existing project.

## Step 2 — Ask the partner three questions

Use AskUserQuestion to collect:

1. **Language** — Java/Spring Boot 3.x (Maven) or Node.js/TypeScript (ESM, Express). Use the templates in the plugin's `templates/java-spring/` or `templates/node-ts/` directory.

2. **Service type** — C2C (consumer-to-consumer remittance) or B2B (business-to-business). Affects DTO shapes and which sample sender object goes into the example test.

3. **Default corridor** — pick from `AE→IN BANK`, `AE→PK BANK`, `AE→BD BANK`, `AE→PH CASHPICKUP`, `AE→LK BANK`, `AE→NP BANK`. Stored in `CLAUDE.md` so generated samples target the right country.

## Step 3 — Collect sandbox credentials

Ask the partner to paste their sandbox credentials. Required:

- `D9_CLIENT_ID` (default suggestion: `cdp_app` for sandbox)
- `D9_CLIENT_SECRET`
- `D9_USERNAME`
- `D9_PASSWORD`
- `D9_SENDER`
- `D9_COMPANY`
- `D9_BRANCH`
- `D9_WEBHOOK_SECRET` (may not be issued yet — accept blank, note it for later)

**Critical:** never commit these. Write to `.env` (gitignored) and create `.env.example` with empty values. Confirm `.env` is in `.gitignore`.

## Step 4 — Generate from template

Copy the chosen language template into the project root:

- Java: copy `templates/java-spring/` contents.
- Node: copy `templates/node-ts/` contents.

Substitute placeholders:
- `{{PROJECT_NAME}}` — derive from current directory name
- `{{LANGUAGE}}` — `Java/Spring Boot` or `Node/TypeScript`
- `{{SERVICE_TYPE}}` — `C2C` or `B2B`
- `{{DEFAULT_CORRIDOR}}` — e.g. `AE→IN BANK`
- `{{PARTNER_PREFIX}}` — derive from project name (e.g. project `lfi-d9-integration` → prefix `LFI`)

Drop the rendered `CLAUDE.md.template` into the project root as `CLAUDE.md`.

## Step 5 — Verify

Run `/d9:auth-check` automatically. Report success/failure clearly. If it fails:

- 401 invalid_grant → wrong username/password; ask them to recheck
- 401 invalid_client → wrong client_secret
- timeout / DNS → check `D9_BASE_URL`, network/VPN

Do not declare scaffolding "done" until auth-check passes. A scaffold that can't authenticate is worse than no scaffold.

## Step 6 — Report and hand off

Report what was created (file count, key files), what the next sensible step is (e.g. "try `/d9:test` for an end-to-end run, or just ask Claude to add an API endpoint that calls quote"), and remind the partner of the four required env vars they shouldn't commit.

## Failure modes to handle gracefully

- Partner already has a `.env` — merge, don't overwrite. Ask before changing existing keys.
- Java template chosen but partner has no Java/Maven installed — note it but proceed; they may install later.
- Partner has neither Node nor Java — pause and ask which they intend to install.
- Partner pastes credentials with surrounding whitespace or quotes — strip them silently.
