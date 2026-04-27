import { getClient } from '../client.js';
/**
 * d9_create_txn — POST /amr/paas/api/v1_0/paas/createtransaction
 *
 * The Digit9 sandbox accepts the body shape documented in the PAASTestAgent
 * Postman collection (see skills/d9-transaction/SKILL.md). Top-level fields:
 *
 *   type, instrument, source_of_income, purpose_of_txn, message,
 *   sender, receiver, transaction.{quote_id}
 *
 * The receiver shape varies by receiving country (IN uses routing_code +
 * account_number; PK uses iso_code + iban; BD uses iso_code + account_number).
 *
 * The schema below documents the canonical top-level fields but is otherwise
 * permissive: additionalProperties is allowed everywhere so partners can pass
 * the real Postman shape without the wrapper rejecting it client-side.
 * The sandbox itself is the authority on field validity.
 */
export const d9_create_txn = {
    name: 'd9_create_txn',
    description: 'Create a Digit9 transaction from a quote. Body shape is per the PAASTestAgent Postman collection: ' +
        'top-level type/instrument/source_of_income/purpose_of_txn/message + sender + receiver + ' +
        'transaction.{quote_id}. Receiver bank_details fields differ by receiving country — see the ' +
        'd9-transaction skill for the per-country cheat sheet.',
    inputSchema: {
        type: 'object',
        properties: {
            type: { type: 'string', description: 'Transaction type, normally "SEND".', default: 'SEND' },
            instrument: { type: 'string', description: 'Normally "REMITTANCE".', default: 'REMITTANCE' },
            source_of_income: { type: 'string', description: 'e.g. SLRY, BUSN, INVM' },
            purpose_of_txn: { type: 'string', description: 'e.g. SUPP, EDUC, SAVG' },
            message: { type: 'string', description: 'Free-text message; defaults to "Agency transaction".' },
            sender: { type: 'object', additionalProperties: true,
                description: 'Per d9-transaction skill: agent_customer_number, names, mobile, ' +
                    'date_of_birth, country_of_birth, nationality, sender_id[], sender_address[].' },
            receiver: { type: 'object', additionalProperties: true,
                description: 'Per d9-transaction skill: names, mobile, date_of_birth, gender, ' +
                    'nationality, relation_code, receiver_address[], bank_details (shape ' +
                    'depends on receiving country — see the cheat sheet).' },
            transaction: {
                type: 'object',
                properties: {
                    quote_id: { type: 'string', description: 'From a fresh d9_quote call.' },
                },
                required: ['quote_id'],
                additionalProperties: true,
            },
        },
        required: ['sender', 'receiver', 'transaction'],
        additionalProperties: true,
    },
    async execute(args) {
        const client = getClient();
        const body = {
            type: 'SEND',
            instrument: 'REMITTANCE',
            message: 'Agency transaction',
            ...args,
        };
        return await client.call({
            method: 'POST',
            url: '/amr/paas/api/v1_0/paas/createtransaction',
            data: body,
        });
    },
};
//# sourceMappingURL=d9_create_txn.js.map