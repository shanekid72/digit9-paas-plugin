# Digit9 PaaS Plugin — Rollout Checklist

A step-by-step from "files in a folder" to "first pilot partner using it." Tick the boxes as you go.

Each phase has a goal, the steps, exact commands where useful, success criteria, and a fallback if it doesn't work.

---

## Phase 1 — Get the plugin into a private Git repo

**Goal:** the plugin code lives somewhere partners can install from.
**Time:** 15–30 minutes.
**You'll need:** access to your org's GitHub/GitLab/Bitbucket, ability to create a private repo.

### Step 1.1 — Decide where the repo lives

- [ ] Pick the host: GitHub, GitLab, Bitbucket, or your internal Git server.
- [ ] Decide the repo name. Suggestion: `digit9-paas-plugin`.
- [ ] Decide the org/owner. Suggestion: a `digitnine` org if one exists, otherwise your own user.
- [ ] Confirm your dev team has SSH keys or a PAT set up for that host.

### Step 1.2 — Create the empty private repo

- [ ] On the host's web UI, create a **new private repo** called `digit9-paas-plugin`.
- [ ] Do **not** initialize it with a README, .gitignore, or license — we already have those.
- [ ] Copy the SSH or HTTPS URL it gives you (e.g. `git@github.com:digitnine/digit9-paas-plugin.git`).

### Step 1.3 — Copy the plugin files into your local Git working directory

- [ ] Decide where on your machine you want the plugin source. Suggestion: `D:\Projects\digit9-paas-plugin\`.
- [ ] Copy the entire `digit9-paas/` folder from `outputs/` into that location. Use Windows Explorer copy-paste, or PowerShell:

```powershell
Copy-Item -Path "C:\Users\sHANE\AppData\Roaming\Claude\local-agent-mode-sessions\6735b478-1915-4ae6-b924-c063259b8c80\d03ca0e6-b2d3-4cc0-bb4a-8d38f32dc173\local_d6caf01c-18d4-4cd9-a8b3-5989a837cde8\outputs\digit9-paas\*" -Destination "D:\Projects\digit9-paas-plugin\" -Recurse
```

### Step 1.4 — Initialize Git, commit, push

- [ ] Open PowerShell in `D:\Projects\digit9-paas-plugin\`.
- [ ] Run:

```powershell
git init
git add .
git commit -m "Initial commit: digit9-paas plugin v0.1.0"
git branch -M main
git remote add origin <THE_URL_FROM_STEP_1.2>
git push -u origin main
```

### Step 1.5 — Add a `.gitignore` at the repo root if you want to gitignore build outputs

- [ ] Create `D:\Projects\digit9-paas-plugin\.gitignore` with at minimum:

```
node_modules/
*.log
.DS_Store
.env
```

- [ ] Note: we'll **commit** the MCP server's `dist/` folder (built JS) so partners don't need to build it on install. So *don't* add `dist/` to .gitignore.

**Success criteria:** pushing the URL into a browser shows the plugin files. README renders. `plugin.json` is at the root.

**If it fails:** auth issues are usually SSH keys not set up — see your host's docs for "add SSH key." HTTPS push asks for a Personal Access Token, not your password.

---

## Phase 2 — Build the MCP server's `dist/`

**Goal:** the bundled Node-based MCP server is pre-built so partners don't need to compile it.
**Time:** 5 minutes.
**You'll need:** Node.js 18+ on your machine (you have this — Claude Code requires it).

### Step 2.1 — Install dependencies

- [ ] In PowerShell, navigate to the MCP server folder:

```powershell
cd D:\Projects\digit9-paas-plugin\mcp\digit9-sandbox-server
npm install
```

### Step 2.2 — Build

- [ ] Run:

```powershell
npm run build
```

- [ ] Confirm a `dist/` folder appears with a `dist/index.js` inside it.

### Step 2.3 — Sanity check it runs

- [ ] Try (it'll error because env vars aren't set, but it should at least start):

```powershell
node dist/index.js
```

- [ ] Expected: it complains about missing `D9_BASE_URL` env var. That means the JS is loading and executing.
- [ ] Press Ctrl+C to stop it.

### Step 2.4 — Commit `dist/` to the repo

- [ ] Back in `D:\Projects\digit9-paas-plugin\`:

```powershell
git add mcp/digit9-sandbox-server/dist
git commit -m "Build MCP server dist/"
git push
```

**Success criteria:** `mcp/digit9-sandbox-server/dist/index.js` exists and is in the repo on GitHub.

**If it fails:**
- `npm install` errors → check you're on Node 18+ (`node --version`).
- `npm run build` TypeScript errors → likely a typo or missing import. Send me the error and I'll fix.
- The MCP SDK package version may have moved past `^1.0.0` — if `npm install` says no matching version, run `npm install @modelcontextprotocol/sdk@latest` and let `npm` write the new version into `package.json`.

---

## Phase 3 — Self-test the plugin in a fresh project

**Goal:** prove the plugin install flow works end-to-end on your own machine before any partner sees it.
**Time:** 20–40 minutes.
**You'll need:** sandbox credentials (`D9_CLIENT_SECRET`, `D9_USERNAME`, `D9_PASSWORD`, `D9_SENDER`, `D9_COMPANY`, `D9_BRANCH`).

### Step 3.1 — Create a throwaway test project folder

- [ ] Create an empty folder, e.g. `D:\Projects\d9-plugin-test\`.
- [ ] Open PowerShell there.

### Step 3.2 — Install the plugin

- [ ] Run:

```powershell
claude plugin install git+https://github.com/<YOUR_ORG>/digit9-paas-plugin.git
```

- [ ] Replace `<YOUR_ORG>` with the actual org/user from Phase 1.

### Step 3.3 — Verify the plugin registered

- [ ] Run `claude` in the test folder.
- [ ] Inside the Claude session, type `/help` and look for `/d9:scaffold`, `/d9:test`, `/d9:validate`, `/d9:auth-check`.
- [ ] If the four `d9:*` commands are listed, the plugin is installed.

### Step 3.4 — Test auth before scaffolding

- [ ] In the Claude session, run:

```
/d9:auth-check
```

- [ ] You'll be prompted for sandbox credentials, or you may need to set them in env first.
- [ ] Easiest: create `D:\Projects\d9-plugin-test\.env` with:

```
D9_BASE_URL=https://drap-sandbox.digitnine.com
D9_CLIENT_ID=cdp_app
D9_CLIENT_SECRET=<your sandbox secret>
D9_USERNAME=<your sandbox username>
D9_PASSWORD=<your sandbox password>
D9_SENDER=<your sender code>
D9_CHANNEL=Direct
D9_COMPANY=<your company code>
D9_BRANCH=<your branch code>
```

- [ ] Re-run `/d9:auth-check`.
- [ ] **Expected:** "Sandbox auth OK" with token expiry info. If yes, your credentials are good and the MCP server is talking to the sandbox.

### Step 3.5 — Run the scaffold

- [ ] In the Claude session:

```
/d9:scaffold
```

- [ ] Pick **Node/TS** (faster to test than Java).
- [ ] Pick **C2C**.
- [ ] Pick corridor **AE → IN BANK**.
- [ ] Confirm the partner prefix it suggests.
- [ ] Wait while it copies template files.
- [ ] Verify: a `package.json`, `src/`, `.env`, `CLAUDE.md` appear in the test folder.

### Step 3.6 — Install template dependencies and run

- [ ] Open a second PowerShell in the test folder:

```powershell
npm install
npm run dev
```

- [ ] Expected: server starts on http://localhost:3000.

### Step 3.7 — Run the end-to-end test

- [ ] Back in the Claude session, run:

```
/d9:test
```

- [ ] **Expected:** ✓ at every stage — auth, corridors, banks, quote, createTxn, confirmTxn, enquire (4x), webhook simulation. Total ~30–60 seconds.

**Success criteria:** all-green output from `/d9:test`. A real transaction was created, confirmed, and reached terminal state in your sandbox.

**If it fails at a specific step:**
- Auth → re-check `.env` values for typos.
- Quote step 40000 BAD_REQUEST → one of the four context headers is missing or wrong (check `D9_SENDER`, `D9_COMPANY`, `D9_BRANCH`).
- createTxn 806500 → response body's `errors[]` will name the field. Most common: `account_type_code` missing.
- Webhook sim skipped → `D9_WEBHOOK_SECRET` not set, or no receiver running. Set the secret and ensure `npm run dev` is still running.

---

## Phase 4 — Fix what broke

**Goal:** capture every issue you hit during Phase 3 and fix in the plugin.
**Time:** depends on what broke. Plan a half-day buffer.
**You'll need:** the plugin source repo open in your editor.

### Step 4.1 — Take notes during Phase 3

- [ ] Keep a text file with: which step, what error, what you had to do to fix.

### Step 4.2 — For each issue, decide if it's a plugin bug or a setup gap

- [ ] Plugin bug → fix in the source repo, push.
- [ ] Setup gap (e.g. ".env wasn't documented clearly") → improve the README or CLAUDE.md.template.

### Step 4.3 — Re-test after each fix

- [ ] Delete `D:\Projects\d9-plugin-test\` entirely.
- [ ] Recreate it.
- [ ] `claude plugin update digit9-paas` (or uninstall + reinstall if update misbehaves).
- [ ] Run `/d9:scaffold` and `/d9:test` again.

**Success criteria:** `/d9:scaffold` to `/d9:test` runs clean from a fresh folder with zero manual fixes.

---

## Phase 5 — Pilot with 2–3 friendly partners

**Goal:** real partners use the plugin under your guidance. Real feedback.
**Time:** 2–4 weeks per partner.
**You'll need:** integration manager(s) on standby, partners who've signed contracts and have sandbox creds.

### Step 5.1 — Pick the partners

- [ ] Pick 2–3 partners who:
  - Are early in their integration (haven't built much yet).
  - Have a tech lead willing to try a new tool.
  - Will give honest feedback (positive or negative).
- [ ] Coordinate with their integration manager.

### Step 5.2 — Add the plugin to the welcome kit

- [ ] In the welcome email template (or onboarding doc), add a section:

```
We have a Claude Code plugin that accelerates integration. If your team uses
Claude Code, install with:

  claude plugin install git+https://github.com/<YOUR_ORG>/digit9-paas-plugin.git

Then run `/d9:scaffold` to get a starter project. The plugin guides you through
the integration end-to-end against the sandbox.

If you don't use Claude Code, no problem — the docs at developer.digitnine.com
are unchanged.
```

- [ ] Make sure their sandbox creds are in the same email so they can fill `.env` immediately.

### Step 5.3 — Schedule a 30-minute "first integration" call per pilot

- [ ] Walk them through install → scaffold → first sandbox call.
- [ ] You don't drive — they drive. You watch where they get stuck.
- [ ] Take notes.

### Step 5.4 — Weekly check-ins for 4 weeks

- [ ] Ask three questions every week:
  1. What worked well this week?
  2. Where did you get stuck?
  3. Anything Claude told you that turned out to be wrong?

### Step 5.5 — Fold their feedback into the plugin

- [ ] After each round of feedback, update skills/templates.
- [ ] Push a new version. Notify pilots: "run `claude plugin update digit9-paas`."

**Success criteria:** all 3 pilots reach production-ready integrations. At least one says it shaved measurable time off vs. their previous integration projects.

---

## Phase 6 — General availability

**Goal:** any new partner gets the plugin in their welcome kit by default.
**Time:** 2–3 days of infra work; plus ongoing maintenance.

### Step 6.1 — Stand up the marketplace endpoint

- [ ] Decide the URL: `plugins.digitnine.com/digit9-paas` (or a subpath of your existing dev portal).
- [ ] Set up the static hosting (Azure Blob behind your CDN works fine).
- [ ] Publish a `marketplace.json` manifest pointing at your plugin and its versions.
- [ ] Test install via the public URL.

### Step 6.2 — Update the welcome email template

- [ ] Replace the Git URL with the marketplace URL:

```
claude plugin install https://plugins.digitnine.com/digit9-paas
```

### Step 6.3 — Add public-facing docs

- [ ] Add a "Claude Code plugin" section to developer.digitnine.com.
- [ ] Link from the homepage and the integration guides.

### Step 6.4 — Track adoption

- [ ] Add anonymous telemetry to the MCP server (count token requests by partner_id), or just ask integration managers to track which partners use it.
- [ ] Goal: 50%+ of new partners adopt within the first 6 months.

### Step 6.5 — Plan v0.2

Likely additions:
- [ ] Skills for the other products (UPaaS, EWA, WPS) — each as a separate skill folder, or a separate plugin.
- [ ] A `/d9:upgrade` command that helps partners migrate when API versions change.
- [ ] A `/d9:dashboard` artifact that shows live transaction stats from the partner's own DB.

**Success criteria:** plugin shipped publicly, partners using it without your hands-on guidance.

---

## Quick reference — common commands

| What you want to do                                   | Run                                                              |
| ----------------------------------------------------- | ---------------------------------------------------------------- |
| Install plugin from your repo                         | `claude plugin install git+https://github.com/<ORG>/digit9-paas-plugin.git` |
| Update to latest version                              | `claude plugin update digit9-paas`                               |
| Uninstall (e.g. to reinstall fresh)                   | `claude plugin uninstall digit9-paas`                            |
| List installed plugins                                | `claude plugin list`                                             |
| Build the MCP server                                  | `cd mcp/digit9-sandbox-server && npm install && npm run build`   |
| Test auth                                             | (in claude) `/d9:auth-check`                                     |
| Scaffold a new partner project                        | (in claude, in empty folder) `/d9:scaffold`                      |
| Run end-to-end happy path against sandbox             | (in claude, in scaffolded folder) `/d9:test`                     |
| Review existing partner code for anti-patterns        | (in claude) `/d9:validate`                                       |
