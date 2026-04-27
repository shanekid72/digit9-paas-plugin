import { getClient } from '../client.js';

export const d9_get_token = {
  name: 'd9_get_token',
  description:
    'Fetch (and cache) an OAuth2 access token from the Digit9 sandbox. ' +
    'Use to verify that auth credentials in the env are correctly configured. ' +
    'Returns token metadata only (TTLs, type) — never the raw token.',
  inputSchema: {
    type: 'object',
    properties: {},
    additionalProperties: false,
  },
  async execute(_args: Record<string, never>) {
    const client = getClient();
    await client.getAccessToken();
    const meta = client.getTokenMetadata();
    return {
      ok: true,
      base_url:           client.env.baseUrl,
      client_id:          client.env.clientId,
      username:           client.env.username,
      sender:             client.env.sender,
      channel:            client.env.channel,
      company:            client.env.company,
      branch:             client.env.branch,
      token: meta,
    };
  },
};
