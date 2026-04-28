/**
 * End-to-end sandbox test. Skipped if D9_* env vars are not present.
 *
 * Runs the canonical happy path: auth → masters → quote → create → confirm.
 * Polling to terminal state is intentionally NOT included — sandbox payout
 * dwell ("not a partner bug" per /digit9-paas:d9-test) makes that flaky for
 * CI. The /digit9-paas:d9-test slash command demonstrates the full polling
 * flow when needed.
 */

import 'dotenv/config';
import { describe, it, expect } from 'vitest';
import { d9 } from '../../src/d9/client.js';
import { listBanks, listCorridors } from '../../src/d9/masters.js';
import { fetchQuote } from '../../src/d9/quote.js';
import { createTransaction } from '../../src/d9/transaction.js';
import { confirmTransaction } from '../../src/d9/status.js';

const haveCreds = !!(process.env.D9_CLIENT_SECRET && process.env.D9_USERNAME);
const describeIfCreds = haveCreds ? describe : describe.skip;

describeIfCreds('Digit9 PaaS happy path (sandbox)', () => {
  it('Onboard → corridor → bank → quote → create → confirm', async () => {
    const client = d9();

    // Master data sanity. The list results aren't fed into createTransaction —
    // IN bank_details below uses canonical Postman values for repeatable test
    // results regardless of which bank ranks first in the list response.
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

    // Create — canonical AE → IN BANK shape per the d9-transaction skill
    // (taken verbatim from the PAASTestAgent Postman collection).
    const txn = await createTransaction(client, {
      quote,
      sourceOfIncome: 'SLRY',
      purposeOfTxn:   'SUPP',
      sender: {
        agent_customer_number: 'DEMO_TEST_001',
        mobile_number:         '+971508359468',
        first_name:            'George',
        last_name:             'Micheal',
        date_of_birth:         '1995-08-22',
        country_of_birth:      'IN',
        nationality:           'IN',
        sender_id: [
          {
            id_code:       '4',                  // numeric — Emirates ID per /paas/codes?code=id_types
            id:            '784199191427626',
            issued_on:     '2022-10-31',
            valid_through: '2030-11-01',         // must be today or later
          },
        ],
        sender_address: [
          {
            address_type: 'PRESENT',             // PRESENT | PERMANENT — not RES/BIZ
            address_line: 'Sheikh Zayed Road, Tower 3',
            post_code:    '710',                 // post_code, not postal_code
            town_name:    'DUBAI',               // town_name, not city
            country_code: 'AE',
          },
        ],
      },
      receiver: {
        first_name:    'Anija FirstName',
        last_name:     'Anija Lastname',
        mobile_number: '+919586741500',
        date_of_birth: '1990-08-22',
        gender:        'F',
        nationality:   'IN',
        relation_code: '32',                     // numeric — friend, per /paas/codes?code=relations
        receiver_address: [
          {
            address_type: 'PRESENT',
            address_line: '12 MG Road',
            town_name:    'THRISSUR',
            country_code: 'IN',
          },
        ],
        bank_details: {
          account_type_code: '1',                // numeric-as-string — '1' = savings
          routing_code:      'FDRL0001033',      // IFSC for IN; no iso_code, no bank_id
          account_number:    '99345724439934',
        },
      },
    });

    expect(txn.transactionRefNumber).toMatch(/^\d{16}$/);

    const confirmed = await confirmTransaction(client, txn.transactionRefNumber);
    expect(['IN_PROGRESS', 'COMPLETED']).toContain(confirmed.state);
  }, 60_000);
});
