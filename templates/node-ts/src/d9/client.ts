/**
 * D9Client — the only place that talks HTTP to Digit9.
 *
 * Encapsulates:
 *  - OAuth2 password-grant token acquisition
 *  - Token caching with a 30s safety margin before expiry
 *  - The four mandatory context headers (sender, channel, company, branch)
 *
 * Never call axios directly elsewhere. If you need a new endpoint, add a method
 * to this class or a sibling service that delegates here.
 */

import axios, { AxiosInstance } from 'axios';

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export class D9Client {
  private readonly http: AxiosInstance;
  private token: TokenCache | null = null;
  private readonly env = {
    baseUrl:      requireEnv('D9_BASE_URL'),
    clientId:     requireEnv('D9_CLIENT_ID'),
    clientSecret: requireEnv('D9_CLIENT_SECRET'),
    username:     requireEnv('D9_USERNAME'),
    password:     requireEnv('D9_PASSWORD'),
    sender:       requireEnv('D9_SENDER'),
    channel:      process.env.D9_CHANNEL ?? 'Direct',
    company:      requireEnv('D9_COMPANY'),
    branch:       requireEnv('D9_BRANCH'),
  };

  constructor() {
    this.http = axios.create({ baseURL: this.env.baseUrl, timeout: 30_000 });
    this.http.interceptors.request.use(async (config) => {
      const token = await this.getToken();
      config.headers.set('Authorization', `Bearer ${token}`);
      config.headers.set('sender',  this.env.sender);
      config.headers.set('channel', this.env.channel);
      config.headers.set('company', this.env.company);
      config.headers.set('branch',  this.env.branch);
      return config;
    });
  }

  private async getToken(): Promise<string> {
    const safetyMs = 30_000;
    if (this.token && Date.now() < this.token.expiresAt - safetyMs) {
      return this.token.accessToken;
    }
    const params = new URLSearchParams({
      grant_type:    'password',
      client_id:     this.env.clientId,
      client_secret: this.env.clientSecret,
      username:      this.env.username,
      password:      this.env.password,
      scope:         'openid',
    });
    const { data } = await axios.post(
      `${this.env.baseUrl}/auth/realms/cdp/protocol/openid-connect/token`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
    );
    this.token = {
      accessToken:  data.access_token,
      refreshToken: data.refresh_token,
      expiresAt:    Date.now() + data.expires_in * 1000,
    };
    return this.token.accessToken;
  }

  request<T = any>(config: Parameters<AxiosInstance['request']>[0]) {
    return this.http.request<T>(config);
  }
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env var: ${key}`);
  return v;
}

let _client: D9Client | null = null;
export function d9(): D9Client {
  if (!_client) _client = new D9Client();
  return _client;
}
