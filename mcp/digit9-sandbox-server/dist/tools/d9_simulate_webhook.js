import crypto from 'node:crypto';
import axios from 'axios';
import { getClient } from '../client.js';
export const d9_simulate_webhook = {
    name: 'd9_simulate_webhook',
    description: 'Build a properly-signed Digit9 webhook payload (HMAC-SHA256 over raw body using D9_WEBHOOK_SECRET) ' +
        'and POST it to the partner\'s local webhook endpoint. Lets a partner develop the receiver without ' +
        'standing up a public tunnel. Requires D9_WEBHOOK_SECRET in env.',
    inputSchema: {
        type: 'object',
        properties: {
            receiver_url: {
                type: 'string',
                description: 'Partner\'s webhook URL, e.g. http://localhost:3000/webhooks/digit9',
            },
            event_type: {
                type: 'string',
                enum: ['transaction.status.changed', 'customer.status.changed'],
            },
            transaction_ref_number: { type: 'string', description: 'For transaction.status.changed events' },
            state: { type: 'string', description: 'e.g. COMPLETED, FAILED, CANCELLED' },
            sub_state: { type: 'string', description: 'e.g. PAID, PAYMENT_FAILED' },
            customer_id: { type: 'string', description: 'For customer.status.changed events' },
            kyc_status: { type: 'string', enum: ['VERIFIED', 'PENDING', 'REJECTED'] },
            aml_status: { type: 'string', enum: ['CLEAR', 'FLAGGED', 'BLOCKED'] },
        },
        required: ['receiver_url', 'event_type'],
        additionalProperties: false,
    },
    async execute(args) {
        const client = getClient();
        const secret = client.env.webhookSecret;
        if (!secret) {
            throw new Error('D9_WEBHOOK_SECRET not set in environment — cannot sign simulated webhook.');
        }
        const now = new Date().toISOString();
        const idempotencyKey = crypto.randomUUID();
        let payload;
        if (args.event_type === 'transaction.status.changed') {
            payload = {
                event_type: 'transaction.status.changed',
                timestamp: now,
                transaction_ref_number: args.transaction_ref_number ?? '1234567890123456',
                agent_transaction_ref_number: 'PARTNER_SIMULATED',
                state: args.state ?? 'COMPLETED',
                sub_state: args.sub_state ?? 'PAID',
                data: {
                    fx_rates: { rate: '22.45000000', base_currency_code: 'AED', counter_currency_code: 'INR' },
                    fee_details: [
                        { type: 'COMMISSION', model: 'OUR', currency_code: 'AED', amount: '5.00' },
                    ],
                    settlement_details: {
                        settled_amount: { value: '2238.00', currency: 'INR' },
                        settlement_date: now.slice(0, 10),
                    },
                },
            };
        }
        else {
            payload = {
                event_type: 'customer.status.changed',
                timestamp: now,
                customer_id: args.customer_id ?? 'D9_CUST_SIMULATED',
                kyc_status: args.kyc_status ?? 'VERIFIED',
                aml_status: args.aml_status ?? 'CLEAR',
            };
        }
        const rawBody = JSON.stringify(payload);
        const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
        const resp = await axios.post(args.receiver_url, rawBody, {
            headers: {
                'Content-Type': 'application/json',
                'X-Signature': signature,
                'X-Timestamp': now,
                'Idempotency-Key': idempotencyKey,
            },
            timeout: 10_000,
            validateStatus: () => true,
        });
        return {
            sent_to: args.receiver_url,
            status: resp.status,
            response_body: resp.data,
            payload,
            headers: {
                'X-Signature': signature,
                'X-Timestamp': now,
                'Idempotency-Key': idempotencyKey,
            },
        };
    },
};
//# sourceMappingURL=d9_simulate_webhook.js.map