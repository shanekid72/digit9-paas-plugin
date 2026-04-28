---
description: Bootstrap a new Digit9 PaaS partner integration project — picks a language, scaffolds boilerplate, wires up sandbox credentials, and verifies connectivity.
---

You are running the `/digit9-paas:d9-scaffold` command for a partner about to integrate with Digit9 PaaS. Your job is to bootstrap their project so they can start writing business logic, not boilerplate.

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

Drop the rendered `CLAUDE.md.template` into the project root as `CLAUDE.md`.

## Step 5 — Wire up the MCP server (.mcp.json)

The plugin's `digit9-sandbox` MCP server is what gives Claude typed tool access to the sandbox — calling `d9_quote` / `d9_create_txn` directly instead of generating curl commands. It's launched per-project from a `.mcp.json` at the project root, pointing at the plugin's compiled `dist/index.js`. **Without this file, partners get the degraded experience: Claude falls back to direct HTTP and the plugin's headline value is lost.**

### 5a. Find the plugin's local clone path

Run in the partner's shell:

```bash
claude plugin marketplace list
```

Look for the `digitnine` marketplace. The `source` field is the absolute path to the partner's local clone of `digit9-paas-plugin/`. If the partner installed via the public dev portal instructions, this is wherever they ran `git clone`.

If `marketplace list` doesn't show a path (e.g. the plugin was installed via a remote marketplace URL rather than a local path), ask the partner: "Where on your machine did you clone the `digit9-paas-plugin` repo?" Accept the absolute path they provide.

### 5b. Write `.mcp.json` at the project root

Use forward slashes in `args` even on Windows — Node tolerates them and they avoid JSON-escaping headaches with `\\`.

Inline the env values from the partner's `.env` (don't use `${env:...}` references — Claude Code requires the env var to be set in the shell at launch time, which is friction we don't need on the partner's first session).

Template (substitute the bracketed values):

```json
{
  "mcpServers": {
    "digit9-sandbox": {
      "command": "node",
      "args": ["<plugin-clone-path>/mcp/digit9-sandbox-server/dist/index.js"],
      "env": {
        "D9_BASE_URL":      "https://drap-sandbox.digitnine.com",
        "D9_CLIENT_ID":     "<from .env>",
        "D9_CLIENT_SECRET": "<from .env>",
        "D9_USERNAME":      "<from .env>",
        "D9_PASSWORD":      "<from .env>",
        "D9_SENDER":        "<from .env>",
        "D9_CHANNEL":       "Direct",
        "D9_COMPANY":       "<from .env>",
        "D9_BRANCH":        "<from .env>"
      }
    }
  }
}
```

**Critical: write `.mcp.json` as UTF-8 *without* BOM.** Windows PowerShell's `Set-Content -Encoding UTF8` writes BOM, which the Claude Code marketplace loader rejects with `Unrecognized token '﻿'`. On Windows PowerShell 5.1, use:

```powershell
[System.IO.File]::WriteAllText($path, $json, [System.Text.UTF8Encoding]::new($false))
```

On PowerShell 7+, `Out-File -Encoding utf8NoBOM` works. On macOS/Linux, `printf '%s' "$json" > .mcp.json` is fine.

### 5c. Add `.mcp.json` to `.gitignore`

Because it inlines secrets from `.env`, treat it the same way:

```
.mcp.json
```

(`.env` is already gitignored from Step 3.)

### 5d. Tell the partner to restart Claude Code

The `.mcp.json` is read at session start. Direct them to `/exit` and re-run `claude` in the project directory. They'll be prompted with **"Trust this project's MCP servers?"** — they should approve. After approval, Step 6's auth-check (and every subsequent partner workflow) will use typed MCP tool calls instead of falling back to direct HTTP.

## Step 6 — Verify

Run `/digit9-paas:d9-auth-check` automatically. Report success/failure clearly. If it fails:

- 401 invalid_grant → wrong username/password; ask them to recheck
- 401 invalid_client → wrong client_secret
- timeout / DNS → check `D9_BASE_URL`, network/VPN
- "Tool d9_get_token not found" or Claude falling back to curl → `.mcp.json` from Step 5 didn't load. Confirm the file exists at the project root, the args path resolves to a real `dist/index.js`, and the partner approved the trust prompt after restart.

Do not declare scaffolding "done" until auth-check passes via the MCP tool (not curl). A scaffold that can't authenticate, or that authenticates but bypasses MCP, is worse than no scaffold.

## Step 7 — Report and hand off

Report what was created (file count, key files including `.env`, `.mcp.json`, `CLAUDE.md`), what the next sensible step is (e.g. "try `/digit9-paas:d9-test` for an end-to-end run, or just ask Claude to add an API endpoint that calls quote"), and remind the partner of the four secrets they must not commit (`D9_CLIENT_SECRET`, `D9_PASSWORD`, `D9_WEBHOOK_SECRET` once issued, and the username/password pair).

## Failure modes to handle gracefully

- Partner already has a `.env` — merge, don't overwrite. Ask before changing existing keys.
- Partner already has a `.mcp.json` for another MCP server — merge into the existing `mcpServers` object, don't replace the file.
- Java template chosen but partner has no Java/Maven installed — note it but proceed; they may install later.
- Partner has neither Node nor Java — pause and ask which they intend to install.
- Partner pastes credentials with surrounding whitespace or quotes — strip them silently.
