import { getClient } from '../client.js';

export const d9_create_txn = {
  name: 'd9_create_txn',
  description:
    'Create a Digit9 transaction from a quote. Returns the system transaction_ref_number. ' +
    'The sender/receiver objects must match the service_type (C2C/B2B) and the receiving_mode ' +
    'baked into the quote. agent_transaction_ref_number is your idempotency key.',
  inputSchema: {
    type: 'object',
    properties: {
      quote_id:                     { type: 'string' },
      service_type:                 { type: 'string', enum: ['C2C', 'B2B'] },
      agent_transaction_ref_number: { type: 'string', description: 'Partner-generated UUID; persist before calling.' },
      sender:                       { type: 'object', additionalProperties: true },
      receiver:                     { type: 'object', additionalProperties: true },
      transaction: {
        type: 'object',
        properties: {
          source_of_income: { type: 'string', description: 'e.g. SLRY, BUSN, INVM' },
          purpose_of_txn:   { type: 'string', description: 'e.g. SUPP, EDUC, SAVG' },
          proofs:           { type: 'array' },
        },
        required: ['source_of_income', 'purpose_of_txn'],
        additionalProperties: false,
      },
    },
    required: ['quote_id', 'service_type', 'agent_transaction_ref_number', 'sender', 'receiver', 'transaction'],
    additionalProperties: false,
  },
  async execute(args: any) {
    const client = getClient();
    return await client.call({
      method: 'POST',
      url:    '/amr/paas/api/v1_0/paas/createtransaction',
      data:   args,
    });
  },
};
