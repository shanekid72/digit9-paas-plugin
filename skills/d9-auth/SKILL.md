---
name: d9-auth
description: Authenticate to the Digit9 PaaS sandbox/production API. Triggers on anything related to access tokens, refresh tokens, the four required context headers (sender, channel, company, branch), 401 Unauthorized errors, OAuth2 password grant, Keycloak, or token caching against drap-sandbox.digitnine.com. Use before any other D9 API call.
---

# Digit9 PaaS — Authentication

Digit9 uses **OAuth2 password grant against Keycloak**. Tokens are short-lived and every API call requires four extra context headers on top of `Authorization`.

## Token endpoint

```
POST {D9_BASE_URL}/auth/realms/cdp/protocol/openid-connect/token
Content-Type: application/x-www-form-urlencoded
```

**Body** (urlencoded):

| Param           | Value                          |
| --------------- | ------------------------------ |
| `grant_type`    | `password`                     |
| `client_id`     | `cdp_app` (sandbox)            |
| `client_secret` | from env (`D9_CLIENT_SECRET`)  |
| `username`      | from env (`D9_USERNAME`)       |
| `password`      | from env (`D9_PASSWORD`)       |
| `scope`         | `openid` (optional)            |

**Response** (relevant fields):

```json
{
  "access_token": "eyJhbGc...",
  "expires_in": 300,
  "refresh_token": "eyJhbGc...",
  "refresh_expires_in": 1800,
  "token_type": "bearer"
}
```

- Access token TTL: **300s (5 min)**.
- Refresh token TTL: **1800s (30 min)**.
- Cache the access token in memory; refresh **30 seconds before expiry** to avoid in-flight calls 401-ing.

## The four mandatory context headers

Every PaaS endpoint requires these four headers in addition to `Authorization`:

| Header    | Source                  | Example         |
| --------- | ----------------------- | --------------- |
| `sender`  | env `D9_SENDER`         | `testpaasagentae` |
| `channel` | env `D9_CHANNEL`        | `Direct`        |
| `company` | env `D9_COMPANY`        | `784835`        |
| `branch`  | env `D9_BRANCH`         | `784836`        |

**Omitting any one returns `40000 BAD_REQUEST`.** This is the #1 reason new partners' first call fails. Inject them in a single client wrapper — never set them per-call in business code.

## Canonical implementation

### Node / TypeScript

```ts
// src/d9/client.ts
import axios, { AxiosInstance } from 'axios';

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export class D9Client {
  private http: AxiosInstance;
  private token: TokenCache | null = null;
  private readonly env = {
    baseUrl: process.env.D9_BASE_URL!,
    clientId: process.env.D9_CLIENT_ID!,
    clientSecret: process.env.D9_CLIENT_SECRET!,
    username: process.env.D9_USERNAME!,
    password: process.env.D9_PASSWORD!,
    sender: process.env.D9_SENDER!,
    channel: process.env.D9_CHANNEL ?? 'Direct',
    company: process.env.D9_COMPANY!,
    branch: process.env.D9_BRANCH!,
  };

  constructor() {
    this.http = axios.create({ baseURL: this.env.baseUrl, timeout: 15_000 });
    this.http.interceptors.request.use(async (config) => {
      const token = await this.getToken();
      config.headers = {
        ...config.headers,
        Authorization: `Bearer ${token}`,
        sender:  this.env.sender,
        channel: this.env.channel,
        company: this.env.company,
        branch:  this.env.branch,
      };
      return config;
    });
  }

  private async getToken(): Promise<string> {
    const safetyMs = 30_000;
    if (this.token && Date.now() < this.token.expiresAt - safetyMs) {
      return this.token.accessToken;
    }
    const params = new URLSearchParams({
      grant_type:    'password',
      client_id:     this.env.clientId,
      client_secret: this.env.clientSecret,
      username:      this.env.username,
      password:      this.env.password,
      scope:         'openid',
    });
    const { data } = await axios.post(
      `${this.env.baseUrl}/auth/realms/cdp/protocol/openid-connect/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    this.token = {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    Date.now() + data.expires_in * 1000,
    };
    return this.token.accessToken;
  }

  request<T>(config: Parameters<AxiosInstance['request']>[0]) {
    return this.http.request<T>(config);
  }
}
```

### Java / Spring Boot

```java
// src/main/java/com/partner/d9/D9Client.java
@Component
public class D9Client {
    private final WebClient http;
    private final D9Config cfg;
    private final AtomicReference<TokenCache> token = new AtomicReference<>();

    public D9Client(D9Config cfg, WebClient.Builder builder) {
        this.cfg = cfg;
        this.http = builder
            .baseUrl(cfg.baseUrl())
            .filter((req, next) -> getToken().flatMap(t ->
                next.exchange(ClientRequest.from(req)
                    .header(HttpHeaders.AUTHORIZATION, "Bearer " + t)
                    .header("sender",  cfg.sender())
                    .header("channel", cfg.channel())
                    .header("company", cfg.company())
                    .header("branch",  cfg.branch())
                    .build())))
            .build();
    }

    private Mono<String> getToken() {
        var cur = token.get();
        if (cur != null && Instant.now().plusSeconds(30).isBefore(cur.expiresAt())) {
            return Mono.just(cur.accessToken());
        }
        return WebClient.create(cfg.baseUrl())
            .post()
            .uri("/auth/realms/cdp/protocol/openid-connect/token")
            .contentType(MediaType.APPLICATION_FORM_URLENCODED)
            .bodyValue(BodyInserters.fromFormData("grant_type", "password")
                .with("client_id",     cfg.clientId())
                .with("client_secret", cfg.clientSecret())
                .with("username",      cfg.username())
                .with("password",      cfg.password())
                .with("scope",         "openid"))
            .retrieve()
            .bodyToMono(TokenResponse.class)
            .map(r -> {
                var c = new TokenCache(r.access_token(),
                                       r.refresh_token(),
                                       Instant.now().plusSeconds(r.expires_in()));
                token.set(c);
                return c.accessToken();
            });
    }

    public WebClient http() { return http; }
}
```

## Anti-patterns to flag

When reviewing partner code, push back on any of these:

1. **Token fetched per-call.** Tokens must be cached. Re-authenticating on every request will rate-limit you and burn Keycloak.
2. **Headers set inline in business code.** All four headers belong in the client filter/interceptor. If you see `headers.put("company", ...)` in a service class, move it.
3. **No safety margin on expiry.** A token that expires "right now" is a token that expires mid-flight. Refresh ≥30s before `expires_in`.
4. **Storing `client_secret` in code.** Always env-driven. The repo template has `.env.example` for a reason.
5. **Logging the access token.** `Authorization` headers and form bodies must be redacted in logs.
6. **Catching 401 and retrying naively.** A real 401 after refresh means revoked credentials — surface it, don't loop.

## Verification (the partner can ask Claude to run this)

The `digit9-sandbox` MCP server exposes a tool `d9_get_token`. Ask Claude:

> "Verify auth works against sandbox."

Claude will call `d9_get_token` with the partner's env, confirm a token comes back, and report `expires_in`. If it fails, common causes:

- `40001 invalid_grant` → wrong username/password
- `40001 invalid_client` → wrong client_secret
- Network timeout → check VPN / IP allowlisting (some prod tenants require allowlisting; sandbox does not)

## Production differences

- Base URL changes (Digit9 will provide).
- `client_id`, `client_secret`, `username`, `password` are partner-specific (not the sandbox test agent).
- Some tenants enable IP allowlisting on prod auth — coordinate with Digit9 ops before go-live.
