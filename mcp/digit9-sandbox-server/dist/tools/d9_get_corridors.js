import { getClient } from '../client.js';
export const d9_get_corridors = {
    name: 'd9_get_corridors',
    description: 'List supported (sending_country, receiving_country, receiving_currency, receiving_modes) ' +
        'corridors from the Digit9 sandbox masters. Use before exposing a corridor in partner UI.',
    inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
    },
    async execute(_args) {
        const client = getClient();
        return await client.call({
            method: 'GET',
            url: '/raas/masters/v1/service-corridor',
        });
    },
};
//# sourceMappingURL=d9_get_corridors.js.map