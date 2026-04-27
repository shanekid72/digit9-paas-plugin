/**
 * Digit9 webhook receiver.
 *
 * Three middleware steps in order:
 *   1. capture raw body bytes (HMAC must be computed over them, NOT parsed JSON)
 *   2. verify X-Signature (HMAC-SHA256) and X-Timestamp (±5 minutes)
 *   3. dedupe by Idempotency-Key, then process
 *
 * Returning 200 on signature failure is a security bug. Always 401 on bad signatures.
 */

import express, { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';

const SECRET = process.env.D9_WEBHOOK_SECRET;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export const rawBodyMiddleware = express.raw({ type: 'application/json', limit: '256kb' });

export function verifySignature(req: Request, res: Response, next: NextFunction) {
  if (!SECRET) {
    console.error('D9_WEBHOOK_SECRET not configured — cannot verify webhook');
    return res.status(500).send('webhook receiver misconfigured');
  }

  const signature = req.header('X-Signature') ?? '';
  const timestamp = req.header('X-Timestamp') ?? '';
  if (!signature || !timestamp) return res.status(401).send('missing signature headers');

  const ts = Date.parse(timestamp);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > MAX_CLOCK_SKEW_MS) {
    return res.status(401).send('timestamp out of range');
  }

  const expected = crypto.createHmac('sha256', SECRET).update(req.body).digest('hex');
  const a = Buffer.from(signature, 'hex');
  const b = Buffer.from(expected,  'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).send('signature mismatch');
  }
  next();
}

// In-memory dedupe — REPLACE with Redis or a DB table for production.
const seen = new Set<string>();

export const handler = async (req: Request, res: Response) => {
  const idemKey = req.header('Idempotency-Key') ?? '';
  if (!idemKey) return res.status(400).send('missing Idempotency-Key');
  if (seen.has(idemKey)) return res.status(200).send('duplicate, ignored');
  seen.add(idemKey);

  let payload: any;
  try {
    payload = JSON.parse(req.body.toString('utf8'));
  } catch {
    return res.status(400).send('invalid JSON');
  }

  try {
    switch (payload.event_type) {
      case 'transaction.status.changed':
        await onTransactionStatusChanged(payload);
        break;
      case 'customer.status.changed':
        await onCustomerStatusChanged(payload);
        break;
      default:
        console.warn('unknown event_type:', payload.event_type);
    }
    res.status(200).send('ok');
  } catch (err) {
    // On failure DO NOT 200 — let Digit9 retry.
    console.error('webhook processing failed:', err);
    seen.delete(idemKey); // allow retry
    res.status(500).send('processing failed');
  }
};

async function onTransactionStatusChanged(payload: any) {
  // TODO: persist transaction state to your DB; trigger any downstream reconciliation
  console.log('[d9.transaction.status.changed]', payload.transaction_ref_number, payload.state, payload.sub_state);
}

async function onCustomerStatusChanged(payload: any) {
  // TODO: update local customer record with new kyc/aml status
  console.log('[d9.customer.status.changed]', payload.customer_id, payload.kyc_status, payload.aml_status);
}

export function mountD9Webhook(app: express.Express) {
  app.post('/webhooks/digit9', rawBodyMiddleware, verifySignature, handler);
}
