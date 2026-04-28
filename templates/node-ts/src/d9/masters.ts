import { D9Client } from './client.js';

const TTL_MS = 24 * 60 * 60 * 1000;

interface Entry<T> { value: T; fetchedAt: number; }
const cache = new Map<string, Entry<any>>();

async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit.value;
  const value = await fetcher();
  cache.set(key, { value, fetchedAt: Date.now() });
  return value;
}

export interface Bank {
  bankId:       string;
  bankName:     string;
  isoCode:      string;
  accountTypes: { code: string; name: string }[];
}

export type ReceivingMode = 'BANK' | 'CASHPICKUP' | 'WALLET';

export async function listCorridors(client: D9Client) {
  return cached('corridors', async () => {
    const { data } = await client.request<any>({
      method: 'GET',
      url:    '/raas/masters/v1/service-corridor',
    });
    return data.data ?? [];
  });
}

export async function listBanks(
  client: D9Client,
  receivingCountryCode: string,
  receivingMode: ReceivingMode,
): Promise<Bank[]> {
  const key = `banks:${receivingCountryCode}:${receivingMode}`;
  return cached(key, async () => {
    const { data } = await client.request<any>({
      method: 'GET',
      url:    '/raas/masters/v1/banks',
      params: { receiving_country_code: receivingCountryCode, receiving_mode: receivingMode },
    });
    // Banks endpoint paginates with envelope { data: { list: [...], total_records } }.
    // Other masters (corridors, branches) return { data: [...] } directly.
    return (data.data?.list ?? []).map((b: any) => ({
      bankId:   b.bank_id,
      bankName: b.bank_name,
      isoCode:  b.iso_code,
      accountTypes: (b.account_types ?? []).map((a: any) => ({
        code: a.account_type_code,
        name: a.account_type_name,
      })),
    }));
  });
}

export async function listBranches(client: D9Client, bankId: string) {
  return cached(`branches:${bankId}`, async () => {
    const { data } = await client.request<any>({
      method: 'GET',
      url:    `/raas/masters/v1/banks/${encodeURIComponent(bankId)}/branches`,
    });
    return data.data ?? [];
  });
}
