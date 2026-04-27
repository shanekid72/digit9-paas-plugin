import { getClient } from '../client.js';

export const d9_quote = {
  name: 'd9_quote',
  description:
    'Get a remittance quote — FX rate, fees, settlement details. Returns a quote_id valid for ~10 minutes ' +
    'that must be passed to d9_create_txn before it expires. Use type=SEND, instrument=REMITTANCE for the ' +
    'standard PaaS happy path.',
  inputSchema: {
    type: 'object',
    properties: {
      sending_country_code:    { type: 'string', description: 'ISO-2, e.g. "AE"' },
      sending_currency_code:   { type: 'string', description: 'ISO-3, e.g. "AED"' },
      receiving_country_code:  { type: 'string', description: 'ISO-2, e.g. "IN"' },
      receiving_currency_code: { type: 'string', description: 'ISO-3, e.g. "INR"' },
      sending_amount:          { type: 'number' },
      receiving_mode:          { type: 'string', enum: ['BANK', 'CASHPICKUP', 'WALLET'] },
    },
    required: [
      'sending_country_code',
      'sending_currency_code',
      'receiving_country_code',
      'receiving_currency_code',
      'sending_amount',
      'receiving_mode',
    ],
    additionalProperties: false,
  },
  async execute(args: {
    sending_country_code: string;
    sending_currency_code: string;
    receiving_country_code: string;
    receiving_currency_code: string;
    sending_amount: number;
    receiving_mode: 'BANK' | 'CASHPICKUP' | 'WALLET';
  }) {
    const client = getClient();
    return await client.call({
      method: 'POST',
      url:    '/amr/paas/api/v1_0/paas/quote',
      data: {
        ...args,
        type:       'SEND',
        instrument: 'REMITTANCE',
      },
    });
  },
};
