---
description: Verify the partner's sandbox credentials work — fetches a token from the Digit9 sandbox and reports success/failure with a diagnosis on common error modes.
---

You are running the `/d9:auth-check` command. Your job is to confirm that the partner's environment is wired correctly and that they can authenticate against the Digit9 sandbox.

## Steps

### 1. Confirm env vars present

Required: `D9_BASE_URL`, `D9_CLIENT_ID`, `D9_CLIENT_SECRET`, `D9_USERNAME`, `D9_PASSWORD`, `D9_SENDER`, `D9_COMPANY`, `D9_BRANCH`.
Optional: `D9_CHANNEL` (defaults to `Direct`), `D9_WEBHOOK_SECRET`.

Read from `.env` if present in the project. If any required var is empty or missing, list the missing keys and stop with a clear error — do not attempt the call.

### 2. Call the auth endpoint via MCP

Use the `digit9-sandbox` MCP server's `d9_get_token` tool. It already knows how to:

- POST to `${D9_BASE_URL}/auth/realms/cdp/protocol/openid-connect/token`
- form-urlencode the body with `grant_type=password`, the four credentials, and `scope=openid`
- send `Content-Type: application/x-www-form-urlencoded`

### 3. Report

**On success**, print a compact result:

```
✓ Sandbox auth OK
   base url:    https://drap-sandbox.digitnine.com
   client_id:   cdp_app
   username:    testpaasagentae
   token type:  bearer
   expires_in:  300s
   refresh:     1800s
```

Don't print the actual token (sensitive). Mask `client_secret` and `password` always.

**On failure**, classify the error and suggest the fix:

| Error from server                  | Likely cause                                   | Suggested fix                                            |
| ---------------------------------- | ---------------------------------------------- | -------------------------------------------------------- |
| 401 `invalid_grant`                | Wrong `D9_USERNAME` or `D9_PASSWORD`           | Re-paste credentials from the welcome email              |
| 401 `invalid_client`               | Wrong `D9_CLIENT_SECRET`                       | Confirm client_secret matches what Digit9 issued         |
| 400 `unsupported_grant_type`       | `D9_CLIENT_ID` may not allow password grant    | Confirm with Digit9 integration manager                  |
| Connection timeout / DNS error     | Network / VPN / wrong base URL                 | Check `D9_BASE_URL` and connectivity                     |
| TLS / cert error                   | Corporate proxy intercepting HTTPS             | Add corporate CA to trust store, or use a non-corp net   |

### 4. After success — sanity-check headers

Make one additional small call: `GET /raas/masters/v1/banks?receiving_country_code=IN&receiving_mode=BANK`. Use the four context headers (`sender`, `channel`, `company`, `branch`).

If that 200s, headers are wired correctly. If it returns `40000 BAD_REQUEST`, one of the four headers is missing/wrong — list which env vars to recheck.

```
✓ Headers OK   (sender, channel=Direct, company, branch)
   sample call: GET /raas/masters/v1/banks?country=IN&mode=BANK → 23 banks
```

### 5. Hand off

If everything passes, hint at next steps:

> "Auth and headers verified. Try `/d9:test` for an end-to-end run against sandbox, or just start asking Claude to build out the integration — the right skills will load on demand."

If it fails, do not continue. The partner has to fix credentials before any other plugin work makes sense.
