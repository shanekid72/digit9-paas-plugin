import { D9Client } from './client.js';
import { ReceivingMode } from './masters.js';

export interface QuoteRequest {
  sendingCountry:    string;
  sendingCurrency:   string;
  receivingCountry:  string;
  receivingCurrency: string;
  sendingAmount:     number;
  receivingMode:     ReceivingMode;
}

export interface Quote {
  quoteId:      string;
  expiresAt:    Date;
  rate:         string;
  ourFeesTotal: number;
  raw:          unknown;
}

const QUOTE_SAFETY_MS = 5_000;

export async function fetchQuote(client: D9Client, q: QuoteRequest): Promise<Quote> {
  const { data } = await client.request<any>({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/quote',
    data: {
      sending_country_code:    q.sendingCountry,
      sending_currency_code:   q.sendingCurrency,
      receiving_country_code:  q.receivingCountry,
      receiving_currency_code: q.receivingCurrency,
      sending_amount:          q.sendingAmount,
      receiving_mode:          q.receivingMode,
      type:                    'SEND',
      instrument:              'REMITTANCE',
    },
  });

  if (data.data?.sub_state !== 'QUOTE_CREATED') {
    throw new Error(`Unexpected quote sub_state: ${data.data?.sub_state}`);
  }

  const ourFees = (data.data.fee_details ?? [])
    .filter((f: any) => f.model === 'OUR')
    .reduce((sum: number, f: any) => sum + Number(f.amount), 0);

  // fx_rates is an array — typically two entries, both SELL: one for
  // sending→receiving and the inverse. Pick the sending→receiving direction.
  const fxRates: any[] = data.data.fx_rates ?? [];
  const primary = fxRates.find(
    (r: any) => r.type === 'SELL'
      && r.base_currency_code === q.sendingCurrency
      && r.counter_currency_code === q.receivingCurrency,
  );
  if (!primary) {
    throw new Error(
      `No SELL rate found for ${q.sendingCurrency}→${q.receivingCurrency} in quote response`,
    );
  }

  return {
    quoteId:      data.data.quote_id,
    expiresAt:    new Date(data.data.expires_at),
    rate:         String(primary.rate),
    ourFeesTotal: ourFees,
    raw:          data,
  };
}

export function isQuoteExpired(q: Quote): boolean {
  return Date.now() + QUOTE_SAFETY_MS >= q.expiresAt.getTime();
}
