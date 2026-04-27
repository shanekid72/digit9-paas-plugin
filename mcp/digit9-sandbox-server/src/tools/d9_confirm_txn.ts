import { getClient } from '../client.js';

export const d9_confirm_txn = {
  name: 'd9_confirm_txn',
  description:
    'Confirm a transaction (irrevocable commitment to settle). Idempotent on transaction_ref_number. ' +
    'Returns state=IN_PROGRESS on success.',
  inputSchema: {
    type: 'object',
    properties: {
      transaction_ref_number: { type: 'string', description: 'System-generated 16-char ID from d9_create_txn' },
    },
    required: ['transaction_ref_number'],
    additionalProperties: false,
  },
  async execute(args: { transaction_ref_number: string }) {
    const client = getClient();
    return await client.call({
      method: 'POST',
      url:    '/amr/paas/api/v1_0/paas/confirmtransaction',
      data:   { transaction_ref_number: args.transaction_ref_number },
    });
  },
};
