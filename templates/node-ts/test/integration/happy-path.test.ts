/**
 * End-to-end sandbox test. Skipped if D9_* env vars are not present.
 *
 * Mirrors what `/digit9-paas:d9-test` does, in code form. Useful in CI as a smoke test
 * (run nightly, not on every PR — real money paths).
 */

import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { d9 } from '../../src/d9/client.js';
import { listBanks, listCorridors } from '../../src/d9/masters.js';
import { fetchQuote } from '../../src/d9/quote.js';
import { createTransaction } from '../../src/d9/transaction.js';
import { confirmTransaction, pollUntilTerminal } from '../../src/d9/status.js';

const haveCreds = !!(process.env.D9_CLIENT_SECRET && process.env.D9_USERNAME);
const describeIfCreds = haveCreds ? describe : describe.skip;

describeIfCreds('Digit9 PaaS happy path (sandbox)', () => {
  it('Onboard → corridor → bank → quote → create → confirm → terminal', async () => {
    const client = d9();

    // Master data sanity
    const corridors = await listCorridors(client);
    expect(corridors.length).toBeGreaterThan(0);
    const banks = await listBanks(client, 'IN', 'BANK');
    expect(banks.length).toBeGreaterThan(0);

    // Quote
    const quote = await fetchQuote(client, {
      sendingCountry:    'AE',
      sendingCurrency:   'AED',
      receivingCountry:  'IN',
      receivingCurrency: 'INR',
      sendingAmount:     100,
      receivingMode:     'BANK',
    });
    expect(quote.quoteId).toBeTruthy();
    expect(quote.expiresAt.getTime()).toBeGreaterThan(Date.now());

    // Pick first bank for the receiver shape
    const bank = banks[0]!;
    const accountTypeCode = bank.accountTypes[0]?.code ?? '01';

    const txn = await createTransaction(client, {
      quote,
      serviceType: '{{SERVICE_TYPE}}',
      sourceOfIncome: 'SLRY',
      purposeOfTxn:   'SUPP',
      sender: {
        first_name:    'Test',
        last_name:     'Sender',
        mobile_number: '+971501234567',
        nationality:   'AE',
        date_of_birth: '1985-04-15',
        country_of_birth: 'GB',
        sender_id:      [{ id_code: 'PASSPORT', id_number: 'GB1234567', issue_date: '2019-01-01', expiry_date: '2029-01-01', issued_country: 'GB' }],
        sender_address: [{ address_type: 'RES', address_line: 'Apt 4B', city: 'Dubai', postal_code: '00000', country_code: 'AE' }],
      },
      receiver: {
        first_name:    'Test',
        last_name:     'Receiver',
        mobile_number: '+919812345678',
        nationality:   'IN',
        relation_code: 'FRND',
        receiver_id:      [{ id_code: 'AADHAAR', id_number: '1234-5678-9012', issued_country: 'IN' }],
        receiver_address: [{ address_type: 'RES', address_line: '12 MG Road', city: 'Mumbai', postal_code: '400001', country_code: 'IN' }],
        bank_details: {
          bank_id:           bank.bankId,
          iso_code:          bank.isoCode,
          account_number:    '12345678901234',
          account_type_code: accountTypeCode,
        },
      },
    });

    expect(txn.transactionRefNumber).toMatch(/^\d{16}$/);

    const confirmed = await confirmTransaction(client, txn.transactionRefNumber);
    expect(confirmed.state).toBe('IN_PROGRESS');

    const terminal = await pollUntilTerminal(client, txn.transactionRefNumber, {
      maxDurationMs: 90_000,
    });
    expect(['COMPLETED', 'FAILED', 'CANCELLED']).toContain(terminal.state);
  }, 120_000);
});
