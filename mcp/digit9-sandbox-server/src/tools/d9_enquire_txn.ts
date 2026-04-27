import { getClient } from '../client.js';

export const d9_enquire_txn = {
  name: 'd9_enquire_txn',
  description:
    'Get the current status of a transaction. Returns state (INITIATED/ACCEPTED/IN_PROGRESS/COMPLETED/FAILED/CANCELLED) ' +
    'and sub_state, plus settlement details. Use for status polling and reconciliation backfill.',
  inputSchema: {
    type: 'object',
    properties: {
      transaction_ref_number:        { type: 'string' },
      agent_transaction_ref_number:  { type: 'string', description: 'Optional fallback identifier' },
    },
    required: ['transaction_ref_number'],
    additionalProperties: false,
  },
  async execute(args: { transaction_ref_number: string; agent_transaction_ref_number?: string }) {
    const client = getClient();
    return await client.call({
      method: 'GET',
      url:    '/amr/paas/api/v1_0/paas/enquire-transaction',
      params: {
        transaction_ref_number:        args.transaction_ref_number,
        ...(args.agent_transaction_ref_number ? { agent_transaction_ref_number: args.agent_transaction_ref_number } : {}),
      },
    });
  },
};
