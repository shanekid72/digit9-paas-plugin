import { D9Client } from './client.js';

export type State = 'INITIATED' | 'ACCEPTED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
const TERMINAL: ReadonlySet<State> = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export async function confirmTransaction(client: D9Client, txnRef: string) {
  const { data } = await client.request<any>({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/confirmtransaction',
    data:   { transaction_ref_number: txnRef },
  });
  return data;
}

export async function enquireTransaction(client: D9Client, txnRef: string) {
  const { data } = await client.request<any>({
    method: 'GET',
    url:    '/amr/paas/api/v1_0/paas/enquire-transaction',
    params: { transaction_ref_number: txnRef },
  });
  return data;
}

export async function cancelTransaction(
  client: D9Client,
  txnRef: string,
  reason: string,
  remarks?: string,
) {
  const { data } = await client.request<any>({
    method: 'POST',
    url:    '/amr/paas/api/v1_0/paas/canceltransaction',
    data:   { transaction_ref_number: txnRef, cancel_reason: reason, remarks },
  });
  return data;
}

export interface PollOptions {
  initialDelayMs?: number; // default 5_000
  maxDurationMs?:  number; // default 30 minutes
}

export async function pollUntilTerminal(
  client: D9Client,
  txnRef: string,
  opts: PollOptions = {},
): Promise<{ state: State; raw: any }> {
  const initial = opts.initialDelayMs ?? 5_000;
  const maxDur  = opts.maxDurationMs  ?? 30 * 60_000;
  const start   = Date.now();
  await delay(initial);

  while (Date.now() - start < maxDur) {
    const r = await enquireTransaction(client, txnRef);
    if (TERMINAL.has(r.state as State)) return { state: r.state, raw: r };
    const elapsed = Date.now() - start;
    await delay(elapsed < 120_000 ? 10_000 : 30_000);
  }
  throw new Error(`Transaction ${txnRef} did not reach terminal state within ${maxDur}ms`);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
