/**
 * {{PROJECT_NAME}} — Express entry point.
 *
 * Wires up:
 *   - GET  /health                       liveness check
 *   - POST /webhooks/digit9              D9 webhook receiver
 *   - POST /api/remittances/quote        sample partner endpoint that calls D9 quote
 *
 * Replace the sample remittances router with your real business logic. The webhook
 * receiver should generally stay as-is.
 */

import 'dotenv/config';
import express from 'express';
import { d9 } from './d9/client.js';
import { fetchQuote } from './d9/quote.js';
import { mountD9Webhook } from './webhooks/d9-receiver.js';

const app = express();

// Webhook MUST be mounted BEFORE express.json() so it sees the raw body.
mountD9Webhook(app);

// JSON parsing for the rest of the API
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

// Sample partner endpoint — quote a remittance and return the parsed result.
app.post('/api/remittances/quote', async (req, res) => {
  try {
    const q = await fetchQuote(d9(), {
      sendingCountry:    req.body.sending_country    ?? 'AE',
      sendingCurrency:   req.body.sending_currency   ?? 'AED',
      receivingCountry:  req.body.receiving_country  ?? 'IN',
      receivingCurrency: req.body.receiving_currency ?? 'INR',
      sendingAmount:     Number(req.body.amount      ?? 100),
      receivingMode:     (req.body.mode              ?? 'BANK'),
    });
    res.json({
      quote_id:      q.quoteId,
      rate:          q.rate,
      our_fees:      q.ourFeesTotal,
      expires_at:    q.expiresAt.toISOString(),
    });
  } catch (e: any) {
    console.error('quote failed', e);
    res.status(502).json({ error: e?.message ?? 'quote failed' });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`{{PROJECT_NAME}} listening on http://localhost:${port}`);
  console.log(`Webhook receiver: POST /webhooks/digit9`);
});
