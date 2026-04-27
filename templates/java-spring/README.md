# {{PROJECT_NAME}}

Digit9 PaaS integration scaffolded by the `digit9-paas` Claude Code plugin.

- **Service type:** {{SERVICE_TYPE}}
- **Default corridor:** {{DEFAULT_CORRIDOR}}
- **Stack:** Java 17, Spring Boot 3.3, WebClient, Maven, Caffeine

## First run

1. Copy `.env.example` to `.env` (or set the variables in your shell).
2. Build:
   ```bash
   mvn -DskipTests package
   ```
3. Run:
   ```bash
   mvn spring-boot:run
   ```
4. From a Claude Code session in the same folder:
   ```
   /d9:auth-check
   /d9:test
   ```

## Layout

```
src/main/java/com/partner/d9/
├── Application.java                  Spring Boot entry
├── config/D9Config.java              @ConfigurationProperties for D9_* env vars
├── D9Client.java                     Auth, token caching, the four headers
├── MasterDataService.java            Banks, branches, corridors (Caffeine cached)
├── QuoteService.java                 Quote with TTL handling
├── TransactionService.java           createTransaction with idempotency
├── StatusService.java                confirm + enquire + cancel + polling
├── api/RemittanceController.java     Sample partner endpoint that quotes
└── webhook/D9WebhookController.java  HMAC-verified webhook receiver

src/main/resources/application.yml    Config — most values resolved from env
```

All Digit9 calls flow through `D9Client`. Don't bypass it.

## Env vars

The application reads everything from environment variables prefixed `D9_`. Set them in your shell or via a `.env` loader (Spring doesn't load `.env` natively — use `dotenv-java` or set them via your IDE / CI / orchestrator).
