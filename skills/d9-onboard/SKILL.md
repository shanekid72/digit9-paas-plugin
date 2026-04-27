---
name: d9-onboard
description: Onboard a sender via Digit9's embedded web component, including KYC. Triggers on sender onboarding, customer onboarding, KYC, eKYC, web component, embedded UI, WebView, sessionId, customer.onboarded event, ui.exit event, kyc_status, aml_status, theme customization, white-label UI, or anything about getting a customer through Digit9's hosted onboarding flow. Note this uses a different host than the API (drap-sbx vs drap-sandbox).
---

# Digit9 PaaS — Onboarding (Embedded Web Component)

Sender onboarding (and the KYC that comes with it) is **not a server-to-server API**. It's a hosted web component that you embed in your app via WebView/iframe. Your backend mints a session, you redirect the user to Digit9's UI, the user completes the journey, and you receive a `customer.onboarded` event on the parent window.

This is the integration pattern partners most often try to bypass — "can we just call a KYC API and send the documents ourselves?" The answer is no: the hosted component is also where AML screening, sanctions checks, and document scanning happen, and Digit9 owns those for compliance reasons. Embed it.

## Two-step flow

### Step 1 — Backend: mint a session

```
POST {WEB_COMPONENT_HOST}/payment-collection/api/v1/sessions/init
Authorization: Bearer <token>      ← same access token as the API
Content-Type: application/json
```

**Important:** the web component lives on a different host than the API:

- API host:           `https://drap-sandbox.digitnine.com`
- Web component host: `https://drap-sbx.digitnine.com`

Don't reuse the same base URL. Both env vars exist in `.env.example` (`D9_BASE_URL` and `D9_WEBCOMPONENT_BASE_URL`).

**Body** (all fields optional):

```json
{
  "customerNo": "PARTNER_CUST_12345",
  "Metadata": {
    "Theme": {
      "primaryColor":    "#0A2540",
      "secondaryColor":  "#FFFFFF",
      "backgroundColor": "#F4F6FA",
      "textColor":       "#1A1A1A",
      "fontFamily":      "Inter",
      "partnerLogoUrl":  "https://partner.example.com/logo.svg"
    },
    "Locale": "en-AE"
  }
}
```

**Response:**

```json
{ "sessionId": "8a7f5e3b-2c1d-4f6a-9e8b-1a2b3c4d5e6f" }
```

The `sessionId` is short-lived (single-use, expires in ~15 minutes). Don't cache it.

### Step 2 — Frontend: redirect to the web component

```
https://drap-sbx.digitnine.com/webapp/send-amounts?sessionId={sessionId}
```

Embed in a WebView (mobile) or iframe (web). The user completes onboarding inside that frame.

## WebView messaging — the events you must handle

Once the user completes (or abandons) the journey, the component posts a message to the parent. There are two events you absolutely have to handle:

### `customer.onboarded`

Fired when the user completes the full onboarding journey. Payload:

```json
{
  "event_type": "customer.onboarded",
  "customer_id":"D9_CUST_4f8a...",
  "kyc_status": "VERIFIED",
  "aml_status": "CLEAR",
  "timestamp":  "2026-04-27T10:18:32Z"
}
```

`kyc_status` ∈ `{VERIFIED, PENDING, REJECTED}`.
`aml_status` ∈ `{CLEAR, FLAGGED, BLOCKED}`.

**Do not proceed to quote/transaction if `kyc_status != VERIFIED` or `aml_status != CLEAR`.** A `PENDING` KYC means the user uploaded docs but they're still being reviewed — you'll receive a `customer.status.changed` webhook later (see `d9-webhooks`) when the verification completes.

### `ui.exit`

User closed the component without completing. Treat as cancellation. Don't retry automatically — let the user re-initiate.

### Onboarding outcomes (what to render)

| `kyc_status` | `aml_status` | Show user                     | Allow remittance? |
| ------------ | ------------ | ----------------------------- | :---------------: |
| VERIFIED     | CLEAR        | "You're set. Send money."     |        ✓          |
| VERIFIED     | FLAGGED      | "Under review. We'll email."  |        ✗          |
| VERIFIED     | BLOCKED      | "Unable to onboard."          |        ✗          |
| PENDING      | any          | "Verifying your details..."   |        ✗ (yet)    |
| REJECTED     | any          | "Onboarding unsuccessful."    |        ✗          |

## Theme customization — what you can and can't change

You can customize:

- Colors (primary, secondary, background, text)
- Font family
- Partner logo URL

You cannot:

- Modify copy/text inside the flow
- Change validation rules or required fields
- Skip steps (KYC, AML are mandatory)
- Remove the "Powered by Digit9" footer

Sending unsupported theme keys returns `40000 BAD_REQUEST` from the session init.

## Canonical implementation

### Backend: mint session (Node)

```ts
// src/d9/onboard.ts
import axios from 'axios';
import { D9Client } from './client';

export async function createOnboardingSession(
  d9: D9Client,
  partnerCustomerNo: string,
  theme?: Partial<Theme>,
): Promise<string> {
  const baseUrl = process.env.D9_WEBCOMPONENT_BASE_URL!; // drap-sbx host
  const token   = await (d9 as any).getToken();          // reuse cached token

  const { data } = await axios.post(
    `${baseUrl}/payment-collection/api/v1/sessions/init`,
    {
      customerNo: partnerCustomerNo,
      Metadata: { Theme: theme, Locale: 'en-AE' },
    },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    },
  );
  return data.sessionId;
}

export function buildOnboardingUrl(sessionId: string): string {
  const base = process.env.D9_WEBCOMPONENT_BASE_URL!;
  return `${base}/webapp/send-amounts?sessionId=${encodeURIComponent(sessionId)}`;
}
```

### Frontend: WebView/iframe message listener (Node/Browser)

```ts
// src/onboarding-frame.ts
type OnboardedEvent = {
  event_type: 'customer.onboarded';
  customer_id: string;
  kyc_status: 'VERIFIED' | 'PENDING' | 'REJECTED';
  aml_status: 'CLEAR' | 'FLAGGED' | 'BLOCKED';
  timestamp: string;
};

const ALLOWED_ORIGINS = ['https://drap-sbx.digitnine.com', 'https://drap.digitnine.com'];

window.addEventListener('message', (e: MessageEvent) => {
  if (!ALLOWED_ORIGINS.includes(e.origin)) return; // ALWAYS validate origin
  const msg = e.data;
  if (msg?.event_type === 'customer.onboarded') {
    const evt = msg as OnboardedEvent;
    if (evt.kyc_status === 'VERIFIED' && evt.aml_status === 'CLEAR') {
      proceedToRemittance(evt.customer_id);
    } else if (evt.kyc_status === 'PENDING') {
      showPendingScreen(evt.customer_id);
    } else {
      showOnboardingFailed(evt);
    }
  } else if (msg?.event_type === 'ui.exit') {
    closeFrameAndShowReturnHome();
  }
});
```

### Java / Spring Boot — backend session mint

```java
// src/main/java/com/partner/d9/OnboardingService.java
@Service
public class OnboardingService {
    private final WebClient webClient;       // pointed at drap-sbx host
    private final D9TokenProvider tokens;    // reuses D9Client's token cache

    public Mono<String> createSession(String partnerCustomerNo, Theme theme) {
        return tokens.currentAccessToken().flatMap(token ->
            webClient.post()
                .uri("/payment-collection/api/v1/sessions/init")
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .bodyValue(Map.of(
                    "customerNo", partnerCustomerNo,
                    "Metadata",   Map.of("Theme", theme, "Locale", "en-AE")))
                .retrieve()
                .bodyToMono(InitResponse.class)
                .map(InitResponse::sessionId));
    }
}
```

## Anti-patterns to flag

1. **Reusing a sessionId.** Single-use. Mint a new one for every onboarding attempt.
2. **Skipping origin validation on the message listener.** Without `ALLOWED_ORIGINS` check, any tab can post a fake `customer.onboarded` event. Always validate.
3. **Treating PENDING as failure.** PENDING means "wait for the webhook." Don't show "onboarding failed" — show a polite "we're verifying your details" screen.
4. **Calling the API host for the session init.** Wrong base URL: the web component is on `drap-sbx`, not `drap-sandbox`. The token is the same, the host is not.
5. **Embedding HTTP (not HTTPS).** Mobile WebViews on iOS will block mixed content. Always HTTPS.
6. **Forgetting Locale.** The component will fall back to English. Pass the user's locale (e.g. `en-AE`, `ar-AE`, `hi-IN`) for a better UX.

## Verification

The MCP server tool `d9_create_session` mints a sandbox session and returns the URL. Open it in a browser to walk through the flow with sandbox test PII (Digit9 provides test customers).

Webhook simulation for the post-onboarding `customer.status.changed` event lives in `d9-webhooks`.
