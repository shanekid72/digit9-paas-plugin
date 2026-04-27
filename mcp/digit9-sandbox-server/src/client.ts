/**
 * Shared HTTP client for the Digit9 sandbox.
 *
 * Handles:
 *  - OAuth2 password-grant auth against Keycloak
 *  - Token caching with 30-second safety margin before expiry
 *  - The four required context headers (sender, channel, company, branch)
 *  - Sensible timeouts and error pass-through
 */

import axios, { AxiosError, AxiosInstance } from 'axios';

interface TokenCache {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;       // epoch ms
  refreshExpiresAt: number;
}

interface Env {
  baseUrl: string;
  webComponentBaseUrl: string;
  clientId: string;
  clientSecret: string;
  username: string;
  password: string;
  sender: string;
  channel: string;
  company: string;
  branch: string;
  webhookSecret?: string;
}

function readEnv(): Env {
  const required = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`Missing required env var: ${k}`);
    return v;
  };
  return {
    baseUrl:             required('D9_BASE_URL'),
    webComponentBaseUrl: process.env.D9_WEBCOMPONENT_BASE_URL ?? 'https://drap-sbx.digitnine.com',
    clientId:            required('D9_CLIENT_ID'),
    clientSecret:        required('D9_CLIENT_SECRET'),
    username:            required('D9_USERNAME'),
    password:            required('D9_PASSWORD'),
    sender:              required('D9_SENDER'),
    channel:             process.env.D9_CHANNEL ?? 'Direct',
    company:             required('D9_COMPANY'),
    branch:              required('D9_BRANCH'),
    webhookSecret:       process.env.D9_WEBHOOK_SECRET,
  };
}

export class D9Client {
  readonly env: Env;
  private readonly http: AxiosInstance;
  private token: TokenCache | null = null;

  constructor() {
    this.env = readEnv();
    this.http = axios.create({
      baseURL: this.env.baseUrl,
      timeout: 30_000,
    });
    this.http.interceptors.request.use(async (config) => {
      const token = await this.getAccessToken();
      config.headers.set('Authorization', `Bearer ${token}`);
      config.headers.set('sender',  this.env.sender);
      config.headers.set('channel', this.env.channel);
      config.headers.set('company', this.env.company);
      config.headers.set('branch',  this.env.branch);
      return config;
    });
  }

  /** Get the current access token, refreshing if expired. Used by tools that need the raw token. */
  async getAccessToken(): Promise<string> {
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
      accessToken:      data.access_token,
      refreshToken:     data.refresh_token,
      expiresAt:        Date.now() + data.expires_in        * 1000,
      refreshExpiresAt: Date.now() + data.refresh_expires_in * 1000,
    };
    return this.token.accessToken;
  }

  /** Convenience accessor for the most recent token metadata (for d9_get_token tool). */
  getTokenMetadata(): { expires_in: number; refresh_expires_in: number; token_type: 'bearer' } | null {
    if (!this.token) return null;
    return {
      expires_in:         Math.max(0, Math.floor((this.token.expiresAt - Date.now()) / 1000)),
      refresh_expires_in: Math.max(0, Math.floor((this.token.refreshExpiresAt - Date.now()) / 1000)),
      token_type:         'bearer',
    };
  }

  /** Generic call passthrough — used by every tool. */
  async call<T = any>(config: Parameters<AxiosInstance['request']>[0]): Promise<T> {
    try {
      const { data } = await this.http.request<T>(config);
      return data;
    } catch (e) {
      throw normalizeAxiosError(e);
    }
  }
}

export class D9SandboxError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

function normalizeAxiosError(e: unknown): Error {
  const ax = e as AxiosError<any>;
  if (ax.response) {
    const body = ax.response.data;
    // Digit9 sandbox error envelope: { status, status_code, error_code, message, details?, errors? }
    const code = body?.error_code ?? body?.code ?? body?.error ?? String(ax.response.status);
    const msg  = body?.message ?? ax.response.statusText;

    // Surface field-level reasons. `details` is a map { "sender.sender_id[0].valid_through": "..." };
    // `errors` is sometimes an array. Either way, callers must see them — the generic message alone
    // (e.g. "Payload parameter is missing or corrupt") is not actionable.
    const reasonsBlob = formatReasons(body?.details) ?? formatReasons(body?.errors);
    const fullMsg = reasonsBlob ? `Digit9 ${code}: ${msg} — ${reasonsBlob}` : `Digit9 ${code}: ${msg}`;

    return new D9SandboxError(fullMsg, ax.response.status, String(code), body);
  }
  if (ax.code === 'ECONNABORTED') return new D9SandboxError('Digit9 sandbox timeout');
  return e instanceof Error ? e : new Error(String(e));
}

function formatReasons(blob: unknown): string | null {
  if (!blob) return null;
  if (Array.isArray(blob)) {
    return blob.map((e) => (typeof e === 'string' ? e : JSON.stringify(e))).join('; ');
  }
  if (typeof blob === 'object') {
    const entries = Object.entries(blob as Record<string, unknown>);
    if (entries.length === 0) return null;
    return entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('; ');
  }
  return String(blob);
}

// Module-level singleton — MCP servers are short-lived processes, this is fine.
let _client: D9Client | null = null;
export function getClient(): D9Client {
  if (!_client) _client = new D9Client();
  return _client;
}
