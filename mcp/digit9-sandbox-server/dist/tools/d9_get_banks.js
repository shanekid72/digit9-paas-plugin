import { getClient } from '../client.js';
export const d9_get_banks = {
    name: 'd9_get_banks',
    description: 'List banks supported in a receiving country for a given mode (BANK / CASHPICKUP / WALLET). ' +
        'Each bank includes its iso_code (SWIFT/BIC) and the account_types whose codes are required ' +
        'in createTransaction.bank_details.account_type_code.',
    inputSchema: {
        type: 'object',
        properties: {
            country: { type: 'string', description: 'ISO-2 receiving country code, e.g. "IN", "PK", "BD"' },
            mode: { type: 'string', enum: ['BANK', 'CASHPICKUP', 'WALLET'] },
        },
        required: ['country', 'mode'],
        additionalProperties: false,
    },
    async execute(args) {
        const client = getClient();
        return await client.call({
            method: 'GET',
            url: '/raas/masters/v1/banks',
            params: {
                receiving_country_code: args.country,
                receiving_mode: args.mode,
            },
        });
    },
};
//# sourceMappingURL=d9_get_banks.js.map