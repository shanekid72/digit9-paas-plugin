# Digit9 Sandbox MCP Server

Internal MCP server bundled with the `digit9-paas` plugin. Spawned by Claude Code on demand. Exposes the Digit9 PaaS sandbox API as a set of Claude tools (`d9_get_token`, `d9_quote`, `d9_create_txn`, etc.) so Claude can verify partner integrations against a real sandbox while coding.

Partners do not run this directly — the plugin runs it via `node dist/index.js` based on the `mcpServers` block in `plugin.json`.

## Build

```bash
npm install
npm run build
```

The plugin distribution should ship `dist/` pre-built so partners don't need to rebuild on install.

## Configuration

All configuration is environment-driven (see `plugin.json`):

```
D9_BASE_URL              required, e.g. https://drap-sandbox.digitnine.com
D9_CLIENT_ID             required
D9_CLIENT_SECRET         required
D9_USERNAME              required
D9_PASSWORD              required
D9_SENDER                required
D9_CHANNEL               default: "Direct"
D9_COMPANY               required
D9_BRANCH                required
D9_WEBHOOK_SECRET        optional (only needed for d9_simulate_webhook)
D9_WEBCOMPONENT_BASE_URL optional, defaults to drap-sbx.digitnine.com
```

## Tools exposed

| Tool                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `d9_get_token`        | Fetch + cache OAuth2 access token                      |
| `d9_get_corridors`    | List supported corridors                               |
| `d9_get_banks`        | List banks for a country/mode                          |
| `d9_quote`            | Get a quote (FX rate, fees)                            |
| `d9_create_txn`       | Create a transaction from a quote                      |
| `d9_confirm_txn`      | Confirm a transaction (irrevocable)                    |
| `d9_enquire_txn`      | Poll transaction status                                |
| `d9_simulate_webhook` | POST a properly-signed webhook to a partner endpoint   |
